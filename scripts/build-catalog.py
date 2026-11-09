#!/usr/bin/env python3
"""Build Score Sing's song catalog from PDMX (Zenodo record 15571083, CC-BY 4.0).

Keeps only scores with lyrics, writes a compact index.json and copies each referenced
MusicXML file to <out>/mxl/<id>.mxl. The new catalog replaces the old one only after it
is complete, so the running app never sees a half-built catalog.

Usage: build-catalog.py --source DIR_WITH_PDMX.csv_AND_mxl.tar.gz --out CATALOG_DIR
"""
import argparse, csv, json, os, re, shutil, sys, tarfile, time

MIN_LYRICS = 12          # fewer lyric syllables than this cannot carry a sung line
MAX_MXL_BYTES = 5_000_000  # the browser refuses larger scores

def number(value, kind=float):
    try:
        return kind(float(value))
    except (TypeError, ValueError):
        return None

def text(value):
    value = (value or '').strip()
    return '' if value in ('NA', 'nan') else value

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source, out = os.path.abspath(args.source), os.path.abspath(args.out)
    csv_path, tar_path = os.path.join(source, 'PDMX.csv'), os.path.join(source, 'mxl.tar.gz')
    for path in (csv_path, tar_path):
        if not os.path.isfile(path):
            sys.exit(f'missing {path}')
    csv.field_size_limit(10**8)
    wanted, entries, seen = {}, [], set()
    with open(csv_path, newline='', encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            if row['has_lyrics'] != 'True' or (number(row['n_lyrics'], int) or 0) < MIN_LYRICS:
                continue
            match = re.fullmatch(r'\./mxl/(\d+/\d+/(Qm[1-9A-HJ-NP-Za-km-z]{44}))\.mxl', row['mxl'])
            if not match:
                continue
            ident = match.group(2)
            if ident in seen:
                continue
            seen.add(ident)
            wanted['mxl/' + match.group(1) + '.mxl'] = ident
            entries.append({
                'id': ident,
                'song': text(row['song_name']) or text(row['title']),
                'title': text(row['title']),
                'artist': text(row['artist_name']),
                'composer': text(row['composer_name']),
                'seconds': number(row['song_length.seconds']),
                'views': number(row['n_views'], int) or 0,
                'rating': number(row['rating']) or 0,
                'tracks': number(row['n_tracks'], int) or 0,
                'lyrics': number(row['n_lyrics'], int) or 0,
                'license': text(row['license']),
                'licenseConflict': row['license_conflict'] == 'True',
                'best': row['is_best_unique_arrangement'] == 'True',
            })
    building = out + '.building'
    shutil.rmtree(building, ignore_errors=True)
    os.makedirs(os.path.join(building, 'mxl'))
    found = set()
    with tarfile.open(tar_path, 'r|gz') as archive:
        for member in archive:
            name = member.name[2:] if member.name.startswith('./') else member.name
            ident = wanted.get(name)
            if not ident or not member.isfile() or member.size > MAX_MXL_BYTES:
                continue
            data = archive.extractfile(member).read()
            if not data.startswith(b'PK'):
                continue
            with open(os.path.join(building, 'mxl', ident + '.mxl'), 'wb') as handle:
                handle.write(data)
            found.add(ident)
    entries = [entry for entry in entries if entry['id'] in found]
    if len(entries) < 1000:
        sys.exit(f'only {len(entries)} scores extracted; refusing to replace the catalog')
    index = {'schemaVersion': 1, 'source': 'PDMX (Zenodo 15571083, CC-BY 4.0)', 'builtAt': int(time.time()), 'entries': entries}
    with open(os.path.join(building, 'index.json'), 'w', encoding='utf-8') as handle:
        json.dump(index, handle, ensure_ascii=False, separators=(',', ':'))
    old = out + '.old'
    shutil.rmtree(old, ignore_errors=True)
    if os.path.exists(out):
        os.rename(out, old)
    os.rename(building, out)
    shutil.rmtree(old, ignore_errors=True)
    print(json.dumps({'entries': len(entries), 'out': out}))

if __name__ == '__main__':
    main()
