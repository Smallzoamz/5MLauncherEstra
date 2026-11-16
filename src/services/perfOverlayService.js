export const PERF_OVERLAY_POSITIONS = [
  { value: 'top-left', label: 'มุมซ้ายบน (Top-Left)' },
  { value: 'top-right', label: 'มุมขวาบน (Top-Right)' },
  { value: 'bottom-left', label: 'มุมซ้ายล่าง (Bottom-Left)' },
  { value: 'bottom-right', label: 'มุมขวาล่าง (Bottom-Right)' }
];

export function normalizePerfOverlayPosition(value, fallback = 'top-left') {
  const clean = String(value || '').trim().toLowerCase();
  const matched = PERF_OVERLAY_POSITIONS.find(item => item.value === clean);
  if (matched) return matched.value;
  return PERF_OVERLAY_POSITIONS.some(item => item.value === fallback) ? fallback : 'top-left';
}

export function buildPerfOverlaySettingsPayload(settings) {
  return {
    enabled: Boolean(settings?.perfOverlayEnabled),
    onlyInGame: Boolean(settings?.perfOverlayOnlyInGame),
    includeInScreenshots: Boolean(settings?.perfOverlayIncludeInScreenshots),
    position: normalizePerfOverlayPosition(settings?.perfOverlayPosition, 'top-left')
  };
}

export function buildClockOverlaySettingsPayload(settings) {
  return {
    enabled: Boolean(settings?.clockOverlayEnabled),
    onlyInGame: Boolean(settings?.clockOverlayOnlyInGame),
    includeInScreenshots: Boolean(settings?.clockOverlayIncludeInScreenshots),
    position: normalizePerfOverlayPosition(settings?.clockOverlayPosition, 'top-right')
  };
}

export function syncPerfOverlaySettings(settings) {
  if (!window?.estraWindow?.setPerfOverlaySettings) return Promise.resolve(null);
  return window.estraWindow.setPerfOverlaySettings(buildPerfOverlaySettingsPayload(settings));
}

export function syncClockOverlaySettings(settings) {
  if (!window?.estraWindow?.setClockOverlaySettings) return Promise.resolve(null);
  return window.estraWindow.setClockOverlaySettings(buildClockOverlaySettingsPayload(settings));
}

export function formatPerfMetric(value, suffix = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `${Math.round(value)}${suffix}`;
}

export function formatHudDateTime(input = new Date()) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) {
    return { dateText: '--', timeText: '--:--:--' };
  }
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return {
    dateText: `${dd}/${mm}/${yyyy}`,
    timeText: `${hh}:${min}:${ss}`
  };
}
