import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerImageUrl } from '../src/shared/serverMedia.js';
import { resolveBannerUrl, serverBanners } from '../src/server/serverBanners.js';
import { queryLiveServer } from '../src/server/fivemBackend.js';

test('banner URL accepts image destinations and rejects script/file/credential inputs', () => {
  for (const bad of ['javascript:alert(1)', 'file:///C:/private.png', 'data:image/svg+xml,<svg/>', 'https://user:password@example.com/a.png', 'https://example.com/\nimage', 'x'.repeat(2049), null]) assert.equal(bannerImageUrl(bad),null);
  assert.equal(bannerImageUrl('https://cdn.example.com/a.png?q=1'),'https://cdn.example.com/a.png?q=1');
});
test('ImgBob share page resolves only its direct image metadata without arbitrary redirects/hosts', async () => {
  const image='https://imgbob.net/ib/city.png';
  assert.equal(await resolveBannerUrl('https://imgbob.net/OzvoLurDfqyBsqG',async url=> {
    assert.equal(url,'https://imgbob.net/en/OzvoLurDfqyBsqG');
    return `<meta property="og:image" content="${image}">`;
  }), image);
  assert.equal(await resolveBannerUrl('https://imgbob.net/abcdef',async()=>'<meta property="og:image" content="http://127.0.0.1/private">'),null);
  assert.equal(await resolveBannerUrl('https://imgbob.net/abcdef',async()=>{throw new Error('timeout')}),null);
  assert.equal(await resolveBannerUrl('https://other.example/page',async()=>{throw new Error('must not fetch')}),'https://other.example/page');
});
test('detail and connecting banners stay separate from city icon, including Cfx listing', async () => {
  const vars={banner_detail:'https://cdn.example/detail.png',banner_connecting:'https://cdn.example/connect.png'};
  assert.deepEqual(await serverBanners(vars),{bannerUrl:vars.banner_detail,connectingBannerUrl:vars.banner_connecting});
  for(const target of ['example.com:30120','cfx.re/join/abcdef']) {
    const data={clients:5,vars};
    const result=await queryLiveServer(target,async url=>url.includes('/single/')?{Data:data}:data);
    assert.equal(result.online,true);
    assert.equal(result.bannerUrl,vars.banner_detail);
    assert.equal(result.connectingBannerUrl,vars.banner_connecting);
    assert.equal(result.logoUrl,null);
  }
});
test('missing Cfx listing banners can be filled from its validated direct endpoint', async () => {
  const result=await queryLiveServer('cfx.re/join/abcdef',async url=>url.includes('/single/') ? {Data:{clients:2,connectEndPoints:['city.example:30120']}} : {vars:{banner_detail:'https://cdn.example/city.jpg'}});
  assert.equal(result.bannerUrl,'https://cdn.example/city.jpg');
  assert.equal(result.logoUrl,null);
});
