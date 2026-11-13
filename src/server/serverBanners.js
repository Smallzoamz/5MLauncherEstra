import { bannerImageUrl } from '../shared/serverMedia.js';

const cache = new Map();
async function readImgBobPage(url) {
  // Only this known image host is fetched by the backend; no arbitrary HTML proxy.
  const response = await fetch(url, { signal: AbortSignal.timeout(4500), redirect: 'error' });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('No image page');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error('Image page too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function resolveBannerUrl(value, readPage = readImgBobPage) {
  const safe = bannerImageUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  const share = url.hostname === 'imgbob.net' && !url.port && url.pathname.match(/^\/(?:[a-z]{2}\/)?([A-Za-z0-9]{6,40})\/?$/);
  if (!share) return safe;
  const pageUrl = `https://imgbob.net/en/${share[1]}`;
  const cached = readPage === readImgBobPage && cache.get(pageUrl);
  if (cached && cached.expires > Date.now()) return cached.value;
  let imageUrl = null;
  try {
    const html = await readPage(pageUrl);
    const tag = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*>/i)?.[0];
    const candidate = bannerImageUrl(tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&'));
    if (candidate) {
      const image = new URL(candidate);
      if (image.origin === 'https://imgbob.net' && image.pathname.startsWith('/ib/')) imageUrl = candidate;
    }
  } catch { /* A missing banner never makes the server status fail. */ }
  if (readPage === readImgBobPage) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(pageUrl, { value: imageUrl, expires: Date.now() + (imageUrl ? 300000 : 30000) });
  }
  return imageUrl;
}

export async function serverBanners(vars = {}, resolve = resolveBannerUrl) {
  const [detail, connecting] = await Promise.all([
    resolve(vars.banner_detail), resolve(vars.banner_connecting)
  ]);
  return { bannerUrl: detail, connectingBannerUrl: connecting };
}
