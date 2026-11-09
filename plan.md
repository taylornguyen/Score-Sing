# Score Sing factory plan

Saved window: November 9, 2026 at 4:32 PM UTC through November 11 at 4:32 AM UTC. Existing family cap: $300. Preserve those limits. This plan is written on the first factory-brief turn, before further build work. The initial prototype already exists; do not pretend it was built under a prior plan.

## Full goal

Let someone sing along to streamed music while seeing the musical pitches and score in time with the recording. Preserve the streaming service's own music player and lyrics rather than recreate it. Latest direction is Spotify on Windows desktop and iPhone; Apple Music Sing was superseded. Permission is assumed at the operator's direction. The product is a score companion, not a new streaming service.

The exciting outcome is opening a Spotify song, finding or importing the matching vocal score, establishing the alignment without hand-writing a timing JSON file, and reliably following notes/lyrics through pause, seek and track changes on either screen size. The score must correspond to the actual recording, including introductions, repeats, tempo variation and endings. Missing scores or timing must remain explicit; never manufacture a convincing match.

## Product budget

One working surface: Spotify now-playing state, sheet music with lyrics when supplied, current note, essential connection/import/alignment controls. No extra dashboard, tutorial, marketing, unrelated tabs or audio player. Keep AuthReturn sign-in and private verification. Keep saved scores/drafts safe. Reuse OSMD, existing parsers and Spotify PKCE flow. Existing preview is public-domain sheet music and silent.

## Roadmap and parallel workstreams

### Stage 1 — Baseline (already verified, first 15 minutes)

Published prototype, responsive score rendering, imported MusicXML and recording-specific cue packages, OAuth implementation, six unit checks and browser fixtures. Live Spotify authorization has not occurred. Record this as baseline evidence rather than repeated fresh outcomes.

### Stage 2 — Usable alignment and reliable integration (next 2–6 hours)

1. **Score**: make invalid imports transactional; retain the prior usable score and alignment on failure. Make recording-specific alignment achievable within the existing score surface, using checkpoints or another compact interaction instead of requiring a hand-authored timestamp for every note. Preserve unrelated notation and current behavior. Cover malformed files, rollback and timing round trips.
2. **Fixer/Speed**: audit Spotify OAuth, refresh, rate limits and polling ownership. Fix actionable faults in the owned transport module, add deterministic regression coverage, measure load/render/polling cost, and report exact app-level changes for manager integration. No repeated unnecessary network work, runaway timers, stale highlights or hidden UI errors.
3. **Connection/source**: use documented owner-scoped access and Browser Driver saved login/profile metadata to recover a Spotify developer app and real authorization if available. No messages to other people, password extraction or invented credentials. Determine the smallest legitimate score source/matching route; verify what can be fetched rather than imply a whole score catalog. Save concrete evidence and operator-only sign-in if truly required. No speculative sibling product.

These three child workstreams use isolated Git worktrees with explicit edit ownership. Manager owns plan, goal, ledger, Tasks, release integration, public verification and final report. Only manager deploys. Start with bounded 45–60 minute attempts and resume existing workers for the next stages; do not create duplicate workers.

### Stage 3 — Integrated release and real playback (next 6–12 hours, sooner if ready)

Review each child result, run meaningful tests, merge coherent commits, bump VERSION once per integrated release and publish. Verify HTTPS, authentication, Windows-size and iPhone-size score operation. Connect real Spotify if standing access can supply it. Record true playhead/cursor behavior through seek/pause/resume and song change. A simulated Spotify response cannot satisfy this live outcome. Only the missing account authorization stream may wait on the operator; independent score and reliability work continues.

### Stage 4 — Re-plan from results (remaining window, bounded by useful scope)

Compare the delivered experience with the full goal after each release. Work on concrete exposed defects: score acquisition/matching friction, expressive-timing alignment, excessive load/render latency, data retention, narrow-screen readability or actual observed Spotify incompatibility. Extend the roadmap only with improvements implied by the request. Do not invent features to consume the window. When all agent-actionable work is verified complete and only sign-in/payment/permission remains, request the independent done check using DELETE long-run; do not claim live playback delivery prematurely.

## Verification and measured score

Goal score counts distinct verified product outcomes; baseline is 1 (published private prototype). New points require a new user-facing capability/fix verified through the deployed HTTPS release, not merely a worker finishing, a new test count, or rechecking old behavior. Planned new outcomes: transactional score retention; in-app recording-specific alignment round trip; robust token/rate-limit handling; useful score matching/source route; real Spotify playback alignment. Keep capability boundaries honest. Every completed outcome Task carries its HTTPS evidence. Do not give live Spotify credit until actually connected.

## External dependencies and assumptions

A Spotify developer client ID and authorized Spotify account are not available in saved session state. Browser Driver initially returned an empty configured-login registry. A public client ID can be entered by the operator; never request a client secret. Recover existing account access before declaring it human-only. A score and its display rights are separate inputs; do not infer notes from Spotify metadata. Assume platform permission, as instructed, without claiming independently verified approval.

## Ledger and spending

Record stages/results, tested commits, release receipts and remaining limits in ledger.jsonl and Tasks. Update the Factory report after each ledger step using GET then PUT revision. All-in cost is unknown until sourced; native API-equivalent usage is a budget guard, not cash or all-in spend. Preserve unknown provider/build/hosting tails. No paid generation or new paid service unless necessary within existing authority. No protected instruction edits.

### Stage 4 refinement from integration evidence

The first integrated checkpoint/import release exposed common compressed-score acquisition friction, so standard MXL import was added on the existing control. Independent review then reproduced forged ZIP size truncation; the repair counts actual output, validates metadata and CRC and runs decoding in a terminable worker. Those are product repairs, not a reason to stop the family.

The remaining live outcome cannot be established from fixtures or by extracting Spotify tokens from the operator's browser. Add a small app-authenticated transient observation channel containing only counters (fresh playback samples, following note advances, pause/seek/song changes and safe stopping), never track IDs/titles, scores, tokens or device content. Verification scripts must intercept this endpoint so synthetic transport tests never become live evidence. A bounded background observer can then report actual authorized use after the operator connects Spotify. This is internal verification, with no extra product page or status cards. Preserve the explicit sign-in block until that connection exists.
