import React, { useEffect, useState } from 'react';
import { formatPerfMetric } from '../services/perfOverlayService';

export default function PerfOverlayApp({ desktopWindow = false }) {
  const [metrics, setMetrics] = useState({
    fps: null,
    cpuPercent: null,
    gpuPercent: null,
    fivemRunning: false,
    position: 'top-left'
  });

  useEffect(() => {
    if (!desktopWindow) return undefined;
    document.documentElement.classList.add('overlay-window-root');
    document.body.classList.add('overlay-window-body');

    const off = window.estraWindow?.onPerfMetrics?.(payload => {
      if (payload && typeof payload === 'object') {
        setMetrics(prev => ({ ...prev, ...payload }));
      }
    });

    if (window.estraWindow?.getPerfOverlaySnapshot) {
      void window.estraWindow
        .getPerfOverlaySnapshot()
        .then(snap => {
          if (snap && typeof snap === 'object') {
            setMetrics(prev => ({ ...prev, ...snap }));
          }
        })
        .catch(() => {});
    }

    return () => {
      off?.();
    };
  }, [desktopWindow]);

  const fpsColor =
    typeof metrics.fps === 'number'
      ? metrics.fps >= 60
        ? 'is-good'
        : metrics.fps >= 30
          ? 'is-warn'
          : 'is-low'
      : '';

  return (
    <div className="perf-hud-shell" role="status" aria-live="off">
      <div className="perf-hud-pill">
        <div className={`perf-hud-item ${fpsColor}`}>
          <span className="perf-hud-label">FPS</span>
          <strong className="perf-hud-value">{formatPerfMetric(metrics.fps)}</strong>
        </div>
        <span className="perf-hud-sep" aria-hidden="true" />
        <div className="perf-hud-item">
          <span className="perf-hud-label">CPU</span>
          <strong className="perf-hud-value">{formatPerfMetric(metrics.cpuPercent, '%')}</strong>
        </div>
        <span className="perf-hud-sep" aria-hidden="true" />
        <div className="perf-hud-item">
          <span className="perf-hud-label">GPU</span>
          <strong className="perf-hud-value">{formatPerfMetric(metrics.gpuPercent, '%')}</strong>
        </div>
      </div>
    </div>
  );
}
