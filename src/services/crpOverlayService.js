import { CRP_OVERLAY_ADDON_ID } from '../shared/addonsCatalog.js';

const STORAGE_KEY_CRP_ADDON = 'estra_addon_crp_srp_overlay_v1';

export const CRP_OVERLAY_HOTKEYS = [
  { value: 'Alt+O', label: 'Alt + O (แนะนำ — ไม่ชนปุ่มเกม)' },
  { value: 'Ctrl+Shift+O', label: 'Ctrl + Shift + O' },
  { value: 'Insert', label: 'Insert' },
  { value: 'Home', label: 'Home' },
  { value: 'F7', label: 'F7' },
  { value: 'F9', label: 'F9' }
];

export const CRP_OVERLAY_POSITIONS = [
  { value: 'top-right', label: 'มุมขวาบน (Top-Right)' },
  { value: 'top-left', label: 'มุมซ้ายบน (Top-Left)' },
  { value: 'bottom-right', label: 'มุมขวาล่าง (Bottom-Right)' },
  { value: 'bottom-left', label: 'มุมซ้ายล่าง (Bottom-Left)' }
];

export const SCHEDULE_CATEGORIES = [
  { value: 'class', label: 'ตารางเรียน', color: '#38bdf8' },
  { value: 'event', label: 'Event / กิจกรรม', color: '#f59e0b' },
  { value: 'story', label: 'นัดหมาย RP / สตอรี่', color: '#a855f7' },
  { value: 'other', label: 'ทั่วไป', color: '#22c55e' }
];

export const REMIND_BEFORE_OPTIONS = [
  { value: 0, label: 'ตรงเวลาพอดี' },
  { value: 5, label: 'ก่อนเวลา 5 นาที' },
  { value: 10, label: 'ก่อนเวลา 10 นาที' },
  { value: 15, label: 'ก่อนเวลา 15 นาที' },
  { value: 30, label: 'ก่อนเวลา 30 นาที' }
];

export const DAY_OF_WEEK_LABELS = [
  { value: 0, short: 'อา', full: 'อาทิตย์' },
  { value: 1, short: 'จ', full: 'จันทร์' },
  { value: 2, short: 'อ', full: 'อังคาร' },
  { value: 3, short: 'พ', full: 'พุธ' },
  { value: 4, short: 'พฤ', full: 'พฤหัสบดี' },
  { value: 5, short: 'ศ', full: 'ศุกร์' },
  { value: 6, short: 'ส', full: 'เสาร์' }
];

export const COMMAND_CATEGORIES = [
  { value: 'fix', label: 'แก้บั๊ก / รีโหลด' },
  { value: 'voice', label: 'เสียง & ดนตรี' },
  { value: 'rp', label: 'สตอรี่ / RP' },
  { value: 'custom', label: 'กำหนดเอง' }
];

export const DEFAULT_QUICK_COMMANDS = [
  {
    id: 'builtin-reloadmap',
    label: 'รีโหลดแมพ',
    command: '/reloadmap',
    mode: 'chat',
    category: 'fix',
    description: 'ใช้เมื่อแมพไม่โหลด พื้นหาย หรือฉากค้าง',
    builtIn: true
  },
  {
    id: 'builtin-reloadskin',
    label: 'รีโหลดสกิน / ตัวละคร',
    command: '/reloadskin',
    mode: 'chat',
    category: 'fix',
    description: 'ใช้เมื่อเสื้อผ้าบั๊ก ทรงผมหาย หรือโมเดลตัวละครโหลดไม่ครบ',
    builtIn: true
  },
  {
    id: 'builtin-voice-music',
    label: 'โหมดร้องเพลง / ดนตรี (Music)',
    command: 'setvoiceintent music',
    mode: 'f8',
    category: 'voice',
    description: 'ปรับไมค์เป็นโหมดดนตรีผ่าน F8 ให้เสียงร้องหรือเครื่องดนตรีชัดขึ้น',
    builtIn: true
  },
  {
    id: 'builtin-voice-speech',
    label: 'กลับโหมดพูดปกติ (Speech)',
    command: 'setvoiceintent speech',
    mode: 'f8',
    category: 'voice',
    description: 'ปรับไมค์กลับมาเป็นโหมดพูดคุยปกติผ่าน F8 หลังร้องเพลงเสร็จ',
    builtIn: true
  }
];

