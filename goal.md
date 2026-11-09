# Goal

A Spotify companion for Windows and iPhone that follows the actual streamed song with readable sheet music, lyrics supplied by the score and current-note highlighting, without replacing Spotify playback.

Done means the score/import/alignment and playback handling are verified in the deployed product, and actual Spotify play/pause/seek/song-change behavior is observed on an authorized account. If the only remaining work requires operator sign-in/payment/permission, preserve that exact block and submit the factory's independent done check without claiming unobserved behavior.

Measured goal score: distinct verified user-facing outcomes. Initial baseline 1 = published private prototype (cefb2f7). Planned new outcomes are listed in plan.md. Report only newly verified outcomes and append score points.

Deadline: 2026-11-11T04:32:55Z. Family budget: $300. All-in spend currently unknown; saved native usage is not all-in cost.

Latest verified outcome score: 14 (baseline prototype, transport/disconnect ownership, transactional score retention, in-app checkpoint timing/export, compressed score import, floating always-on-top score, on-device pitch feedback, automatic catalog scores timed from lyrics, words-only scores for uncatalogued songs, repeat unfolding, Learn notes, Learn notes accuracy on real singing, library outage sync, vibrato cue for sung notes). Released product code: 664a92c (0.13.1). The operator confirmed sign-in and desktop Spotify tracking on 2026-11-09. Open: the cross-device score library waits on platform PostgreSQL provisioning (root); Learn notes has not been observed on the operator's own playback.
