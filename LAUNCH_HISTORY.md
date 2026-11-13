# Estra 1.7.0 — Launch history and last-city shortcut

Scope: keep the most recent 50 launch attempts in this local application's existing stable profile. Record the city snapshot, timestamp, PLAY/CL2 and dispatch result. Do not infer connection success, character identity, play time or crash cause from a process starting or closing.

Implementation plan:
1. Bounded history store with validated records, visible persistence failures and interrupted-attempt recovery.
2. One shared launch preflight for the Play button, history rows and the Tray shortcut; application-wide duplicate guard and a snapshot of the chosen configuration.
3. History dialog with empty state, replay and explicit clear confirmation. Deleted cities or changed addresses cannot replay stale targets.
4. Restricted main/preload messages for publishing a Tray label and requesting the current last city. Main never receives or executes a destination supplied by that message.
5. Unit, browser, native Tray and packaged-app checks, then a Windows x64 installer.

The latest city means the latest successful dispatch. A failed attempt does not replace it. Replaying uses the current saved city settings, including Name and CL2. A deleted or retargeted latest city disables the shortcut until another dispatch succeeds. History records remain readable and clearing history leaves favorites/preferences intact.

History is stored locally under `fivem_launcher_launch_history_v1`. It contains no Steam/Discord account information, player nickname, microphone selection or installation path snapshot. Error text comes from the launch operation and may mention local paths. No history is uploaded. An interrupted record means the final outcome is unknown; it is never reported as success or confirmed failure.

Verified on 2026-09-06:

- `npm test`: 53/53 tests. New coverage includes the 50-record limit, persistence, interrupted outcomes, malformed/denied storage, missing/changed cities, current settings and shared launch guards.
- `tests/history-ui.cjs`: success/failure display, persistence, duplicate prevention across city switches, current CL2 on replay, changed endpoint rejection, clear confirmation with favorites preserved, no overflow at 1280/900/390/320 and no page errors. Screenshots and evidence are under `tests/artifacts/history-*1.7.0*`.
- `tests/history-tray.cjs`: actual Electron Tray menu, double clicks dispatch once, process guard, current CL2, disabled shortcut while a modal is open or a city is deleted, and rejected untrusted/malformed IPC. Game process/dispatch are controlled fixtures; the user's game is not launched.
- `npm run test:ui`, `tests/process-ui-smoke.cjs`, `tests/tray-smoke.cjs`: existing city/settings/microphone/cache/CL2/Tray paths remain passing.
- `tests/history-packaged.cjs`: the built 1.7.0 executable restores from Tray, invokes real preflight, rejects an intentionally missing installation, records the failure and preserves it across reload. Its initial successful history item is seeded test data, not a real game launch.
- `tests/desktop-smoke.cjs` and `tests/window-smoke.cjs`: packaged sandbox, origin, microphone permissions, persistence, frameless controls and Tray lifecycle.
- Packaged runtime files match the current source/build byte for byte, and test harnesses are excluded. `release/verification-1.7.0.json` records the installer SHA-256 and evidence files.

Installer: `release/Estra-FiveM-Launcher-Setup-1.7.0-x64.exe`. It is unsigned. No real FiveM launch, live user-history modification, real cache deletion or installation over the user's existing launcher was performed in verification.
