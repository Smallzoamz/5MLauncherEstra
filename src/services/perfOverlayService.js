export const PERF_OVERLAY_POSITIONS = [
  { value: 'top-left', label: 'มุมซ้ายบน (Top-Left)' },
  { value: 'top-right', label: 'มุมขวาบน (Top-Right)' },
  { value: 'bottom-left', label: 'มุมซ้ายล่าง (Bottom-Left)' },
  { value: 'bottom-right', label: 'มุมขวาล่าง (Bottom-Right)' }
];

export function normalizePerfOverlayPosition(value) {
  const clean = String(value || '').trim().toLowerCase();
  const matched = PERF_OVERLAY_POSITIONS.find(item => item.value === clean);
  return matched ? matched.value : 'top-left';
}

export function buildPerfOverlaySettingsPayload(settings) {
  return {
    enabled: Boolean(settings?.perfOverlayEnabled),
    onlyInGame: Boolean(settings?.perfOverlayOnlyInGame),
    includeInScreenshots: Boolean(settings?.perfOverlayIncludeInScreenshots),
    position: normalizePerfOverlayPosition(settings?.perfOverlayPosition)
  };
}

export function syncPerfOverlaySettings(settings) {
  if (!window?.estraWindow?.setPerfOverlaySettings) return Promise.resolve(null);
  return window.estraWindow.setPerfOverlaySettings(buildPerfOverlaySettingsPayload(settings));
}

export function formatPerfMetric(value, suffix = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `${Math.round(value)}${suffix}`;
}
