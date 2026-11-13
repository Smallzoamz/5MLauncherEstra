# Estra FiveM Launcher 1.7.1 — live Game Build and Pure Mode

Before every dispatch, including Play, history replay and Tray's latest city,
the backend queries the destination again and reads `sv_enforceGameBuild` and
`sv_pureLevel`. Values saved by the renderer cannot select the launch settings.
Status requests use no-store/no-cache; no requirements cache is retained.

Direct addresses use their current `info.json`. Cfx join codes resolve the
listing's advertised endpoints and read live `info.json` even when the listing
already supplies every icon/banner. The first responding endpoint owns the
requirements; missing values there clear listing values. Media keeps its
existing fallback rules. Listing-only requirements may still be displayed, but
cannot authorize a launch. The launch check skips banner resolution.

Successful launches include validated `-b<build>` and `-pure_<level>` arguments,
plus optional `-cl2` and one connect URI. Pure level 0 is explicitly included
when the destination has disabled protection. CitizenFX.ini is not rewritten.
The launch response refreshes the city's displayed build and pure level.

If the current endpoint cannot be read, or either requirement is missing or
invalid, dispatch stops with a visible error. No Name change is applied in that
case. Normal launches recheck FiveM processes after the network request and
before Name writes/dispatch. CL2 retains its existing process/Name rules.

## Compatibility and limits

- Build validation accepts the existing four/five-digit build format; pure
  validation accepts 0, 1 and 2. Servers hiding these values or their direct
  endpoint cannot be preconfigured and now produce a visible launch error.
- This prepares the selected build/pure mode at startup; FiveM still owns game
  downloads, updates and connection validation. Other settings (such as pool
  size changes), an unsupported client build, or a server changing again after
  the query can still require another game restart.
- Real joining of a server and the absence of an in-game restart prompt have
  not been verified with a real game. Automated checks execute a harmless
  compiled probe or a mocked dispatch, never the installed FiveM.

## Verification

- `npm test` includes changing requirements between consecutive attempts,
  pure 0, CL2, unavailable/missing/invalid requirements, listing lag, a process
  starting during the query, real loopback HTTP queries and INI preservation.
- `node tests/windows-shell-smoke.mjs` dispatches a harmless compiled WinExe
  through Explorer and checks its exact build/pure/CL2/URI arguments.
- `node tests/requirements-tray.cjs` exercises the real renderer, desktop main,
  local API and Tray with controlled server responses and dispatches. It checks
  changed values on Play and Tray replay, display updates, visible errors and
  history results. Evidence: `tests/artifacts/requirements-tray.json`.
- Packaged shell and history tests accept the generated application's version;
  their evidence is named `packaged-shell-<version>.json` and
  `history-packaged-<version>.json` under `tests/artifacts`.

## FiveM implementation references

- [CrossBuildLaunch.cpp](https://github.com/citizenfx/fivem/blob/master/code/client/launcher/CrossBuildLaunch.cpp): explicit build flags bypass retained INI selection.
- [PureModeState.h](https://github.com/citizenfx/fivem/blob/master/code/client/shared/PureModeState.h): the startup command line supplies the pure level.

Source backups for this change are under
`.backups/server-requirements-25691030-131705/`.

## Verified release — 2026-10-30

- `npm test`: 60/60 passed, including seven new requirement regressions. All six
  initial requirement regressions failed against the original implementation.
- `npm run build` and `npm run test:runtime`: passed, including development and
  preview HTML/API access and unauthorized launch rejection.
- Browser checks passed: `ui-audit.cjs`, `ui-success.cjs`, `history-ui.cjs` and
  `process-ui-smoke.cjs` (CRUD, launch success/errors, microphone, cache order,
  history replay, process guards, CL2 and responsive layouts).
- Electron checks passed: `requirements-tray.cjs`, `tray-smoke.cjs` and
  `history-tray.cjs`, with no renderer page errors.
- Standalone Explorer probe passed exact build/pure/CL2 arguments and rejected
  malformed switches before dispatch. Packaged Explorer probe passed the
  corresponding checks from ASAR; packaged history/Tray preflight passed on
  version 1.7.1. Evidence: `packaged-shell-1.7.1.json` and
  `history-packaged-1.7.1.json` under `tests/artifacts`.
- Read-only live query at 2026-10-30 13:24 Bangkok: Noxtis
  `89.38.101.136:30120` reported Online, build 3095, pure 0 via Direct HTTP.
  Evidence: `tests/artifacts/server-requirements-live.json`.
- `npm run dist:win`: produced
  `release/Estra-FiveM-Launcher-Setup-1.7.1-x64.exe` (116,916,587 bytes).
  The packaged backend and PowerShell helper were compared byte for byte with
  the verified source. SHA-256:
  `41a35060db73444c555627a5a48b1d6f2fff75d1518e269dca7e2189dd640735`.
- No real game was launched. No installation over the user's existing app was
  performed. Real server joining and restart-prompt behavior remain unverified.
