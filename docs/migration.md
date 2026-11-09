# Moving Score Sing to another computer

Excessive Code does not move apps or chats between servers, so a move is a manual restore from a bundle.

## What the bundle holds

| File | Contents | Restore |
|---|---|---|
| `score-sing.bundle` | Every commit and branch of this repository | `git clone score-sing.bundle score-sing` |
| `score-catalog.tar` | The 33,823-score PDMX lyrics catalog (`index.json` + `mxl/`), about 570 MB | Unpack anywhere outside Git and point `SCORE_SING_CATALOG_DIR` at its `catalog/` directory |
| `SHA256SUMS` | Checksums of both files | `sha256sum -c SHA256SUMS` |

The catalog can also be rebuilt instead of copied: download `PDMX.csv` and `mxl.tar.gz` from Zenodo record 15571083 (about 2 GB) and run `python3 scripts/build-catalog.py --source <download dir> --out <catalog dir>`.

## What does not move

- **Saved scores.** The server score library database was never provisioned, so there is no server copy. Scores are kept in each browser's storage for the current web address and do not follow a new address.
- **Sign-in.** AuthReturn hosts the `score-sing` app registration and its approved-email list; the new address must be allowed there.
- **Spotify.** The developer app (client ID in `frontend/spotify.js`) must list `https://<new address>/callback.html` as a redirect URI. Only the Spotify account owner can add it in the Spotify developer dashboard.
- **Chats, tasks and the factory.** These stay on the Excessive Code server that ran them.
- **Agent working files.** `.private/` (tokens, browser receipts) is not migrated; tokens are minted again on the new server.

## Restore

1. Node.js 24 or newer; `npm ci` in the cloned repository.
2. Unpack the catalog and set `SCORE_SING_CATALOG_DIR`.
3. On an Excessive Code server, create the app through `POST /api/apps/create` and deploy through its lifecycle; elsewhere, run `node server.js` with `PORT` set, behind HTTPS.
4. `GET /api/health` must report `"catalog":{"status":"ok","entries":33823}`.
5. Run `npm test` and the browser checks in the README.
