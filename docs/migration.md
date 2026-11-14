# Moving Score Sing to another computer

Restore the app and catalog on the destination server, then configure its private sign-in and Spotify redirect URI.

## What the bundle holds

| File | Contents | Restore |
|---|---|---|
| `score-sing.bundle` | Every commit and branch of this repository | `git clone score-sing.bundle score-sing` |
| `score-catalog.tar` | The 33,823-score PDMX lyrics catalog (`index.json` + `mxl/`), about 570 MB | Unpack anywhere outside Git and point `SCORE_SING_CATALOG_DIR` at its `catalog/` directory |
| `SHA256SUMS` | Checksums of both files | `sha256sum -c SHA256SUMS` |

The catalog can also be rebuilt instead of copied: download `PDMX.csv` and `mxl.tar.gz` from Zenodo record 15571083 (about 2 GB) and run `python3 scripts/build-catalog.py --source <download dir> --out <catalog dir>`.

## What does not move

- **Saved scores.** The server score library database was never provisioned, so there is no server copy. Scores are kept in each browser's storage for the current web address and do not follow a new address.
- **Sign-in.** Set a private `SCORE_SING_LOGIN_PASSWORD` and a stable `SCORE_SING_AUTH_SECRET` on the destination server. The local access-code flow has no external identity-provider registration.
- **Spotify.** The developer app (client ID in `frontend/spotify.js`) must list `https://<new address>/callback.html` as a redirect URI. Only the Spotify account owner can add it in the Spotify developer dashboard.
- **Chats and tasks.** These remain with the service that hosted them.
- **Agent working files.** `.private/` (tokens, browser receipts) is not migrated; tokens are minted again on the new server.

## Restore

1. Node.js 24 or newer; `npm ci` in the cloned repository.
2. Unpack the catalog and set `SCORE_SING_CATALOG_DIR`.
3. Configure the destination host's Spotify redirect URI as `https://<new-address>/callback.html`; run `node server.js` with `PORT`, `SCORE_SING_LOGIN_PASSWORD` and `SCORE_SING_AUTH_SECRET` set, behind HTTPS.
4. `GET /api/health` must report `"catalog":{"status":"ok","entries":33823}`.
5. Run `npm test` and the browser checks in the README.
