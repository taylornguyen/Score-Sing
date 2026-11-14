# Connection and score-source evidence · November 9, 2026

## Spotify owner access

The session-bound Browser Driver `GET /api/logins` returned an empty configured-login list. A subsequent profile-metadata request failed in the provider; reading its saved request confirmed failure, so that request supplies no evidence about whether profiles exist. It was not repeatedly submitted.

A supported Browser Driver session successfully navigated to `https://developer.spotify.com/dashboard` and was redirected to Spotify's sign-in page. The rendered page offered Email, Google, Facebook and Apple login. No known owner identity, saved login reference or exact-account browser profile was supplied, so no credential/SSO identity was invented and no unsolicited device prompt or account signup was triggered. The first-party Spotify developer-dashboard client ID in that redirect belongs to Spotify itself and must never be reused as Score Sing's OAuth client ID.

Evidence run: https://browser-driver.aisloppy.com/runs/s_06c1fb6a4e2df858

Human-only dependency: sign in to the owner's Spotify developer account and provide its application client ID, with `https://<deployment-host>/callback.html` registered. The account then approves the actual playback-read scope in Spotify. There is no need to supply a client secret to this application.

Current development-mode requirements are documented at https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide : Premium app owner, one new client ID per developer, five users (existing apps may be grandfathered). Older general app pages still describe a larger app count; use the migration guide for current new-app limits. A client ID or user OAuth grant is not claimed to establish the platform permission that the operator directed us to assume.

## Sources that can actually supply notation

- **OpenScore Lieder**: the primary corpus https://github.com/OpenScore/Lieder releases scores under CC0, with composer/work/song metadata and lyric text. Its repository contains MuseScore `.mscx` sources; the README documents converting them with MuseScore to `.mxl`/MusicXML. It is nineteenth-century vocal repertoire, not a pop catalog or recording-specific alignment database. It is a legitimate source, not an automatic Spotify recording match. No file was converted or claimed imported during this investigation.
- **Flat**: documented REST API https://flat.io/developers/docs/api/ can browse/export an authorized user's scores and import MusicXML/MIDI. It requires an account/PAT or OAuth registration. An additional account integration is unnecessary while local MusicXML import already performs that path. It does not establish catalog or exact-recording matching rights.
- **MuseScore.com**: https://musescore.com/legal/terms documents MusicXML export for eligible scores, with score-dependent access and download restrictions. A subscription does not grant arbitrary automated extraction or redistribution. Direct MusicXML imports of the operator's legitimately obtained files avoid private endpoints and invented API access.
- **Musicnotes**: https://api.musicnotes.com/ describes its licensed digital-sheet-music products but is not evidence of an open MusicXML/Spotify matching API. Do not infer one from the hostname or build an unauthorized scraper.

## Implementable product direction

The immediate high-value route is good MusicXML import plus in-app checkpoint alignment/export. This works with any legitimately obtained vocal score and avoids creating an unverified score catalog. An automatic library can be implemented later only against an explicit available source and actual requested repertoire; song title equality alone is insufficient because key, edition, vocal arrangement, repeats, intro and live/studio recording can differ. For a specific supplied recording and score, real playback authoring is the bounded next step.
