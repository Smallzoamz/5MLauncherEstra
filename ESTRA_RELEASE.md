# Estra FiveM Launcher 1.4.0

## Requested changes
Remove the native Windows title bar/frame, rename the application and executable process to Estra FiveM Launcher, and create a sharp, distinctive app logo/icon.

## Implementation
- Electron `frame: false` removes the visible native title bar and controls. Desktop CSS removes the surrounding page padding, border and rounded container so the UI fills the window.
- The blank top header is a drag region; buttons and the window menu are explicitly excluded. A compact ellipsis menu inside the UI offers minimize, maximize/restore and close. Escape dismisses it. Standard Alt+F4 remains available.
- A sandboxed preload exposes only three fixed window commands. Main-process handlers require the application's own top-level webContents/frame and `launcher://app` origin; no generic IPC API is exposed. Node integration remains disabled and context isolation remains enabled.
- Product name, package metadata, window/document titles, executable, installer, shortcut and uninstall display names are Estra FiveM Launcher. Existing app ID and `launcher://app` origin remain stable.
- The previous packaged app's name was `fivem-launcher-prototype`. Both userData and sessionData explicitly retain that legacy folder under appData, preserving existing favorites and settings without copying or rewriting the user's live profile. Test runs use separate automation profiles.
- The icon and logo are original SVG geometry. Multi-size PNG/ICO exports are generated from the SVG and included in the app and installer. See `public/brand/BRAND_GUIDE.md`.

## Verification
- Unit/backend tests: 28 pass. Existing browser CRUD, preferences, microphone and launch/cache regression tests pass. Dev/preview runtime checks pass.
- `tests/window-smoke.cjs` verifies native content bounds equal the full window bounds (no titlebar/non-client space), zero desktop padding/border, drag/no-drag regions, the restricted bridge, rejection of an untrusted sender, and actual menu minimize/maximize/restore/close.
- Win32 WS_CAPTION bits are not a reliable visual-frame check for Electron: Windows retains some style flags even when the content fills the entire window. The test therefore verifies actual window/content geometry and rendered output instead of that incorrect proxy.
- Production package checks and screenshots are stored by stage under `tests/artifacts/window-*.json` and `tests/artifacts/estra-*.png`; desktop runtime/persistence checks use `desktop-*.json`.
- Manual mouse dragging, installation over the user's existing copy, actual game joining and in-game voice are not claimed as tested. The user's running game and saved live profile were not modified.

## Delivery
Installer: `release/Estra-FiveM-Launcher-Setup-1.4.0-x64.exe`.
Packaged process: `Estra FiveM Launcher.exe` (helper processes use the same executable).
Brand assets: `release/Estra-Brand-Assets-1.4.0.zip`.
The installer remains unsigned. Close the old launcher before installing/running the renamed release.

## Platform references
[Electron custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions) explains drag/no-drag regions; [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) requires validating IPC senders. [Electron app naming](https://www.electronjs.org/docs/latest/api/app) distinguishes the internal app name from OS executable/product metadata.

## Final package evidence
Both window-packaged-1.4.0.json and desktop-packaged-1.4.0.json passed: process executable name, complete frameless content geometry, window controls, rejected untrusted IPC, sandbox, live banner, microphone restriction and reopen persistence. Windows FileDescription and ProductName both read Estra FiveM Launcher. The icon extracted from the final executable is recorded at tests/artifacts/estra-executable-icon.png. Installer size is 113,125,404 bytes and its signature status is NotSigned.

