// Image destinations only. Never interpret server-provided markup or script URLs.
export function bannerImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
