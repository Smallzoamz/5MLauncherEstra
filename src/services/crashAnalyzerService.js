export const CRASH_SEVERITY_META = {
  critical: { label: 'วิกฤต', tone: 'danger' },
  warning: { label: 'เตือน', tone: 'amber' },
  info: { label: 'ข้อมูล', tone: 'cobalt' },
  clean: { label: 'ปกติ', tone: 'emerald' }
};

export function formatBytesCompact(bytes) {
  const num = Number(bytes) || 0;
  if (num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function analyzeCrashLogs({ fivemPath = '', sinceUnixMs = null, server = null } = {}) {
  const serverCtx = server
    ? {
        name: String(server.name || ''),
        ip: String(server.ip || ''),
        gameBuild: String(server.gameBuild || ''),
        lockPure: Number.isInteger(server.lockPure) ? server.lockPure : null
      }
    : null;

  if (typeof window !== 'undefined' && window.estraWindow?.analyzeCrashLogs) {
    return window.estraWindow.analyzeCrashLogs({
      fivemPath: String(fivemPath || ''),
      sinceUnixMs: Number.isFinite(Number(sinceUnixMs)) ? Math.floor(Number(sinceUnixMs)) : null,
      serverCtx
    });
  }

  return {
    hasCrash: false,
    isRecentSessionCrash: false,
    severity: 'info',
    code: 'DESKTOP_REQUIRED',
    title: 'ต้องใช้งานบน Estra Desktop (Tauri)',
    summary: 'การสแกนไฟล์ CitizenFX_log และ crashes/ ของ FiveM รองรับเฉพาะเวอร์ชันเดสก์ท็อป',
    fixes: [],
    evidenceLines: [],
    latestCrashFile: null,
    latestLogFile: null,
    discordTicketText: '',
    analyzedAtMs: Date.now()
  };
}

export async function copyCrashTicketReport(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('ไม่มีข้อความรายงานให้คัดลอก');
  if (typeof window !== 'undefined' && window.estraWindow?.copyTextToClipboard) {
    await window.estraWindow.copyTextToClipboard(value);
    return true;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  throw new Error('ไม่สามารถคัดลอกข้อความลงคลิปบอร์ดได้');
}
