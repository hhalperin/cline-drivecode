# org-migration · what the move unblocks, and what it does not

The point of the migration is to test the web app and the mobile app. This page
separates the things the org move actually gates from the things it does not, so
neither waits on the other. Back to [README](README.md) ·
[cutover.md](cutover.md).

## The honest split

| Blocked by the org move | Not blocked by it |
|---|---|
| A public beta tag a tester can clone ([`drive-beta-release` is guarded to the personal repo](inventory.md#the-release-path-is-guarded-against-the-org)) | Running the web app locally — works today from either repo |
| `cline.drivemode.ai` as a shareable URL | The [drive-web](../drive-web/README.md) phase 1 stage bug — a code problem in the webview |
| Install docs that point somewhere we control | The MC1 call verbs still open in [mobile-consumer](../mobile-consumer/README.md) |
| One place for testers to file issues | Building the iOS app — needs a Mac, not an org |

**Start local testing now.** It needs none of this plan.

One dependency runs the other way, and it is easy to miss: the org repo is 81
commits behind, and **#216 / #217 — the entire `?app=1` consumer shell and the
iOS fixture demo — are in that gap** ([inventory.md](inventory.md)). Anyone
testing the mobile path against `drive-mode/cline-drivecode` today is testing a
build that does not contain it. Phase 1 is a prerequisite for phase 5, not a
parallel track.

## Test the web app locally — today, no migration required

```bash
git clone https://github.com/hhalperin/cline-drivecode.git   # org, after phase 3
cd cline-drivecode
bun install --frozen-lockfile
bun run build:sdk        # not optional — packages resolve through dist/
bun run preflight        # every line ok | warn | FAIL
bun run --cwd apps/cline-hub dev
```

`build:sdk` is the step people skip; without it the hub fails with
`ERR_MODULE_NOT_FOUND`. `preflight` is the fastest way to find out why.

> **Toolchain.** `package.json` pins Bun **1.3.13**; CI installs exactly that.
> A tester on 1.3.11 gets warnings that read like failures. Phase 3 adds this to
> [install.md](../../../../reference/install.md).

### Routes worth opening

| Route | What it exercises | Credentials |
|---|---|---|
| `/drive?app=1` | **The consumer shell.** Hub nav dropped, Join/Continue lobby, thin 44 px reach strip | none |
| `/drive?demoShareScreen=1` | The credential-free Spotlight demo — the seam [drive-web](../drive-web/README.md) widens into the whole app | none |
| `/status?demoPlans=1&statusMode=dependency-map` | Status Hub dependency map, incl. the **Now · consumer path** plan | none |
| `/drive` | The real call loop | **provider key** |
| `?demoChatFork=1`, `?demoSessions=1` | Chat-fork audit, session rollups | none |

Every demo adapter sits behind a composition-root flag; none of them fake a
result on the credentialed path.

### Web gates (phase 4)

Phase 4 ships the hostname. These are its gates — W1–W3 belong to
`drive-mode/site`, W4–W5 to this repo.

| # | Gate | Verify |
|---|---|---|
| W1 | `https://cline.drivemode.ai` serves over valid TLS **on its first request** | Parent HSTS is `includeSubDomains; preload`, so there is no HTTP fallback. DNS and the Pages custom domain must land together |
| W2 | Its own `_headers` sends `microphone=(self)`; camera and geolocation still denied | `curl -sI https://cline.drivemode.ai \| grep -i permissions-policy`. The parent site sends `microphone=()`, which is **fatal for Drive** and fails as a silent bug, not an error |
| W3 | A bad Drive deploy cannot take down `drivemode.ai` | Separate Pages project (`drivemode-cline`), not a path on the existing one |
| W4 | The 47-beat demo plays on a phone with no console errors | Published from `build-artifact.mjs` output — **not** a vendored `dist/` in `site` |
| W5 | Stage ≥ **320 px** tall at 1280×640, both themes, feed open | [drive-web](../drive-web/README.md) phase 1. Measured at 9 px today against the canvas's 370 px. **This is a code gate and it does not move because we changed orgs** |

W5 is the one to watch. Publishing a prototype whose stage is 9 px tall is
worse than not publishing — it is the drift that
[hosted-preview](../hosted-preview/README.md) was written to stop repeating.

Local equivalent of W2 already holds: the hub sends
`permissions-policy: microphone=(self)` on its HTML responses
(`apps/cline-hub/src/server/http.ts:19`). Hub headers do **not** travel with a
static deploy, which is exactly why the site needs its own.

## Test the mobile app

Two surfaces, two very different readiness levels. Be honest about which is
being demoed.

### PWA — the path that is actually testable

The manifest ships (`apps/cline-hub/src/webview/public/manifest.webmanifest`):
name **Cline Drive**, `start_url` `/drive?app=1`, `display: standalone`.

Today, over the local hub on a phone on the same network:

1. Open the hub's LAN URL on the phone, go to `/drive?app=1`.
2. Add to Home Screen.
3. Launch from the icon — standalone window, no browser chrome.

| # | Gate (phase 5 / MC3) | Notes |
|---|---|---|
| M1 | Usable at **360×640** portrait, one hand | MC1. Time-to-first-watch under one viewport of chrome |
| M2 | No Settings / MCP in the default chrome | `?app=1` drops hub nav — shipped in #216 |
| M3 | Standalone window runs the call shell | Manifest ships; verify the launched window, not the tab |
| M4 | Mic policy verified on `cline.drivemode.ai` | Depends on **W2**. A PWA cannot ask for a mic the header denies |
| M5 | Cold open: sees agent work, can raise a hand / speak, no account | MC2 — the guided-tour overlay is still open work |
| M6 | Landscape two-column; raise-hand banner; Preview chip | MC1 partial today |

M5 and the landscape half of M6 are **open MC work**, not migration work.

### iOS — fixtures only, and it needs a Mac

`apps/drive-ios` is a SwiftUI shell over `DemoSession` / `DemoData` fixtures:
Open · Home · Browse · Call · Approval · Settings. **No hub transport.** It is
for on-device iteration and store-later, not a second product.

```bash
open apps/drive-ios/Drive.xcodeproj    # Xcode 15+, iOS 17 SDK
# Target → Signing & Capabilities → set your Team (bundle id ai.cline.drive)
```

Requires macOS. It cannot be built on Linux or in CI as configured — say so
when scheduling the demo rather than discovering it on the day.

No Mac? The presenter HTML runs the same loop:

```bash
cd docs/drivecode/design/wireframes && python3 -m http.server 8765
# http://127.0.0.1:8765/mobile-drive-ios-demo.html
```

When you add an iOS-only affordance, update
[multi-device/MATRIX.md](../multi-device/MATRIX.md) — the parity matrix is the
guard against the product quietly forking per device.

## The two gates no amount of migration clears

[MVP-beta.md](../../delivery/MVP-beta.md) lists what still needs a human. Both
survive the org move untouched, and both are about the *real* call, not the demo:

1. **A credentialed call has never been made.** No API key has been entered. The
   no-credential demo route is verified end to end; the real leg is not.
2. **Nobody has listened.** Voice was verified by instrumented playback —
   `speechSynthesis` transitions, deafen cutting in 63 ms, generated WAVs
   decoding at peak 0.89 — but by ear, never.

These are the highest-value things a human can do this week, and they need
nothing from this plan. Doing them **before** phase 4 is the right order: a
public preview whose defining feature has never been heard is not a preview.

## Suggested order

| Do now, in parallel with phase 0–1 | Then |
|---|---|
| Local `?app=1` on a real phone | Phase 1–3 (the migration) |
| A credentialed call — MVP gate 1 | Phase 4 W1–W3 (hostname, headers, isolation) |
| Listen to it — MVP gate 2 | [drive-web](../drive-web/README.md) phase 1 → W5 |
| | Phase 4 W4, then phase 5 M4–M6 |

The migration and the product work do not contend. The only ordering constraint
that genuinely binds is **phase 1 before phase 5** — the org repo does not yet
contain the mobile shell.
