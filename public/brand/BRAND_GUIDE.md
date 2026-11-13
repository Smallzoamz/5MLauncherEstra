# Estra FiveM Launcher

Original vector identity: a forward-leaning E cut from three angular blades, with a detached mint acceleration slash. The ESTRA wordmark uses custom vector letter shapes.

## Files
- `estra-mark.svg`: transparent symbol for the app sidebar or compact placements.
- `estra-wordmark.svg`: transparent horizontal logo with the FiveM Launcher descriptor, intended for dark backgrounds.
- `estra-icon.svg`: dark tile with the symbol, the master for app icons.
- `estra-icon-16.png` through `estra-icon-1024.png`: raster exports at their named pixel sizes.
- `estra.ico`: Windows icon containing 16, 24, 32, 48, 64, 128 and 256 px entries.
- `estra-brand-preview.png`: overview of the identity and small-size icon rendering.

## Color and use
Graphite #0B1416, ice mint #C9FBE8, accent mint #7DE7C0, wordmark #F1FCF7. Preserve the logo's proportions and negative space; keep clear space around the mark equal to at least one stroke thickness. Use the icon tile where the background is visually busy. Do not stretch the mark or add a competing outline/shadow to the source files.

The icon and ESTRA letters are vector paths. The small descriptor uses the system Arial/sans-serif font. The application itself uses its existing Manrope/Noto Sans Thai typography.

Rebuild the raster exports and Windows ICO from the repository with `node scripts/build-brand.cjs`, using an available Playwright package via PLAYWRIGHT_MODULE_PATH. No image service or runtime dependency is required by the installed app.
