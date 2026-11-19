export const CLEAN_PURE_PRESET_ID = 'clean-pure';

export function evaluatePureModeCompatibility(server, modState) {
  if (!server) {
    return { status: 'unknown', label: 'ยังไม่เลือกเมือง', requiresClean: false, mismatch: false };
  }
  const pureLevel = Number.isInteger(server.lockPure) ? server.lockPure : null;
  const hasActiveMods = Boolean(modState?.hasActiveMods);
  const activePresetId = modState?.activePresetId || '';
  const boundPresetId = String(server.modPresetId || '').trim();

  if (boundPresetId && activePresetId && boundPresetId !== activePresetId) {
    const boundPreset = (modState?.presets || []).find(p => p.id === boundPresetId);
    const willBeClean = boundPresetId === CLEAN_PURE_PRESET_ID || boundPreset?.pureSafe;
    return {
      status: 'pending-switch',
      label: `จะสลับเป็น "${boundPreset?.name || boundPresetId}" อัตโนมัติก่อนเข้าเมือง`,
      requiresClean: pureLevel != null && pureLevel >= 1,
      mismatch: pureLevel != null && pureLevel >= 1 && !willBeClean,
      targetPresetId: boundPresetId
    };
  }

  if (pureLevel == null) {
    return {
      status: 'neutral',
      label: hasActiveMods ? 'เปิดม็อดอยู่ (รอตรวจ Pure Mode ของเมือง)' : 'Clean Pure Mode พร้อมใช้งาน',
      requiresClean: false,
      mismatch: false
    };
  }

  if (pureLevel >= 1 && hasActiveMods) {
    return {
      status: 'conflict',
      label: `เมืองนี้บังคับ Pure Mode ${pureLevel} แต่ม็อดกำลังเปิดอยู่ (${(modState?.liveModsFiles || 0) + (modState?.livePluginsFiles || 0)} ไฟล์)`,
      requiresClean: true,
      mismatch: true,
      targetPresetId: CLEAN_PURE_PRESET_ID
    };
  }

  if (pureLevel >= 1) {
    return {
      status: 'safe',
      label: `Pure Mode ${pureLevel} พร้อมเข้าเมือง (Clean)`,
      requiresClean: true,
      mismatch: false
    };
  }

  return {
    status: 'safe',
    label: hasActiveMods
      ? `Pure Mode 0 — ใช้ม็อดได้ (${(modState?.liveModsFiles || 0) + (modState?.livePluginsFiles || 0)} ไฟล์)`
      : 'Pure Mode 0 — รองรับทั้ง Clean และลงม็อด',
    requiresClean: false,
    mismatch: false
  };
}

export function resolvePresetSwitchForLaunch(server, settings, modState) {
  if (!server || !modState) return null;
  const activeId = modState.activePresetId || '';
  const boundId = String(server.modPresetId || '').trim();

  if (boundId && boundId !== activeId) {
    const exists = (modState.presets || []).some(p => p.id === boundId);
    if (exists) {
      return { presetId: boundId, reason: 'bound' };
    }
  }

  const pureLevel = Number.isInteger(server.lockPure) ? server.lockPure : null;
  if (
    settings?.autoCleanModsForPureMode &&
    pureLevel != null &&
    pureLevel >= 1 &&
    modState.hasActiveMods
  ) {
    return { presetId: CLEAN_PURE_PRESET_ID, reason: 'pure-guard' };
  }

  return null;
}

export async function getModPresetsState(fivemPath = '') {
  if (typeof window !== 'undefined' && window.estraWindow?.getModPresets) {
    return window.estraWindow.getModPresets(String(fivemPath || ''));
  }
  return null;
}

export async function createModPreset({ fivemPath = '', name, description = '', cloneFromLive = false }) {
  if (typeof window !== 'undefined' && window.estraWindow?.createModPreset) {
    return window.estraWindow.createModPreset({
      fivemPath: String(fivemPath || ''),
      name: String(name || ''),
      description: String(description || ''),
      cloneFromLive: Boolean(cloneFromLive)
    });
  }
  throw new Error('จัดการโปรไฟล์ม็อดได้เฉพาะบน Estra Desktop (Tauri)');
}

export async function switchModPreset(fivemPath = '', presetId) {
  if (typeof window !== 'undefined' && window.estraWindow?.switchModPreset) {
    return window.estraWindow.switchModPreset({
      fivemPath: String(fivemPath || ''),
      presetId: String(presetId || '')
    });
  }
  throw new Error('สลับโปรไฟล์ม็อดได้เฉพาะบน Estra Desktop (Tauri)');
}

export async function deleteModPreset(fivemPath = '', presetId) {
  if (typeof window !== 'undefined' && window.estraWindow?.deleteModPreset) {
    return window.estraWindow.deleteModPreset({
      fivemPath: String(fivemPath || ''),
      presetId: String(presetId || '')
    });
  }
  throw new Error('ลบโปรไฟล์ม็อดได้เฉพาะบน Estra Desktop (Tauri)');
}

export async function openModPresetFolder(fivemPath = '', presetId) {
  if (typeof window !== 'undefined' && window.estraWindow?.openModPresetFolder) {
    return window.estraWindow.openModPresetFolder({
      fivemPath: String(fivemPath || ''),
      presetId: String(presetId || '')
    });
  }
  throw new Error('เปิดโฟลเดอร์ได้เฉพาะบน Estra Desktop (Tauri)');
}