export const DEFAULT_CRP_CONFIG = {
  enabled: true,
  toggleHotkey: 'Alt+O',
  position: 'top-right',
  onlyInGame: false,
  autoHideOnCopy: true,
  showScheduleToasts: true,
  playAlertSound: true,
  rollCommand: 'roll',
  rollCount: 4,
  schedules: [],
  commands: DEFAULT_QUICK_COMMANDS.map(cmd => ({ ...cmd }))
};

export function normalizeCrpHotkey(raw) {
  const clean = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const matched = CRP_OVERLAY_HOTKEYS.find(
    item => item.value.toLowerCase().replace(/\s+/g, '') === clean
  );
  return matched ? matched.value : 'Alt+O';
}

export function normalizeCrpPosition(raw) {
  const clean = String(raw || '').trim().toLowerCase();
  const matched = CRP_OVERLAY_POSITIONS.find(item => item.value === clean);
  return matched ? matched.value : 'top-right';
}

export function clampRollCount(count) {
  const num = Number(count);
  if (!Number.isFinite(num)) return 4;
  return Math.max(1, Math.min(20, Math.round(num)));
}

export function sanitizeRollCommand(raw) {
  const cleaned = String(raw || 'roll')
    .replace(/[\r\n;]+/g, ' ')
    .trim()
    .replace(/^\/+/, '');
  return cleaned ? cleaned.slice(0, 60) : 'roll';
}

export function buildF8MultiCommand(command = 'roll', count = 4) {
  const base = sanitizeRollCommand(command);
  const safeCount = clampRollCount(count);
  return Array.from({ length: safeCount }, () => base).join(';');
}

