# FiveM Launcher 1.2.0 — city banners and interaction motion

## Request and implemented behavior
Use each selected city's FiveM banner as the launcher background and make UI interactions smoother. Implementation follows the existing React/CSS structure without a new animation dependency.

FiveM publishes `banner_detail` and `banner_connecting` as optional server configuration values ([official example](https://docs.fivem.net/docs/server-manual/setting-up-a-server-vanilla/)). The launcher tries the detail banner, then the connecting banner, then its bundled fallback artwork. City logos still use the separate `info.json.icon` PNG.

Noxtis currently publishes `https://imgbob.net/OzvoLurDfqyBsqG` as its detail banner. This is a sharing page; its image metadata resolves to `https://imgbob.net/ib/maJbOll8PyWkVrJ_1757971327.png`. The launcher reads that metadata instead of hardcoding the file URL. The current green fantasy/castle artwork is the image linked by this server, not an independently selected city illustration.

## Implementation and boundaries
- Backend passes distinct detail/connecting banner fields. Cfx listings missing artwork can use their validated advertised FiveM info endpoints.
- Banner URLs accept HTTP/HTTPS without embedded credentials or control characters. The renderer loads them as images with no referrer; image URLs are never executed as HTML or scripts.
- Only ImgBob sharing pages are resolved on the backend, using a fixed HTTPS host/path, no redirects, a 4.5-second timeout, 512 KiB response limit and bounded cache. Extracted images must remain on ImgBob's `/ib/` path. Other hosts must provide direct image URLs.
- Images preload before fading in. A failed or timed-out image moves to the next candidate; switching cities cancels adoption of earlier results. Each layer transition lasts 650 ms and retains at most one outgoing layer.
- Selected-city content enters gently; cards, buttons, sidebar selection, switches and capacity bars have short transitions. Dialogs animate in and out. The outgoing modal continues blocking background clicks until it closes, avoiding accidental click-through; closing the microphone dialog stops its stream promptly.
- Hover motion applies only to fine pointers. `prefers-reduced-motion` disables decorative transitions and clears old image layers. Saved banner URLs are validated again when favorites are restored; changing an IP clears its previous artwork.
- Wide banners use cover cropping with dark overlays so foreground controls remain readable. Image quality and subject matter depend on the server's published asset. Arbitrary in-game loading-screen HTML/video resources are not imported.

## Verification (2026-09-05)
- `npm test`: 26/26 pass, including media URL validation, bounded sharing-page resolution, direct/Cfx banner contracts and the existing launcher regression suite.
- `npm run test:runtime`: dev/preview HTML and API work; unauthorized launch remains 403.
- `npm run test:ui`: CRUD/persistence/settings/launch and cache error flows, synthetic microphone capture/cleanup and mocked successful preflight all pass.
- `tests/banner-motion-smoke.cjs`: city switching, crossfade/layer cleanup, broken-detail to connecting fallback, missing-banner fallback, delayed old-image race, dialog enter/exit/reopen, reduced-motion cleanup, and widths 900/390/320 pass.
- `tests/redesign-smoke.cjs`: actual logo fixture, missing/broken logo behavior, library filtering and long Thai titles remain correct.
- `tests/live-smoke.cjs`: real Noxtis icon matches the server bytes and the resolved banner decodes and displays; `tests/artifacts/live-desktop.png` records the screen.
- `npm run dist:win`: 1.2.0 NSIS x64 installer built. `tests/artifacts/desktop-packaged-1.2.0.json` records the packaged executable loading the live banner, API, media restrictions, sandbox and reopen persistence with no page errors.
- Current installer lifecycle QA was skipped because existing Desktop/Start Menu shortcuts belong to the user's launcher. The preflight guard stopped before installation and preserved those shortcuts. The previous 1.1.0 clean-install/uninstall evidence remains in INSTALLER.md; upgrading the user's installed copy is not claimed as tested.

## Delivery
`release/FiveM-Launcher-Setup-1.2.0-x64.exe` — 112,918,932 bytes, unsigned. `release/SHA256SUMS.txt` includes this file and previous installers.

No real game launch, game cache deletion, game login/whitelist test or in-game voice test was performed.
