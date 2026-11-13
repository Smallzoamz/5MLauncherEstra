# Estra FiveM Launcher 1.6.0

## Changes and usage

- **Name in FiveM:** the former private-note field now supplies the selected city's Name when Play is clicked. Blank keeps the current FiveM name. The backend updates the `nickOverride` setting for `https://nui-game-internal` in FiveM's existing NUI Local Storage database before dispatching the game. This is the setting used by the menu's nickname override, rather than assuming `cl_nickname` overrides Steam. The actual key was located in the installed FiveM profile during read-only inspection. The source code's `checkNickname` handler calls `SetPlayerName`, which is used in connection data.
- **Offline:** connection refusal/reset, destination lookup/reachability failure, timeout, and a missing Cfx listing are displayed as Offline with cleared live counts. Malformed responses and API problems remain Unknown/“ตรวจสอบไม่ได้”. Offline describes reachability from this machine; it is not independent proof of a global outage. Selected-city polling and manual refresh update the result.
- **Current Steam profile:** reads `ActiveUser` from the running client's registry state, matches only that SteamID in `loginusers.vdf`, and loads its cached avatar. It checks ActiveUser again after reading so switching accounts cannot return the previous user. An absent cached image uses initials; another remembered user's picture is never used.
- **Current Discord profile:** the user-provided Estra Application ID `1545873345596096734` is used for local RPC handshake. READY supplies the current user and avatar hash. No user token, client secret, message database or chat history is read; no activity is published. Profile reads repeat with the existing presence poll. Errors preserve the program's running state while reporting that its account could not be read.
- **Maintenance:** Settings → จัดการไฟล์ FiveM → ตรวจไฟล์และขนาด → select categories → ล้างประเภทที่เลือก. The preview shows actual file count/size. Logs, crash reports, and FiveM Shader/GPU cache can be selected separately. Cleanup recomputes its own allowlist and never trusts paths returned by the UI.

## Name persistence and safety

The small `classic-level` 3.0.0 dependency provides LevelDB's exclusive lock, atomic batch and synchronous write. Its Node-API binary is bundled for Electron. The installation entry path is resolved to its real location so an installation relocated to another drive through a junction is supported. Paths inside that installation are still checked for links/junctions. The code requires the existing supported Chromium database version and origin metadata, validates the name and updates only its key plus the origin size/timestamp metadata. The previous name and affected metadata are saved under `FiveM.app/estra-backups/nickname-*.json`; unrelated profile data is not copied into that backup. Reapplying the same name creates no additional backup.

FiveM must be closed before applying a name. If CL2 is starting while another FiveM instance is open, leave the Name field empty to use the current name. The launcher rejects changing Name in this case instead of writing to a live profile. No game process is forcibly terminated. When the profile is missing or uses an unsupported format, launching with a requested name stops with an actionable error rather than rebuilding the database.

The old launcher-local field remains `inGameName` for preference compatibility. Existing saved text therefore becomes the requested Name for that city; the UI label and help text now describe this behavior. Names are not interpolated into PowerShell or FiveM command strings.

## Cleanup boundaries

- Log: `FiveM.app/logs`.
- Crash reports: `FiveM.app/crashes`.
- Shader/GPU: `FiveM.app/data/cache/shaders`, `data/cache/shader-cache`, and known GPU/Shader cache directories under `data/nui-storage` and validated `context-server_<number>` folders.
- Game storage, server cache, Local Storage, IndexedDB, cookies, game configuration, nickname backups and global GPU-driver caches are outside this cleanup allowlist. The existing separate server-cache action remains available.
- A running FiveM or unavailable process detection blocks deletion. Process state is checked before and after measuring files; all selected targets are validated before the first delete. Junctions and links are rejected. Per-target failures report partial results.
- The UI disables path changes, duplicate cleanup and closing the Settings modal (including Escape) during the operation. Preview is required before the selected cleanup button becomes available.

## Evidence — 2026-09-06

- `npm test`: 49 tests, including real local-server Online → Offline behavior, name-before-dispatch ordering, Unicode validation, live-game exclusion, category boundaries, repeat cleanup, relocated installation entry paths with internal junction rejection, Steam account switching and fragmented/oversized/timed-out Discord IPC.
- `tests/nickname-browser-smoke.mjs`: an isolated real Chromium profile reads the updated nickname after restart, including Thai and emoji. An unrelated preference is unchanged; locked databases are rejected and backup/idempotency are verified. The user's FiveM profile is not changed by this test.
- `tests/release16-ui.cjs`: real Steam/Discord profile data and avatar images rendered; Offline/Unknown transitions; Name sent in launch request; maintenance preview/selection/busy handling; widths 1280/900/390/320. Launch and cleanup transport are fixtures.
- Existing UI, microphone, process guard, banner animation/race and Tray regressions pass. Vite dev/preview runtime check passed on rerun after one transient connection-reset failure during concurrent verification.
- `tests/packaged-release16.cjs`: verifies the native database writer from the packaged app against an isolated fixture, real current profile rendering, protected cleanup API and read-only maintenance preview on the actual installation.
- `tests/desktop-smoke.cjs` and `tests/window-smoke.cjs`: packaged-app sandbox/origin, persistence, microphone permissions, frameless controls, Tray restore and actual running-game guard.
- Windows x64 installer: `release/Estra-FiveM-Launcher-Setup-1.6.0-x64.exe`. Summary and checksum: `release/verification-1.6.0.json` and `release/SHA256SUMS.txt`.

The current Steam display name was OHMPHIENG and Discord display name OHM at verification time; these are live account values, not hardcoded labels. No real game launch, installed-profile name change or deletion of the user's Log/Crash/Shader files was performed during verification. In-game connection and the final FiveM Settings display must still be checked when the user next launches the game through Estra. Installer upgrade was not run over the user's existing installation; the installer remains unsigned.

## References

- [Discord RPC handshake and READY](https://docs.discord.com/developers/topics/rpc).
- [Cfx nickname loading and changeName handler](https://github.com/citizenfx/fivem/blob/master/code/components/glue/src/ConnectToNative.cpp) and [NetLibrary name precedence](https://github.com/citizenfx/fivem/blob/master/code/components/net/src/NetLibrary.cpp).
- [Chromium Local Storage metadata schema](https://chromium.googlesource.com/chromium/src/out/+/d8f81827fae6ffc15166ce1dcb0000d337a0130f/mac-Debug/pyproto/components/services/storage/dom_storage/local_storage_database_pb2.py).
- [classic-level locking and Electron support](https://github.com/Level/classic-level).
