# Score Sing

A private, responsive sheet-music companion. Spotify continues playback in its own app on Windows or iPhone. Score Sing displays imported MusicXML, lyrics embedded in the score, the current pitch, and a following cursor. It does not rehost music, fetch Spotify's private lyrics endpoints, or replace Spotify's player.

## Connect

For local development, sign in with the random access code printed in the server console at startup. It is generated anew for each non-production run bound to loopback; the matching signing secret stays in memory, and restarting the server invalidates sessions and generates a new code. No username, password, or secret setup is needed. Production and non-loopback deployments still require `SCORE_SING_LOGIN_PASSWORD` (at least 16 characters) and a stable `SCORE_SING_AUTH_SECRET` (at least 32 characters). There is one shared Score Sing account, not per-person accounts. Sign-in is handled by this app and does not contact an external identity provider.

Connect Spotify through the configured developer application. Its Spotify dashboard must list the deployment's `/callback.html` URL (for local development, `http://127.0.0.1:8080/callback.html`). The operator's public Spotify developer client ID (`283d3d54be16465ca3d51e898f78c037`) is configured in `frontend/spotify.js`; Connect Spotify goes straight to authorization. Spotify authorization uses PKCE/S256 and a single-use state verifier with a ten-minute deadline. OAuth tokens remain in tab-scoped sessionStorage, refresh with a bounded request, and clear on disconnect/sign-out. The sole Spotify scope is `user-read-currently-playing`. Each device authorizes separately.

## Scores and timing

Open a compressed `.mxl` or uncompressed `.musicxml`/`.xml` partwise vocal score (up to 5 MB); repeats and jumps are unfolded into performed order. Bind it explicitly to the currently playing recording using Align score. Tempo-based following uses the specified BPM and the time in seconds of the score's first note. It is an approximation; adjust for the actual recording. Tempo changes and rubato require recording-specific cues.

Use **MusicXML** to download the current score as an uncompressed `.musicxml` file. **PDF** opens the browser print dialog; choose **Save as PDF** to download a printable copy.

Use Align score to bind the current recording, choose the first and last score positions, and mark their actual playback times. Add intermediate checkpoints where timing changes. Apply interpolates timing between those marks; it does not automatically detect the recording’s tempo variations. Draft checkpoints remain separate from applied timing. Export saves a portable timed-score package.

For pre-authored recording-specific alignment, Open score also accepts a JSON timed-score package:

```json
{
  "schemaVersion": 1,
  "title": "My vocal score",
  "spotifyTrackId": "the22characterTrackID00",
  "musicxml": "<score-partwise>...</score-partwise>",
  "cues": [1.2, 1.7, 2.3]
}
```

`cues` is a strictly increasing array of playback timestamps in seconds, one for every OSMD cursor position in the performed score. It must match the exact recording and score. Invalid/missing IDs, timing counts or active XML content fail visibly. The illustrative ID above is not a song.

## Automatic scores

