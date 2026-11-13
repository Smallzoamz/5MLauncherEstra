// A city-specific theme for missing banners, never labelled official artwork.
export function cityBackdrop(server) {
  let seed = 2166136261;
  for (const char of String(server?.ip || server?.id || 'estra')) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const hue = seed % 360;
  const skyline = Array.from({ length: 30 }, (_, i) => {
    const height = 70 + ((seed >>> (i % 20)) + i * 67) % 210;
    return `<rect x="${i * 60}" y="${800 - height}" width="48" height="${height}" fill="hsl(${hue},22%,12%)"/><path d="M${i * 60 + 8} ${814 - height}v${height - 28}" stroke="hsl(${hue},28%,27%)" stroke-width="2"/>`;
  }).join('');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><radialGradient id="sky" cx="75%" cy="28%" r="75%"><stop stop-color="hsl(${hue},35%,27%)"/><stop offset="1" stop-color="#070b0e"/></radialGradient></defs><path fill="url(#sky)" d="M0 0h1600v900H0z"/><circle cx="1180" cy="300" r="220" fill="none" stroke="hsl(${hue},34%,44%)" stroke-opacity=".22"/><circle cx="1180" cy="300" r="245" fill="none" stroke="hsl(${hue},34%,44%)" stroke-opacity=".1"/>${skyline}</svg>`);
}
