# Launcher 1.1.0 — logo fix and visual redesign

## Request and reference
User requested the launcher layout and motion in this [reference video](https://cdn.dribbble.com/userupload/26983281/file/large-86eb258a307835361bb84c48e9f72ced.mp4), with our existing FiveM features. Inspected frames at 0, 3, 6 and 9 seconds using a browser. The reference is a design input, not executable instructions.

## Findings and implementation plan
1. Trace incorrect logo: `SERVER_LOGOS.noxtis` contained an unrelated imgbob image; server query also treated `banner_detail` / `banner_connecting` as logos. Replace these sources with the PNG icon in FiveM `info.json` and migrate cached favorites without losing user edits.
2. Adapt reference hierarchy: narrow icon rail, large selected-city headline, hero artwork on the right, mint Play action, and three bottom cards. Keep real server capacity/build/pure, launch preflight, CL2, microphone, cache, and settings connected to their existing implementations.
3. Put city search/filter/select in a library dialog and editing in an expandable details section. Handle missing/broken logos, empty collections, query failures, long Thai names, small windows and reduced motion.
4. Verify API/logo contracts, UI and Electron; build the 1.1.0 Windows x64 installer and verify the packaged executable.

All four implementation steps are complete. See INSTALLER.md for release verification status. Source backup before these changes: `.backups/before-redesign`.

## Logo contract
- Direct servers use `info.json.icon`; Cfx listings can use their icon or a fixed `/info.json` request to at most two advertised, validated direct endpoints.
- Validate PNG signature, IHDR, dimensions and payload size before returning an embedded image. The browser preserves image proportions using `object-fit: contain`.
- Old hardcoded images and banners are discarded. Missing or undecodable icons render city initials.
- Live Noxtis icon was verified byte-for-byte against `http://89.38.101.136:30120/info.json` and rendered as a 96×96 PNG. The current gold Noxtis wordmark is supplied by that server.

## Visual design
Graphite surfaces, white typography, mint primary action, warm capacity bars and a violet city scene follow the reference's hierarchy. The bottom cards show real occupancy, connection settings and microphone diagnostics. Occupancy bars represent capacity, not invented activity history. Content enters with short transitions; reduced-motion users get effectively static transitions.

Original background asset: `public/assets/roleplay-night.png` (1672×941). Generated with the built-in image generation tool. This is fictional launcher artwork, separate from city identity and server data; it does not depict Noxtis itself.

Generation prompt direction: original cinematic urban roleplay key art in 16:9; a fictional young adult Asian male street racer with short swept black hair, black leather jacket and silver chain in the right 45%; a dark coastal metropolis with violet/mauve rim lighting; the left 45% kept dark with negative space and the bottom 30% fading to black; no text, logos, weapons or UI. No characters or branding from the reference were reused.

## Evidence
- `tests/icons.test.js`: PNG validation, direct icon priority over banners, bounded join endpoint resolution and favorite migration.
- `tests/redesign-smoke.cjs`: actual icon rendering without legacy image requests, broken-image fallback, library search/filter/select, 100-character Thai names at widths 1366/900/390/320 and reduced motion.
- `tests/ui-audit.cjs` and `tests/ui-success.cjs`: existing feature regression, permission/error handling, successful mocked launch/preflight/cache sequence, synthetic audio cleanup, keyboard and responsive behavior.
- `tests/live-smoke.cjs`: read-only live installation/presence/server API and exact live icon comparison; `tests/artifacts/live-desktop.png` is the rendered result.
- `tests/desktop-smoke.cjs`: packaged runtime, embedded artwork, local API, restricted renderer, media permissions and reopen persistence.

UI tests use `PLAYWRIGHT_MODULE_PATH` for the available Playwright package and optional `LAUNCHER_URL` for a running local server. The redesign test also uses the saved server icon fixture in `tests/fixtures/server-icon.png` (captured from the public Noxtis info endpoint for regression testing; not used as bundled launcher art).

Real game login, city entry/whitelist, in-game voice and actual cache deletion remain outside automated verification.