export function normalizeTimeString(raw) {
  const match = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '20:00';
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '20:00';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function normalizeDateString(raw) {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const yyyy = Number(match[1]);
  const mm = Number(match[2]);
  const dd = Number(match[3]);
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function sanitizeScheduleItem(item) {
  if (!item || typeof item !== 'object') return null;
  const title = String(item.title || '').trim().slice(0, 80);
  if (!title) return null;
  const category = SCHEDULE_CATEGORIES.some(c => c.value === item.category) ? item.category : 'event';
  const scheduleType = item.scheduleType === 'once' ? 'once' : 'weekly';
  const time = normalizeTimeString(item.time);
  const date = scheduleType === 'once' ? normalizeDateString(item.date) : '';
  const daysRaw = Array.isArray(item.daysOfWeek) ? item.daysOfWeek : [];
  const daysOfWeek = [...new Set(daysRaw.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b
  );
  const remindRaw = Number(item.remindBeforeMinutes);
  const remindBeforeMinutes = Number.isFinite(remindRaw) ? Math.max(0, Math.min(120, Math.round(remindRaw))) : 5;
  return {
    id: String(item.id || '').trim().slice(0, 64) || createLocalId('sch'),
    title,
    category,
    scheduleType,
    daysOfWeek: scheduleType === 'weekly' && daysOfWeek.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : daysOfWeek,
    date,
    time,
    remindBeforeMinutes,
    notifyAtStart: item.notifyAtStart !== false,
    location: String(item.location || '').trim().slice(0, 60),
    note: String(item.note || '').trim().slice(0, 140),
    enabled: item.enabled !== false
  };
}

export function sanitizeQuickCommand(item) {
  if (!item || typeof item !== 'object') return null;
  const label = String(item.label || '').trim().slice(0, 60);
  const command = String(item.command || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!label || !command) return null;
  const mode = item.mode === 'f8' ? 'f8' : 'chat';
  const category = COMMAND_CATEGORIES.some(c => c.value === item.category) ? item.category : 'custom';
  return {
    id: String(item.id || '').trim().slice(0, 64) || createLocalId('cmd'),
    label,
    command,
    mode,
    category,
    description: String(item.description || '').trim().slice(0, 140),
    builtIn: Boolean(item.builtIn)
  };
}

export function sanitizeCrpConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const schedules = Array.isArray(src.schedules)
    ? src.schedules.map(sanitizeScheduleItem).filter(Boolean).slice(0, 100)
    : [];
  const commands = Array.isArray(src.commands)
    ? src.commands.map(sanitizeQuickCommand).filter(Boolean).slice(0, 120)
    : DEFAULT_QUICK_COMMANDS.map(cmd => ({ ...cmd }));

  return {
    enabled: src.enabled !== false,
    toggleHotkey: normalizeCrpHotkey(src.toggleHotkey),
    position: normalizeCrpPosition(src.position),
    onlyInGame: Boolean(src.onlyInGame),
    autoHideOnCopy: src.autoHideOnCopy !== false,
    showScheduleToasts: src.showScheduleToasts !== false,
    playAlertSound: src.playAlertSound !== false,
    rollCommand: sanitizeRollCommand(src.rollCommand),
    rollCount: clampRollCount(src.rollCount),
    schedules,
    commands
  };
}

function createLocalId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function computeNextScheduleOccurrence(item, now = new Date()) {
  if (!item || !item.time) return null;
  const [hhStr, mmStr] = String(item.time).split(':');
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;

  let candidate = null;
  if (item.scheduleType === 'once') {
    const norm = normalizeDateString(item.date);
    if (!norm) return null;
    const [y, m, d] = norm.split('-').map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
    if (dt.getTime() < now.getTime() - 60_000) return null;
    candidate = dt;
  } else {
    const allowedDays = new Set(
      Array.isArray(item.daysOfWeek) && item.daysOfWeek.length > 0
        ? item.daysOfWeek
        : [0, 1, 2, 3, 4, 5, 6]
    );
    for (let offset = 0; offset <= 7; offset += 1) {
      const dt = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offset,
        hh,
        mm,
        0,
        0
      );
      if (!allowedDays.has(dt.getDay())) continue;
      if (dt.getTime() < now.getTime() - 59_000) continue;
      candidate = dt;
      break;
    }
  }

  if (!candidate) return null;
  const diffMs = candidate.getTime() - now.getTime();
  const minutesUntil = Math.max(0, Math.ceil(diffMs / 60_000));
  const sameDay =
    candidate.getFullYear() === now.getFullYear() &&
    candidate.getMonth() === now.getMonth() &&
    candidate.getDate() === now.getDate();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    candidate.getFullYear() === tomorrow.getFullYear() &&
    candidate.getMonth() === tomorrow.getMonth() &&
    candidate.getDate() === tomorrow.getDate();

  let countdownLabel = '';
  if (diffMs <= 60_000 && diffMs >= -59_000) {
    countdownLabel = 'กำลังถึงเวลา';
  } else if (minutesUntil < 60) {
    countdownLabel = `อีก ${minutesUntil} นาที`;
  } else {
    const hrs = Math.floor(minutesUntil / 60);
    const rem = minutesUntil % 60;
    countdownLabel = rem > 0 ? `อีก ${hrs} ชม. ${rem} น.` : `อีก ${hrs} ชั่วโมง`;
  }

  return {
    nextDate: candidate,
    diffMs,
    minutesUntil,
    isToday: sameDay,
    isTomorrow,
    dayLabel: sameDay ? 'วันนี้' : isTomorrow ? 'พรุ่งนี้' : DAY_OF_WEEK_LABELS[candidate.getDay()]?.full || '',
    countdownLabel
  };
}

export function formatScheduleDaysSummary(item) {
  if (!item) return '';
  if (item.scheduleType === 'once') {
    const norm = normalizeDateString(item.date);
    if (!norm) return item.time || '';
    const [y, m, d] = norm.split('-');
    return `${d}/${m}/${y} · ${item.time}`;
  }
  const days = Array.isArray(item.daysOfWeek) ? item.daysOfWeek : [];
  if (days.length === 0 || days.length === 7) return `ทุกวัน · ${item.time}`;
  const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d));
  if (isWeekdays) return `จ.-ศ. · ${item.time}`;
  const labels = days.map(d => DAY_OF_WEEK_LABELS[d]?.short).filter(Boolean);
  return `${labels.join(', ')} · ${item.time}`;
}

