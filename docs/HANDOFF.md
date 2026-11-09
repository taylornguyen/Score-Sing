# Score Sing handoff for local development

Written November 9, 2026 at version 0.13.1 (commit 664a92c). Live at https://score-sing.multi.excessivecode.com/.

To have Claude Code load this file automatically, create `CLAUDE.md` in the repository root containing the line `@docs/HANDOFF.md`.

## What the app does

A private web companion for Spotify, for Windows desktop and iPhone. While a song plays in Spotify, it shows the song's sheet music with lyrics and highlights the current note. It never plays audio itself.

- **Following:** polls Spotify's currently-playing endpoint every 2.5 s, extrapolates the playhead and moves the score cursor.
- **Automatic scores:** when a song has no saved score, the app searches a local catalog of 33,823 public-domain/CC-BY lyric scores (PDMX). It screens candidates against the recording's time-synced lyrics from LRCLIB, then times every note to those lyrics.
- **Words-only scores:** a song not in the catalog (most recent pop, such as Linkin Park's *From Zero*) gets one note per word, timed from the synced lyrics.
- **Learn notes:** fills in a words-only score's melody by listening during playback. Chrome/Edge capture shared system audio; Firefox uses the microphone. It estimates each word's note on the device and saves it in the browser.
- Also included: manual MusicXML/MXL import, checkpoint timing, a floating score window, mic pitch feedback, and a per-account score library.

## Run and test

See README.md, "Local development" and "Verification".
- Short version: `npm ci`, then `PORT=8080 node server.js`; in PowerShell, `$env:PORT=8080; node server.js`.
- `npm test` runs about 78 unit tests.
- Browser checks are `node tests/<name>-browser.cjs` with Playwright's Chromium installed. Run them one at a time; running several in parallel causes timeouts.

## Code map

Plain ES modules with no build step and no framework. The style is dense: short lines joined with `;` and few comments, each explaining *why*. Match it.

| Path | Role |
|---|---|
| `server.js` | Node `http` server: static `frontend/`, `/api/health`, `/api/session`, `/api/verification`, library, catalog and `/download/` routes |
| `lib/auth.js` | Verifies AuthReturn (Cognito) ID tokens; config fetched from `authreturn.com/api/apps/score-sing/cognito` at startup |
| `lib/catalog.js` | Catalog index search (`/api/catalog/match`) and score files (`/api/catalog/score/<id>`), signed-in only |
| `lib/library.js`, `lib/db.js` | Score library API on PostgreSQL; the connection comes only from `/opt/secrets/score-sing.json` (no fallback) |
| `lib/verification.js` | Content-free usage counters (no songs, tokens or audio) used to confirm real use |
| `lib/exports.js` | Expiring `/download/<token>/<file>` links (used for this export) |
| `frontend/app.js` | Main page: sign-in, polling, rendering (OpenSheetMusicDisplay), following, automatic scores, Learn notes |
| `frontend/spotify.js` | Spotify PKCE sign-in in a pop-up and playback polling. Public client ID `283d3d54…` belongs to your Spotify developer app |
| `frontend/sync.js` | Playhead math, MusicXML validation, cue/checkpoint timing |
| `frontend/unfold.js` | Rewrites repeats, voltas and D.C./D.S. into performed order |
| `frontend/auto-score.js`, `lrclib.js`, `lyrics-align.js` | Catalog candidates, synced lyrics, lyric-to-note alignment and screening (45% word match) |
| `frontend/words-score.js` | Builds the words-only MusicXML (60 BPM, 16th-note grid), with learned pitches when present |
| `frontend/melody.js` | Learn notes estimator: Melodia-style harmonic salience on power-weighted spectral peaks, per-word votes, vibrato cue, octave merge |
| `frontend/library.js` | Library client with device fallback while the server library is down |
| `frontend/pitch.js`, `stage.js`, `observation.js` | Mic pitch (YIN), floating window and wake lock, usage counters |
| `scripts/build-catalog.py` | Builds the catalog from the PDMX download (Zenodo 15571083) |
| `scripts/melody-benchmark.mjs` | Learn notes accuracy on 63 real MIR-1K karaoke clips (`--fetch` downloads them) |

## Accounts and outside services

- **Sign-in:** AuthReturn app `score-sing`, invite-only. Your account is an admin of it. It may not accept `http://127.0.0.1`, and this is untested. If it refuses, the page stays on the sign-in screen.
- **Spotify:** your developer app. For local use, add the redirect URI `http://127.0.0.1:<port>/callback.html`. Never put the client secret in this app; it uses PKCE and needs none.
- **LRCLIB** (lrclib.net) is called from the browser with song details only. Rapid batches get rate-limited (HTTP 429).
- **Catalog:** download `score-catalog.tar` from the export, unpack it, and set `SCORE_SING_CATALOG_DIR`. The default path is a Linux path on the old server.

## State and measured results

- Learn notes on real singing (MIR-1K): about **69%** of notes right with voice and band equally loud, **82%** with the voice 5 dB louder, and **46%** with the voice 5 dB quieter. Before tuning it was 20%.
- Real catalog samples:
  - Six popular songs were found and timed from lyrics.
  - 147 of 150 scores with repeats now load.
- You confirmed sign-in and following of desktop Spotify on November 9.

## Open work, in suggested order

1. **Learn notes in real use:** never observed in your own playback. Try it on a *From Zero* track. Check whether the notes look right, and whether the cursor sits on the right word.
2. **Word timing inside lines:** only line starts come from the recording, and words are spread by length. So the cursor and Learn notes can credit the wrong word.
   - Plan: detect sung onsets while listening and store learned word starts with the melody save.
   - Ship only if it beats the length-based spread on a held-out MIR-1K benchmark.
3. **Several notes per word (melisma):** today a word gets one note. Plan: allow a short note sequence when pitch clearly changes inside a word, rendered as slurred notes. Benchmark first, the same way.
4. **Score library database:** the code is done, but no database was provisioned on the server, so scores stay in each browser.
   - Locally you can run PostgreSQL and write the JSON secret (`host, port, database, user, password`).
   - A useful small change would be letting an environment variable choose the secret path, since `/opt/secrets/...` is a Linux path.
5. **Catalog coverage:** recent pop is mostly absent. A possible source is a MIDI melody dataset (for example Lakh MIDI matched to song titles); not started.
6. Repeats using pass-specific notes (`time-only`) are still skipped.

## Rules this project kept

- Never invent a match. Missing scores, timing or notes show as missing ("Words only", × noteheads, "Not saved").
- Audio, tokens and song details never leave the device except where documented. Verification counters are counts only.
- No SQLite or file fallback when PostgreSQL is unavailable; show the outage.
- Every network call has a timeout. Every async action ends visibly as completed, failed, cancelled or timed out.
- Keep the single working surface: no dashboards, tutorials or extra screens.
- Add a regression test for each fix, and bump `VERSION` and `package.json` for each change.

## Files that only mattered on the old server

- `AGENTS.md`: Excessive Code agent policy (keep it for reference; Claude Code does not read it).
- `excessivecode.json`, `plan.md`, `goal.md`, `ledger.jsonl`: deployment manifest and factory records.
- `INTEGRATION.md`: the November 9 Spotify feasibility notes.
- Deployment there was a platform restart API; locally, just run `node server.js`.
