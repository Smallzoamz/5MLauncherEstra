import React, { useEffect, useRef, useState } from 'react';
import { bannerImageUrl } from '../shared/serverMedia';
import { cityBackdrop } from '../shared/cityBackdrop';

export default function CityBackground({ server, onStatus }) {
  const owner = `${server?.id || ''}|${server?.ip || ''}`;
  const detail = bannerImageUrl(server?.bannerUrl);
  const connecting = bannerImageUrl(server?.connectingBannerUrl);
  const custom = bannerImageUrl(server?.customBannerUrl);
  const fallback = cityBackdrop(server);
  const serial = useRef(0);
  const previousOwner = useRef(owner);
  const [scene, setScene] = useState({ current: { src: fallback, id: 0 }, previous: null });
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clear = () => { if (motion.matches) setScene(last => last.previous ? { ...last, previous: null } : last); };
    clear(); motion.addEventListener('change', clear);
    return () => motion.removeEventListener('change', clear);
  }, [scene.current.id]);

  useEffect(() => {
    let cancelled = false, pending = null, timer;
    const show = (src, kind) => {
      if (cancelled) return;
      setScene(last => last.current.src === src ? last : {
        previous: last.current, current: { src, id: ++serial.current }
      });
      onStatus({ owner, kind });
    };
    if (previousOwner.current !== owner) { show(fallback, 'loading'); previousOwner.current = owner; }
    const candidates = [...new Set([custom, detail, connecting].filter(Boolean))];
    onStatus({ owner, kind: candidates.length ? 'loading' : 'fallback' });
    const load = index => {
      if (cancelled) return;
      if (index >= candidates.length) { show(fallback, 'fallback'); return; }
      const img = new Image();
      pending = img;
      img.referrerPolicy = 'no-referrer';
      const next = () => {
        clearTimeout(timer); img.onload = null; img.onerror = null;
        load(index + 1);
      };
      img.onload = () => {
        clearTimeout(timer);
        if (!img.naturalWidth || !img.naturalHeight) { next(); return; }
        img.onload = null; img.onerror = null;
        show(candidates[index], candidates[index] === custom ? 'custom' : 'banner');
      };
      img.onerror = next;
      timer = setTimeout(next, 8000);
      img.src = candidates[index];
    };
    load(0);
    return () => { cancelled = true; clearTimeout(timer); if (pending) { pending.onload = null; pending.onerror = null; } };
  }, [owner, detail, connecting, custom, fallback, onStatus]);

  return <div className="ambient-art" aria-hidden="true" data-city={owner}>
    {scene.previous && <img className="city-backdrop previous" src={scene.previous.src} referrerPolicy="no-referrer" alt="" />}
    <img key={scene.current.id} className="city-backdrop current" src={scene.current.src} referrerPolicy="no-referrer" alt=""
      onAnimationEnd={() => setScene(last => last.current.id === scene.current.id ? { ...last, previous: null } : last)} />
    {scene.current.src === fallback && server?.iconSource === 'server-icon-v1' && server?.logoUrl?.startsWith('data:image/png;base64,') && <img className="city-emblem" src={server.logoUrl} alt="" />}
    <div className="art-shade" />
  </div>;
}
