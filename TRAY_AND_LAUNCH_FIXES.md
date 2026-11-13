# Estra FiveM Launcher 1.5.0

## Diagnosis and implementation

1. The screenshot reports “This application should be launched directly from the shell or a web browser.” Version 1.4 dispatched FiveM directly as a Node/Electron child with `+connect` and treated process creation as success. Version 1.5 delegates to the running Windows Explorer desktop's ShellExecute, supplies a validated `fivem://connect/…` argument and retains optional `-cl2`. The configured installation path is used; no protocol registration or FiveM configuration is rewritten. The exact FiveM internal rejection was not reproduced against the user's active game.
2. Live `info.json` checks on 2026-09-05 found no `banner_detail` or `banner_connecting` for Mystic Academy (`147.50.229.43:30120`) or Wiz Chronicles (`join.wizchronicles.com:30120`). Noxtis publishes an ImgBob share URL which is resolved to its actual image. Missing banners now use a deterministic city theme with that city's actual icon, explicitly labelled CITY THEME. These are not official server banners. A saved per-city custom HTTP/HTTPS image URL overrides automatic banners; clearing it restores automatic behavior. Broken images fall through to detail, connecting, then theme. Cfx endpoint enrichment continues to the second advertised endpoint when the first supplies only an icon.
3. Main-process Tray and session monitoring run independently of the hidden renderer. Successful shell dispatch hides the window; dispatch failure leaves it visible. Clicking the tray icon or launching Estra again restores it. Native close/Alt+F4 hides to Tray; explicit “ปิดโปรแกรม” in the window menu or “ออกจากโปรแกรม” in the Tray exits Estra. The normal minimize action still minimizes to the taskbar. Startup with Windows is not enabled.

## Session behavior

- Poll every 2 seconds only while tracking a requested launch. Observe primary FiveM/bootstrap/game PIDs, excluding lingering browser, ROS, and crash helpers.
- Capture pre-existing PIDs before CL2 so an old game cannot falsely confirm the new launch. Further authorized CL2 launches while an owned game is running remain allowed by the backend guard; restore after the tracked games finish.
- Allow a 12-second absence interval for bootstrap/build handover before restoring. Restore with a message if no new game appears within 90 seconds, or process enumeration fails continuously for 15 seconds. A failed baseline read permits a backend-authorized launch but keeps the window visible because tracking is unavailable.
- Explicit quit cancels monitoring and closes the local backend. No game process is killed. A shell dispatch is not a claim that a server connection succeeded.

## Verification

- `npm test`: target validation, launch dispatch/guard, CL2, lifecycle/handover/timeout/error/concurrency, cache safety, banners and persistence regressions.
- `node tests/windows-shell-smoke.mjs`: compiles a harmless WinExe fixture named FiveM.exe in an isolated workspace directory (including spaces, ampersand and apostrophe). Real Windows shell dispatch confirms parent `explorer`, no console, and exact normal/CL2 URI arguments. Never executes the installed FiveM.
- `node tests/tray-smoke.cjs`: real Electron main, real Tray, native window lifecycle, IPC and local HTTP API; controlled process enumeration and launch adapter. Covers hide, tray restore, failure, exit, startup timeout, CL2 and explicit quit. Harness lives only under tests and is excluded from the installer.
- `node tests/city-background-live.cjs`: real Mystic/Wiz/Noxtis responses and rendered sources; custom image persistence, removal, URL validation. Screenshots and JSON in `tests/artifacts/city-*-1.5.0.*` and `city-background-1.5.0.json`.
- Existing UI, microphone, cache, process guard, banner race, reduced-motion and responsive checks run against the built UI. Runtime checks exercise Vite dev and preview APIs.
- Installer built with `npm run dist:win`; packaged application checked separately with isolated test profiles, preserving the live user profile.

## Delivery and limits

`release/Estra-FiveM-Launcher-Setup-1.5.0-x64.exe` is the Windows x64 NSIS installer. `release/win-unpacked/Estra FiveM Launcher.exe` requires its adjacent runtime files. Product/process name, frameless UI, icon, application ID and existing profile migration remain unchanged.

The user's FiveM was already running during this work. No real game was closed, cache deleted, or new server connection triggered. Real in-game launch/connection and the full real-game close/restore cycle still require trying the new build when the current game session is finished. The installer is unsigned; this pass does not overwrite the user's installed app or shortcuts through an automated install/uninstall test.

## Primary references

- [Electron Tray](https://www.electronjs.org/docs/latest/api/tray) and [Tray lifecycle guide](https://www.electronjs.org/docs/latest/tutorial/tray).
- [Cfx server configuration](https://docs.fivem.net/docs/server-manual/setting-up-a-server-vanilla/) documents optional detail/connecting banner URLs.
- [Cfx launch-error report](https://forum.cfx.re/t/this-application-should-be-launched-directly-from-the-shell-or-a-web-browser/2452481) reports the same symptom for direct command-line connect. The actual helper behavior is verified locally instead of assuming a shell API guarantees acceptance.
- [Cfx CL2 implementation](https://github.com/citizenfx/fivem/blob/master/code/client/shared/CL2LaunchMode.h) and [link-protocol IPC](https://github.com/citizenfx/fivem/blob/master/code/components/glue/src/LinkProtocolIPC.cpp).