When Spotify plays a song with no saved score, Score Sing searches its song catalog by title and artist (`GET /api/catalog/match`, signed in). The catalog holds the 33,800 PDMX scores that carry lyrics (Zenodo 15571083, CC-BY 4.0), built by `scripts/build-catalog.py` into `SCORE_SING_CATALOG_DIR` (default `/home/ubuntu/.local/share/score-sing/catalog`, outside Git). Near titles by a different artist are dropped as other songs. The browser fetches the recording's time-synced lyrics from LRCLIB (only title, artist, album and length are sent), downloads the candidates and opens the best-ranked playable one whose first-verse words match the recording (at least 45%). Scores with repeat signs, volta endings and D.C./D.S. jumps are unfolded into performed order (`frontend/unfold.js`), each pass singing its own verse; in a sample of 150 catalog scores with repeats, 147 now play. Pass-specific notes (`time-only`), unclosed endings and drawn coda signs without playback instructions still fail visibly. It times notes from lyric lines when available. Otherwise, it makes a best-effort request for Spotify's estimated `tempo` and `time_signature` metadata and uses the tempo; both fields are validated, displayed as estimates, and saved with the score. Spotify marks its [Audio Features endpoint](https://developer.spotify.com/documentation/web-api/reference/get-audio-features) deprecated, so the app does not depend on it: when unavailable, the score's MusicXML tempo or 120 BPM default remains in effect and the subtitle reports the reason. The found score is saved bound to the song. Try another opens the next candidate and replaces an untouched automatic score.

A song missing from the catalog but with synced lyrics gets a words-only score: one note per word on a 16th-note grid at 60 BPM. Line starts come from the recording; word times within a line are estimated. It is rebuilt each time and never saved to the library, so a real score added to the catalog later takes its place.

**Learn notes** fills in a words-only score's melody by listening while the song plays. Chrome and Edge capture the shared system or tab audio (turn on “Share system audio”); other browsers, including Firefox, use the microphone, so the song must play aloud. Every 50 ms the strongest vocal-range pitch (A2–A5, Melodia-style harmonic salience over spectral peaks, `frontend/melody.js`) is credited to the word being sung then, and a candidate whose pitch wavers across frames (vibrato, glides) counts for more than a steady backing note; a word gets a note once at least four frames agree on it, with octave slips counted together. Votes accumulate across listens in this browser's storage per account and song; audio is never stored or sent. Learned notes are estimates: on real amateur karaoke singing (MIR-1K), about 69% of notes are right with voice and band equally loud and about 82% with the voice 5 dB louder, as is common in pop mixes (46% with the voice 5 dB quieter); they also inherit the estimated word timing, one note per word, and backing vocals or loud lead instruments can win. Words still without a note show an x notehead, and mic pitch compares against learned notes.
PDMX is strong on hymns, folk, standards, musicals and popular covers; recent releases such as Linkin Park's *From Zero* (2024) are absent and get words-only scores.

Scores and alignment are saved to the signed-in account's score library, so a score opened and aligned on Windows is available on iPhone. When Spotify starts a song with a bound score, the newest score bound to it loads automatically; a song without one keeps the current score and the status line says so. A score that is opened but not yet bound is never switched away from automatically. Saved scores appears beside the score tools when the account has another score to choose. A score saved only in this browser by an earlier version moves into the library on first sign-in and is removed locally only after the server stores it. An imported score is saved only after parsing and rendering succeed. Spotify polling never replaces a draft tempo or offset input. Following freezes on pause, stops on a track mismatch or stale/missing data, and recomputes from fresh state after seeking, tab return and reconnect. Polls are serialized, time out after 12 seconds, and back off after rate limits. Stale projection ends after eight seconds. Hidden tabs stop polling.

Moving to another computer: see [docs/migration.md](docs/migration.md). Resuming development elsewhere: see [docs/HANDOFF.md](docs/HANDOFF.md).

## Local development

Needs Node.js 24 or newer and Git. On Windows, double-click `Start Score Sing.bat`; it installs dependencies on first run, starts the server, and prints the sign-in code and URL in its console. Open the URL in a browser. On other platforms, run `npm ci` once, then `npm start`. No environment variables or database secrets are required; without PostgreSQL, scores are saved in that browser.

For automatic scores, optionally unpack the catalog and set `SCORE_SING_CATALOG_DIR` to its `catalog/` folder. Without it, the app still runs and `/api/health` reports the catalog as unavailable.

Spotify's developer app must list `http://127.0.0.1:8080/callback.html` as a redirect URI; Spotify allows loopback `http` addresses. `npm test` runs the unit tests; the browser checks below need `npx playwright install chromium`.

The score library needs PostgreSQL (`lib/db.js`); without it saves stay in the browser, as on the live app.

## Verification

- `npm test`: JWT scope/signature/expiry, playhead/timing and score-library tests. The library tests start a private PostgreSQL cluster when `initdb` is installed.
- `PLAYWRIGHT_BROWSERS_PATH=<dir> node tests/library-browser.cjs`: migration, cross-device sync, song auto-switch, account isolation and storage outage, against the real library handler and PostgreSQL.
- `PLAYWRIGHT_BROWSERS_PATH=<writable browser directory> node tests/pitch-browser.cjs`: on-device mic pitch reads in tune, octave-folded, sharp, flat and silence against the current note; denial is reported; the microphone stops on toggle off and sign-out.
- `PLAYWRIGHT_BROWSERS_PATH=<writable browser directory> node tests/stage-browser.cjs`: floating score window (real Document Picture-in-Picture in Chromium) follows, returns and closes; wake lock is held only while following and released on pause or disconnect.
- `PLAYWRIGHT_BROWSERS_PATH=<writable browser directory> node tests/browser.cjs`: real score rendering, PDF print/save and MusicXML download, dark/light/phone layouts, deterministic Spotify fixtures for seek/pause/track changes, recording-specific cue import, malformed import and OAuth state rejection.
- `node tests/score-download-browser.cjs`: end-to-end MusicXML download and PDF printing without requiring PostgreSQL.
- `PLAYWRIGHT_BROWSERS_PATH=<dir> node tests/auto-score-browser.cjs`: catalog score found, a wrong-lyrics candidate skipped, timed from lyrics, saved and replaced by Try another; validated Spotify tempo and meter fallback without lyrics; words-only score; Learn notes from a synthetic shared-audio singer, kept across reopen, corrupt stored notes reported; no match; saved score reopens without searching.
- `node scripts/melody-benchmark.mjs <data dir> --fetch` (then without `--fetch`; `SAR=-5|0|5` sets the voice level): Learn notes accuracy on 63 real MIR-1K karaoke clips with hand-labeled pitch.
- `SCORE_SING_CATALOG_DIR=<catalog> PLAYWRIGHT_BROWSERS_PATH=<dir> node tests/real-catalog-browser.cjs`: real catalog scores and live LRCLIB lyrics for popular songs and two *From Zero* tracks (needs the installed catalog and network; `SONGS=a,b` limits it).
- `PLAYWRIGHT_BROWSERS_PATH=<writable browser directory> node tests/embedded-browser.cjs`: inside the chat's sandboxed app frame, Connect Spotify signs in through a pop-up (Spotify refuses frames) and playback follows in the frame.
- `node server.js` is the deployed runtime, started only through the deployment helper.
- `/api/health` is public; `/api/session` requires a valid Score Sing session JWT.

## Score library storage

`/api/library` (GET list; GET, PUT create, PATCH, DELETE `/api/library/<uuid>`) requires the same verified ID JWT; every query is filtered by its subject. MusicXML is stored once; PATCH changes title, Spotify track binding and alignment with the current `revision` (stale writes get 409). Limits: 5 MB per score, 200 scores and 200 MB per account. The browser sends `X-Score-Sing-Account`; a token for a different account gets 409.

PostgreSQL connection settings come only from the mounted service secret `/opt/secrets/score-sing.json`: `{"host","port","database","user","password"}` (`password` optional for socket peer authentication). The app creates its table on first use. Without the secret or a reachable database, library routes answer 503, `/api/health` reports `"library":"unavailable"`, and the page shows that changes are not being saved. There is no file or SQLite fallback. No private scores or Spotify credentials are served by static files.

Live Spotify synchronization remains unverified until an authorized Spotify account is connected. Fixture tests are not live-service verification. No connected Windows/iPhone runtime was available in this session. Permission is assumed per the operator's explicit request, not claimed as verified platform approval.

## Attributions

OpenSheetMusicDisplay renders the score; its compiled asset and license are under `frontend/vendor`. The preview is a newly encoded public-domain Beethoven melody with Henry van Dyke's public-domain text, not a Spotify recording. Preview mode plays no audio.

Automatic scores come from PDMX (Long, Novack, Berg-Kirkpatrick and McAuley, 2024; Zenodo 15571083, CC-BY 4.0) and keep each score's MuseScore credit and license in the catalog index; the score's credit shows under its title. Synced lyrics come from LRCLIB at play time and are not stored by Score Sing.

Compressed scores follow the MusicXML container convention: META-INF/container.xml names the notation file. Extraction runs in a dedicated worker with a 15-second deadline. It counts actual decoded bytes, verifies ZIP metadata and CRC checksums, and is bounded to 128 entries, 5 MB per file and 10 MB total declared uncompressed size; archives with corrupt containers, invalid paths or unsupported entities fail visibly. Other packaged renditions are not played. The archive decoder loads only when a compressed score is opened.

## Live-use verification

`GET/POST /api/verification` requires the same Score Sing session JWT as `/api/session`. The browser submits only a random per-view run ID and nondecreasing counters: fresh Spotify samples, following note advances, paused-state transitions, playhead discontinuities, track changes and safe cursor stops. No song identifiers/titles, score text, provider credentials, audio or device content is sent. Reports are transient, expire after 30 minutes, are scoped to the authenticated app subject and are bounded to 256 runs in memory. No database or new product surface is involved.

Following must have three fresh samples and three note advances over an observed interval; a complete check additionally needs a paused-state transition, playhead jump, song change and a safe stop in the same run. These are content-free browser observations, not hardware attestation or a claim that audio was audible. The factory's observer only reads this endpoint. Published-asset fixtures intercept the endpoint and never submit their synthetic Spotify states to the live store. GET does not create observations. A silent preview produces no reports.
