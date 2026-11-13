const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:780},deviceScaleFactor:1});
    const icon=await fs.readFile('public/brand/estra-icon.svg','utf8');
    const mark=await fs.readFile('public/brand/estra-mark.svg','utf8');
    const wordmark=await fs.readFile('public/brand/estra-wordmark.svg','utf8');
    const sizes=[16,24,32,48,64,128,256,512,1024];
    const raster=await page.evaluate(async({svg,sizes})=>{
      const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);
      await img.decode();
      return sizes.map(size=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').drawImage(img,0,0,size,size);return canvas.toDataURL('image/png').split(',')[1];});
    },{svg:icon,sizes});
    const entries=[];
    for(let i=0;i<sizes.length;i++){
      const png=Buffer.from(raster[i],'base64');
      await fs.writeFile(`public/brand/estra-icon-${sizes[i]}.png`,png);
      if(sizes[i]<=256) entries.push({size:sizes[i],png});
    }
    const header=Buffer.alloc(6+16*entries.length);header.writeUInt16LE(1,2);header.writeUInt16LE(entries.length,4);
    let offset=header.length;
    entries.forEach(({size,png},i)=>{const at=6+i*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});
    const ico=Buffer.concat([header,...entries.map(e=>e.png)]);
    await fs.writeFile('build/icon.ico',ico);await fs.writeFile('public/brand/estra.ico',ico);
    await fs.copyFile('public/brand/estra-icon-256.png','build/icon.png');
    const url=svg=>'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
    await page.setContent(`<body style="margin:0;background:#0b1012;color:#e8f5ee;font:14px Arial"><main style="padding:60px"><div style="color:#719789;letter-spacing:5px;font-size:11px">ESTRA / BRAND IDENTITY / 01</div><img src="${url(wordmark)}" width="750" style="margin:68px 0 65px"><div style="border-top:1px solid #223530;padding-top:42px;display:flex;gap:75px;align-items:center"><img src="${url(icon)}" width="160"><img src="${url(mark)}" width="122"><div><div style="font-size:11px;color:#81988e;letter-spacing:3px;margin-bottom:20px">DESIGNED TO MOVE FORWARD</div><div style="display:flex;gap:25px;align-items:center">${[16,24,32,48,64].map(s=>`<img src="${url(icon)}" width="${s}" height="${s}">`).join('')}</div></div></div><div style="margin-top:45px;font-size:11px;letter-spacing:3px;color:#698578">CUT GEOMETRY &nbsp; / &nbsp; MINT + GRAPHITE &nbsp; / &nbsp; VECTOR ORIGINAL</div></main></body>`);
    await page.screenshot({path:'public/brand/estra-brand-preview.png'});
    console.log(JSON.stringify({icoSizes:entries.map(e=>e.size),pngSizes:sizes,preview:path.resolve('public/brand/estra-brand-preview.png')}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
