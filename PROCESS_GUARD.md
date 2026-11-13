# FiveM Launcher 1.3.0 — prevent duplicate normal launches

## Behavior
- Read Windows process names using the existing hidden `tasklist.exe` integration. Detect `FiveM.exe` and `FiveM_*` executables such as build-specific GTA processes. Exclude `FiveM Launcher.exe`, which belongs to this application.
- Poll shared system presence every 3 seconds, refresh on window focus, and provide an explicit process refresh button beneath Play.
- With CL2 off, disable Play while FiveM is running or process detection is pending/unavailable. Show why and restore the button after the game exits.
- With CL2 on for the selected city, permit Play and preserve the existing `-cl2` launch argument. Normal installation, microphone and optional Steam/Discord checks still apply.
- Recheck presence during the click preflight before microphone/cache actions. The backend independently reads processes immediately before normal spawning: active FiveM returns HTTP 409; unavailable process detection returns HTTP 503. CL2 must be the boolean `true` to bypass this check.
- When launching CL2 while another game is running or its state is unknown, skip automatic cache deletion and report the skip. Manual cache cleanup continues to refuse when FiveM is running. Its process matcher now also excludes this launcher itself.

## Verification
- Added failing regression tests first, then verified the fix: `npm test` passes all 28 tests. Mocked spawn tests cover running, stopped, unavailable detection and CL2 without executing a real game.
- `tests/process-ui-smoke.cjs` passes disabled/enabled states, automatic polling after exit, freshly started game during click preflight, unknown-state behavior, CL2 exception, cache skip and normal cache behavior, and mobile overflow.
- `npm run test:ui` passes the existing CRUD, preferences, microphone and launch/cache regression scenarios.
- `npm run test:runtime` passes dev/preview HTML/API and unauthorized mutation checks.
- `tests/live-process-smoke.cjs` detected an already-running real Windows FiveM process, observed a disabled Play button, verified CL2 toggles the button and verified HTTP 409. The API test points at a non-executable temporary fixture rather than the installed game, so it cannot start a real game even if the running process exits during the check.
- Live evidence: `tests/artifacts/process-guard-live.json` and `process-guard-live.png`. No game process was started, terminated or modified; no real cache was deleted.

## Delivery and limits
Installer: `release/FiveM-Launcher-Setup-1.3.0-x64.exe`. SHA256 is in `release/SHA256SUMS.txt`. This release remains unsigned. Do not overwrite the user's installed copy during automated installer lifecycle tests.

Detection is based on Windows executable names. UI polling can take up to roughly 3 seconds plus the process-query time; the backend check is independent of that cached UI state. Actual CL2 game login and joining a city are not part of this verification. CL2 retains the existing GTA V Legacy scope.

Packaged verification: tests/artifacts/desktop-packaged-1.3.0.json confirms runningGameGuard=true, live server banner, sandbox, media permissions, reopen persistence and no page errors. Installer size: 112,919,620 bytes. Installation over the user's existing copy was not performed.

