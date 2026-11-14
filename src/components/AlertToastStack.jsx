import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const AUTO_DISMISS_MS = 10000;
const SWIPE_EXIT_MS = 280;

function AlertToastItem({ item, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragStartX = useRef(null);
  const dismissedRef = useRef(false);
  const exitTimerRef = useRef(null);

  const triggerSwipeClose = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setExiting(true);
    exitTimerRef.current = window.setTimeout(() => {
      onDismiss(item.id);
    }, SWIPE_EXIT_MS);
  }, [item.id, onDismiss]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      triggerSwipeClose();
    }, AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    };
  }, [triggerSwipeClose]);

  const handlePointerDown = e => {
    if (e.target.closest('button, a')) return;
    dragStartX.current = e.clientX;
  };

  const handlePointerMove = e => {
    if (dragStartX.current == null || exiting) return;
    const delta = e.clientX - dragStartX.current;
    if (Math.abs(delta) > 6) setDragX(delta);
  };

  const handlePointerUp = () => {
    if (dragStartX.current == null) return;
    dragStartX.current = null;
    if (Math.abs(dragX) >= 64) {
      triggerSwipeClose();
    } else {
      setDragX(0);
    }
  };

  const role = item.tone === 'error' ? 'alert' : 'status';
  const toneClass = item.tone === 'error' ? 'error-message' : 'notice';

  return (
    <div
      className={`alert-toast-card ${toneClass}${exiting ? ' is-swiping-out' : ''}`}
      role={role}
      style={dragX && !exiting ? { transform: `translateX(${dragX}px)`, opacity: Math.max(0.35, 1 - Math.abs(dragX) / 180) } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="alert-toast-body">{item.content}</div>
      <button
        type="button"
        className="alert-toast-close"
        aria-label="ปิดการแจ้งเตือน"
        onClick={triggerSwipeClose}
      >
        <X size={13} />
      </button>
      <span className="alert-toast-progress" style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }} aria-hidden="true" />
    </div>
  );
}

export function AlertToastStack({ alerts = [], onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div className="alert-toast-stack" aria-live="polite">
      {alerts.map(item => (
        <AlertToastItem key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
