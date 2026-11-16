export const SCREENSHOT_HOTKEYS = [
  { value: 'F12', label: 'F12 (มาตรฐานแบบ Steam)' },
  { value: 'F11', label: 'F11' },
  { value: 'F10', label: 'F10' },
  { value: 'F9', label: 'F9' },
  { value: 'PrintScreen', label: 'PrintScreen' },
  { value: 'Ctrl+F12', label: 'Ctrl + F12' },
  { value: 'Ctrl+F11', label: 'Ctrl + F11' }
];

export function normalizeScreenshotHotkey(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const found = SCREENSHOT_HOTKEYS.find(item => item.value.toLowerCase().replace(/\s+/g, '') === raw);
  return found ? found.value : 'F12';
}

export function buildScreenshotConfigPayload(settings, cityName = '') {
  return {
    enabled: settings?.screenshotEnabled !== false,
    hotkey: normalizeScreenshotHotkey(settings?.screenshotHotkey),
    onlyInGame: Boolean(settings?.screenshotOnlyInGame),
    includePerfOverlay: Boolean(settings?.perfOverlayIncludeInScreenshots),
    includeClockOverlay: Boolean(settings?.clockOverlayIncludeInScreenshots),
    dir: typeof settings?.screenshotDir === 'string' ? settings.screenshotDir.trim() : '',
    cityName: typeof cityName === 'string' ? cityName.trim() : ''
  };
}

export function formatShotBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatShotTimestamp(ms) {
  const num = Number(ms) || 0;
  if (!num) return 'ไม่ทราบเวลา';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(num));
  } catch {
    return new Date(num).toLocaleString();
  }
}

export function playShutterSound() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const click = (offset, freqStart, freqEnd, gainPeak) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freqStart, now + offset);
      osc.frequency.exponentialRampToValueAtTime(freqEnd, now + offset + 0.045);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(gainPeak, now + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.065);
    };

    click(0, 1280, 320, 0.14);
    click(0.05, 860, 210, 0.1);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 300);
  } catch {}
}

export function syncScreenshotSettings(settings, cityName = '') {
  if (!window?.estraWindow?.setScreenshotConfig) return Promise.resolve(null);
  return window.estraWindow.setScreenshotConfig(buildScreenshotConfigPayload(settings, cityName));
}