export function buildScheduleAlertPayload(item, phase = 'start') {
  const catMeta = SCHEDULE_CATEGORIES.find(c => c.value === item?.category) || SCHEDULE_CATEGORIES[1];
  const isPre = phase === 'pre' && Number(item?.remindBeforeMinutes) > 0;
  const badge = isPre
    ? `${catMeta.label} · อีก ${item.remindBeforeMinutes} นาที`
    : `${catMeta.label} · ถึงเวลาแล้ว`;
  const locText = item?.location ? `สถานที่: ${item.location}` : '';
  const noteText = item?.note || '';
  const subtitle = [locText, noteText].filter(Boolean).join(' · ') || `เวลา ${item?.time || ''}`;
  return {
    id: `crp-sch-${item?.id || 'test'}-${phase}-${Date.now()}`,
    kind: 'schedule-alert',
    badge,
    title: item?.title || 'แจ้งเตือนตารางกิจกรรม',
    subtitle,
    detail: item?.time || '',
    imageUrl: '',
    initials: catMeta.value === 'class' ? 'CLS' : catMeta.value === 'event' ? 'EVT' : 'RP',
    accentColor: catMeta.color,
    durationMs: 6500
  };
}

function localMinuteKey(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function evaluateDueSchedules(schedules = [], now = new Date(), firedKeys = new Set()) {
  const alerts = [];
  const nextFired = new Set(firedKeys);
  const minuteNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    0,
    0
  );

  for (const item of schedules) {
    if (!item || !item.enabled) continue;
    const [hhStr, mmStr] = String(item.time || '').split(':');
    const hh = Number(hhStr);
    const mm = Number(mmStr);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) continue;

    // Check occurrence today and tomorrow (in case pre-reminder crosses midnight)
    for (const dayOffset of [0, 1]) {
      const occDate = new Date(
        minuteNow.getFullYear(),
        minuteNow.getMonth(),
        minuteNow.getDate() + dayOffset,
        hh,
        mm,
        0,
        0
      );

      let matchesDay = false;
      if (item.scheduleType === 'once') {
        const occIso = `${occDate.getFullYear()}-${String(occDate.getMonth() + 1).padStart(2, '0')}-${String(
          occDate.getDate()
        ).padStart(2, '0')}`;
        matchesDay = normalizeDateString(item.date) === occIso;
      } else {
        const allowed =
          Array.isArray(item.daysOfWeek) && item.daysOfWeek.length > 0
            ? item.daysOfWeek
            : [0, 1, 2, 3, 4, 5, 6];
        matchesDay = allowed.includes(occDate.getDay());
      }
      if (!matchesDay) continue;

      const remindMins = Number(item.remindBeforeMinutes) || 0;
      if (remindMins > 0) {
        const preTime = new Date(occDate.getTime() - remindMins * 60_000);
        if (localMinuteKey(preTime) === localMinuteKey(minuteNow)) {
          const key = `${item.id}|pre|${localMinuteKey(occDate)}`;
          if (!nextFired.has(key)) {
            nextFired.add(key);
            alerts.push({ item, phase: 'pre', key, payload: buildScheduleAlertPayload(item, 'pre') });
          }
        }
      }

      if (item.notifyAtStart !== false || remindMins === 0) {
        if (localMinuteKey(occDate) === localMinuteKey(minuteNow)) {
          const key = `${item.id}|start|${localMinuteKey(occDate)}`;
          if (!nextFired.has(key)) {
            nextFired.add(key);
            alerts.push({ item, phase: 'start', key, payload: buildScheduleAlertPayload(item, 'start') });
          }
        }
      }
    }
  }

  return { alerts, nextFired };
}

function readLocalAddonEnvelope() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CRP_ADDON);
    if (!raw) {
      return {
        installed: false,
        manifest: null,
        config: sanitizeCrpConfig(DEFAULT_CRP_CONFIG),
        overlayVisible: false,
        installDir: ''
      };
    }
    const parsed = JSON.parse(raw);
    return {
      installed: Boolean(parsed?.installed),
      manifest: parsed?.manifest || null,
      config: sanitizeCrpConfig(parsed?.config || DEFAULT_CRP_CONFIG),
      overlayVisible: Boolean(parsed?.overlayVisible),
      installDir: String(parsed?.installDir || '')
    };
  } catch {
    return {
      installed: false,
      manifest: null,
      config: sanitizeCrpConfig(DEFAULT_CRP_CONFIG),
      overlayVisible: false,
      installDir: ''
    };
  }
}

function writeLocalAddonEnvelope(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY_CRP_ADDON,
      JSON.stringify({
        installed: Boolean(state?.installed),
        manifest: state?.manifest || null,
        config: sanitizeCrpConfig(state?.config || DEFAULT_CRP_CONFIG),
        overlayVisible: false,
        installDir: String(state?.installDir || '')
      })
    );
  } catch {}
}

