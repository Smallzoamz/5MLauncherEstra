import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Camera, Gamepad2, Radio, Sparkles } from 'lucide-react';
import { subscribeBrowserOverlay } from '../services/overlayService';

const EXIT_ANIM_MS = 240;
const MAX_STACK = 3;

function OverlayToastCard({ item, onExpired }) {
  const [exiting, setExiting] = useState(false);
  const [brokenImg, setBrokenImg] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const duration = Math.max(2000, Math.min(10000, Number(item.durationMs) || 4500));
    const exitTimer = window.setTimeout(() => {
      setExiting(true);
    }, duration);
    const removeTimer = window.setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onExpired(item.id);
      }
    }, duration + EXIT_ANIM_MS);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
    };
  }, [item.id, item.durationMs, onExpired]);

  const isShot = item.kind === 'screenshot';
  const isInGame = item.kind === 'friend-in-game';
  const isSchedule = item.kind === 'schedule-alert';
  const isWatcher = item.kind === 'server-watcher';

  return (
    <div
      className={`steam-overlay-card kind-${item.kind}${exiting ? ' is-exiting' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`steam-overlay-media${isShot ? ' is-shot' : ''}`}
        style={!item.imageUrl || brokenImg ? { background: item.accentColor || '#1d4ed8' } : undefined}
      >
        {item.imageUrl && !brokenImg ? (
          <img
            src={item.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBrokenImg(true)}
          />
        ) : isShot ? (
          <Camera size={20} />
        ) : isWatcher ? (
          <Radio size={19} />
        ) : isSchedule ? (
          <BellRing size={19} />
        ) : isInGame ? (
          <span>{item.initials || <Gamepad2 size={18} />}</span>
        ) : (
          <span>{item.initials || <Sparkles size={18} />}</span>
        )}
        <span className={`steam-overlay-dot kind-${item.kind}`} aria-hidden="true" />
      </div>

      <div className="steam-overlay-copy">
        <div className="steam-overlay-badge-row">
          <span className={`steam-overlay-badge kind-${item.kind}`}>{item.badge}</span>
          {item.detail && <span className="steam-overlay-detail">{item.detail}</span>}
        </div>
        <strong>{item.title}</strong>
        <small>{item.subtitle}</small>
      </div>
    </div>
  );
}

export default function OverlayApp({ desktopWindow = false }) {
  const [items, setItems] = useState([]);
  const sawItemsRef = useRef(false);

  const enqueue = useCallback(payload => {
    if (!payload || !payload.title) return;
    sawItemsRef.current = true;
    const entry = {
      ...payload,
      id: payload.id || `ov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    };
    setItems(prev => [...prev.filter(x => x.id !== entry.id), entry].slice(-MAX_STACK));
  }, []);

  const handleExpired = useCallback(id => {
    setItems(prev => prev.filter(x => x.id !== id));
  }, []);

  useEffect(() => {
    if (!desktopWindow) {
      return subscribeBrowserOverlay(enqueue);
    }
    document.documentElement.classList.add('overlay-window-root');
    document.body.classList.add('overlay-window-body');
    const off = window.estraWindow?.onOverlayNotify?.(enqueue);
    if (window.estraWindow?.drainOverlayPending) {
      void window.estraWindow.drainOverlayPending()
        .then(pending => {
          if (Array.isArray(pending)) pending.forEach(enqueue);
        })
        .catch(() => {});
    }
    return () => {
      off?.();
    };
  }, [desktopWindow, enqueue]);

  useEffect(() => {
    if (!desktopWindow) return;
    if (items.length === 0 && sawItemsRef.current) {
      window.estraWindow?.hideOverlayWindow?.();
    }
  }, [desktopWindow, items.length]);

  if (items.length === 0 && !desktopWindow) return null;

  return (
    <div className={`steam-overlay-stack${desktopWindow ? ' is-desktop-window' : ' is-browser-preview'}`}>
      {items.map(item => (
        <OverlayToastCard key={item.id} item={item} onExpired={handleExpired} />
      ))}
    </div>
  );
}
