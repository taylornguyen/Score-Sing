# Score Sing integration investigation

Current operator direction: use an existing streaming app rather than recreate karaoke. Explore Spotify desktop on Windows and Spotify on iPhone. Apple Music Sing was an earlier approach, superseded by the Spotify investigation. The operator subsequently said “Assume permission.” Proceed with the Spotify companion under that explicit assumption; this is not a claim of verified Spotify approval. See README.md for the implemented integration and remaining live-account check.

## Findings verified November 9, 2026

| Target | Supported technical route | User experience | Unverified |
| --- | --- | --- | --- |
| Windows Spotify desktop | OAuth-authorized Web API currently-playing endpoint returns track and progress_ms. A separate companion webpage can consume these observations. | Spotify lyrics and score can occupy adjacent windows. | No account connected and no desktop runtime test performed. |
| iPhone Spotify | Same Web API for a browser companion; native iOS App Remote also exposes track, playbackPosition and paused state. | Spotify can supply playback behind a foreground companion. Displaying native Spotify lyrics and the companion simultaneously is not established. | No device test or app authorization performed. |
| Windows native alternative | Windows.Media.Control exposes sessions integrated with SystemMediaTransportControls, including timeline APIs. | Local companion outside Spotify. | Spotify-specific timeline fidelity has not been tested. This is not a permission workaround. |

## Platform permission assumption

Spotify Compliance Tips explicitly lists synchronizing platform recordings with lyrics among disallowed uses. Developer Policy section III prohibits synchronization with visual media. Applying that broader rule to timed notation/highlighted sheet music is an inference; no explicit sheet-music exception was found. The operator explicitly directed implementation assuming permission; do not keep this as an implementation blocker or claim that permission has been verified. An OAuth grant, Premium subscription, OS media API, or private prototype does not itself establish that permission.

Spotify does not supply a documented public lyrics API (confirmed by Spotify staff) or a sheet-music endpoint in its current API reference. The score, rights to display it, and timestamps aligned to the exact recording must come separately. A composition or recording title alone is insufficient: studio/live versions, repeats and introductions can differ.

A separate manual score viewer is a different, reduced product: it cannot satisfy automatic note-by-note synchronization. Do not silently substitute it for the requested app.

## Implementation if authorized

Prefer a single responsive companion website with Spotify OAuth PKCE and only the permissions needed for the chosen functions. Keep playback in Spotify. Use recording identity to select a separately authorized MusicXML/PDF and alignment map. Reconcile timing after seeks, pauses, track switches and reconnects. Never show a guessed cursor for stale, missing or mismatched playback data. An iOS-native app is optional, not prerequisite for a cross-device Web API companion.

Development mode currently requires a Premium app owner and allows up to five allowlisted authenticated users; broader distribution has separate eligibility/review. A Spotify developer client ID and account consent remain required for live playback. Browser Driver’s saved-login registry returned no configured logins during this session.

## Sources

- Spotify iOS SDK: https://developer.spotify.com/documentation/ios
- iOS player state: https://spotify.github.io/ios-sdk/html/Protocols/SPTAppRemotePlayerState.html
- Currently playing: https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track
- Developer policy: https://developer.spotify.com/policy
- Compliance tips: https://developer.spotify.com/compliance-tips
- Quota modes: https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- Spotify staff on lyrics API: https://community.spotify.com/t5/Spotify-for-Developers/Update-endpoint-for-lyrics/td-p/5355493
- Windows media sessions: https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager
- Apple system-player reference (earlier route): https://developer.apple.com/documentation/musickit/systemmusicplayer

## Work boundary

The factory is saved through November 11, 2026 at 4:32 AM UTC with its existing $300 family cap. Permission is assumed per operator. Continue implementation and tests; live Spotify authorization and exact-recording score data remain external inputs. No connected Mac is available in this session's companion inventory, and no Windows/iPhone execution connector was discovered. Browser identity is not proof of access to the device.