export async function loadCrpAddonState() {
  if (typeof window !== 'undefined' && window.estraWindow?.getCrpAddonState) {
    const state = await window.estraWindow.getCrpAddonState();
    const normalized = {
      installed: Boolean(state?.installed),
      manifest: state?.manifest || null,
      config: sanitizeCrpConfig(state?.config || DEFAULT_CRP_CONFIG),
      overlayVisible: Boolean(state?.overlayVisible),
      installDir: String(state?.installDir || '')
    };
    writeLocalAddonEnvelope(normalized);
    return normalized;
  }
  return readLocalAddonEnvelope();
}

export async function installCrpOverlayAddon() {
  if (typeof window !== 'undefined' && window.estraWindow?.installCrpAddon) {
    const state = await window.estraWindow.installCrpAddon();
    const normalized = {
      installed: Boolean(state?.installed),
      manifest: state?.manifest || null,
      config: sanitizeCrpConfig(state?.config || DEFAULT_CRP_CONFIG),
      overlayVisible: Boolean(state?.overlayVisible),
      installDir: String(state?.installDir || '')
    };
    writeLocalAddonEnvelope(normalized);
    return normalized;
  }
  const next = {
    installed: true,
    manifest: {
      id: CRP_OVERLAY_ADDON_ID,
      version: '1.0.0',
      installedAt: Date.now(),
      enabled: true
    },
    config: sanitizeCrpConfig(DEFAULT_CRP_CONFIG),
    overlayVisible: false,
    installDir: 'browser-storage'
  };
  writeLocalAddonEnvelope(next);
  return next;
}

export async function uninstallCrpOverlayAddon() {
  if (typeof window !== 'undefined' && window.estraWindow?.uninstallCrpAddon) {
    const state = await window.estraWindow.uninstallCrpAddon();
    const normalized = {
      installed: Boolean(state?.installed),
      manifest: state?.manifest || null,
      config: sanitizeCrpConfig(state?.config || DEFAULT_CRP_CONFIG),
      overlayVisible: false,
      installDir: ''
    };
    try {
      localStorage.removeItem(STORAGE_KEY_CRP_ADDON);
    } catch {}
    return normalized;
  }
  try {
    localStorage.removeItem(STORAGE_KEY_CRP_ADDON);
  } catch {}
  return {
    installed: false,
    manifest: null,
    config: sanitizeCrpConfig(DEFAULT_CRP_CONFIG),
    overlayVisible: false,
    installDir: ''
  };
}

export async function saveCrpOverlayConfig(nextConfig) {
  const clean = sanitizeCrpConfig(nextConfig);
  if (typeof window !== 'undefined' && window.estraWindow?.setCrpOverlayConfig) {
    const state = await window.estraWindow.setCrpOverlayConfig(clean);
    const normalized = {
      installed: Boolean(state?.installed),
      manifest: state?.manifest || null,
      config: sanitizeCrpConfig(state?.config || clean),
      overlayVisible: Boolean(state?.overlayVisible),
      installDir: String(state?.installDir || '')
    };
    writeLocalAddonEnvelope(normalized);
    return normalized;
  }
  const current = readLocalAddonEnvelope();
  const next = {
    ...current,
    config: clean
  };
  writeLocalAddonEnvelope(next);
  return next;
}

export async function toggleCrpOverlayWindow(visible = null) {
  if (typeof window !== 'undefined' && window.estraWindow?.toggleCrpOverlayWindow) {
    return window.estraWindow.toggleCrpOverlayWindow(visible);
  }
  return false;
}

export async function hideCrpOverlayWindow() {
  if (typeof window !== 'undefined' && window.estraWindow?.hideCrpOverlayWindow) {
    return window.estraWindow.hideCrpOverlayWindow();
  }
  return false;
}

export async function copyCommandText(text) {
  const clean = String(text || '');
  if (!clean) throw new Error('ไม่มีคำสั่งสำหรับคัดลอก');
  if (typeof window !== 'undefined' && window.estraWindow?.copyTextToClipboard) {
    await window.estraWindow.copyTextToClipboard(clean);
    return clean;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(clean);
    return clean;
  }
  throw new Error('ไม่สามารถเข้าถึง Clipboard ได้');
}
