const INSPECT_CTRL_SHIFT_KEYS = new Set(['I', 'J', 'C', 'K', 'E']);
const INSPECT_CTRL_KEYS = new Set(['U', 'S', 'P']);

export function isAllowedDesktopOrigin(protocol = '', hostname = '') {
  const proto = String(protocol || '').toLowerCase();
  const host = String(hostname || '').toLowerCase();
  if (proto === 'tauri:') return true;
  if ((proto === 'http:' || proto === 'https:') && host === 'tauri.localhost') return true;
  return false;
}

export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.isContentEditable);
}

export function isInspectShortcut(event) {
  if (!event) return false;
  const key = String(event.key || '').toUpperCase();
  if (key === 'F12') return true;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (!mod) return false;
  if (event.shiftKey && INSPECT_CTRL_SHIFT_KEYS.has(key)) return true;
  if (!event.shiftKey && !event.altKey && INSPECT_CTRL_KEYS.has(key)) return true;
  return false;
}

export function initClientGuard({
  isProd = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD),
  win = typeof window !== 'undefined' ? window : null,
  doc = typeof document !== 'undefined' ? document : null
} = {}) {
  if (!isProd || !win || !doc || !win.estraWindow) return { active: false, blocked: false };

  try {
    if (win.top && win.top !== win.self) {
      if (doc.documentElement) doc.documentElement.textContent = '';
      return { active: true, blocked: true, reason: 'frame' };
    }
  } catch {
    if (doc.documentElement) doc.documentElement.textContent = '';
    return { active: true, blocked: true, reason: 'frame' };
  }

  if (
    win.__TAURI_INTERNALS__ &&
    !isAllowedDesktopOrigin(win.location?.protocol, win.location?.hostname)
  ) {
    if (doc.documentElement) doc.documentElement.textContent = '';
    return { active: true, blocked: true, reason: 'origin' };
  }

  try {
    if (!Object.prototype.hasOwnProperty.call(win, '__REACT_DEVTOOLS_GLOBAL_HOOK__')) {
      Object.defineProperty(win, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
        value: Object.freeze({ isDisabled: true }),
        configurable: false,
        writable: false
      });
    }
  } catch {}

  const onContextMenu = event => {
    if (!isEditableTarget(event?.target)) {
      event.preventDefault();
    }
  };

  const onKeyDown = event => {
    if (isInspectShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  doc.addEventListener('contextmenu', onContextMenu, true);
  doc.addEventListener('keydown', onKeyDown, true);

  return {
    active: true,
    blocked: false,
    cleanup() {
      doc.removeEventListener('contextmenu', onContextMenu, true);
      doc.removeEventListener('keydown', onKeyDown, true);
    }
  };
}
