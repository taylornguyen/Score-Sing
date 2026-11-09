# Reliability and performance ledger

## Baseline, November 9, 2026

The dominant static asset is the vendored OSMD renderer: 1,459,236 bytes uncompressed. Current app, CSS and Spotify transport together are under 30 KB before compression. Actual browser-transfer and first-render timing must be measured on the deployed HTTPS origin; byte size is not a latency measurement.

The main cursor loop currently runs every 100 ms and allocates `entries.map(x => x.at)` on each tempo-based tick. The manager reported this to the Score worker for a cached timestamp array and appropriate visibility/ownership behavior. Browser fixtures verify desktop, 390 px phone layout, dark/light palette, actual OSMD SVG rendering, pause/seek/song mismatch and malformed import; they do not prove physical-device speed or Spotify live playback.

## Transport changes under test

- Coalesce overlapping playback reads and token refreshes.
- Disconnect aborts owned fetches and invalidates generations so a late refresh cannot restore a disconnected session.
- Token responses and stored sessions require valid shape; malformed successes never become a plausible connected state.
- PKCE callback is single-use, validates verifier/client/redirect/time/state, and rejects future or corrupt pending state before networking.
- Playback has a 15-second overall deadline with 12-second per-request deadlines, including response-body parsing.
- Respect numeric or HTTP-date Retry-After values inside the transport so refocus cannot bypass rate-limit ownership.
- Invalidated refresh clears the session; no silent reuse of revoked credentials.

Twelve transport regression cases were added to the existing six checks. Score fixture tests also passed with a properly formed stored-session fixture. These fixes need integrated HTTPS release verification before they count as newly delivered goal outcomes.

## Published verification, release 548c8a9

A single Chromium desktop navigation from the app box to the HTTPS origin measured about 1.7 s total navigation and 1.4 s DOMContentLoaded. The renderer transferred about 1.46 MB in 220 ms; app.js about 12 KB in 60 ms. These are one controlled cloud-browser sample, not operator-device or broad performance statistics. No horizontal overflow was observed at 1440 px or after switching to 390 px.

A separate isolated context executed the actual published transport script with a synthetic delayed token response. Disconnect rejected the pending read and the late response did not restore a session. The real deployed connection dialog showed the exact registered callback URI. This proves the released race fix and UI wiring, not actual Spotify playback. Browser Driver does not document network-interception actions; private Playwright was used specifically for the delayed-response fixture that requires interception, while ordinary signed-in/live-page checks use Browser Driver.
