import React, { useEffect, useState } from 'react';
import { formatHudDateTime } from '../services/perfOverlayService';

export default function ClockOverlayApp({ desktopWindow = false }) {
  const [state, setState] = useState({
    visible: false,
    position: 'top-right'
  });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!desktopWindow) return undefined;
    document.documentElement.classList.add('overlay-window-root');
    document.body.classList.add('overlay-window-body');

    let lastPushAt = 0;

    const applyState = payload => {
      if (payload && typeof payload === 'object') {
        setState(prev => ({ ...prev, ...payload }));
      }
    };

    const pullState = () => {
      if (!window.estraWindow?.getClockOverlayState) return;
      void window.estraWindow
        .getClockOverlayState()
        .then(applyState)
        .catch(() => {});
    };

    const off = window.estraWindow?.onClockOverlayState?.(payload => {
      lastPushAt = Date.now();
      applyState(payload);
    });

    pullState();
    const fallbackTimer = window.setInterval(() => {
      if (Date.now() - lastPushAt >= 2000) {
        pullState();
      }
    }, 1500);

    return () => {
      window.clearInterval(fallbackTimer);
      off?.();
    };
  }, [desktopWindow]);

  if (desktopWindow && !state.visible) {
    return null;
  }

  const { dateText, timeText } = formatHudDateTime(now);
  const alignClass = String(state.position || '').endsWith('right') ? 'align-right' : 'align-left';

  return (
    <div className={`perf-hud-shell ${alignClass}`} role="status" aria-live="off">
      <div className="perf-hud-pill">
        <div className="perf-hud-item perf-hud-clock">
          <span className="perf-hud-label">{dateText}</span>
          <strong className="perf-hud-value">{timeText}</strong>
        </div>
      </div>
    </div>
  );
}
