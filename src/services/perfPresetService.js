export async function getGamePerfPresetsState() {
  if (typeof window !== 'undefined' && window.estraWindow?.getGamePerfPresets) {
    return window.estraWindow.getGamePerfPresets();
  }
  return null;
}

export async function applyGamePerfPreset(presetId) {
  if (typeof window !== 'undefined' && window.estraWindow?.applyGamePerfPreset) {
    return window.estraWindow.applyGamePerfPreset(String(presetId || ''));
  }
  throw new Error('การปรับ Game Performance Presets รองรับเฉพาะ Estra Desktop (Tauri)');
}

export async function restoreGamePerfBackup() {
  if (typeof window !== 'undefined' && window.estraWindow?.restoreGamePerfBackup) {
    return window.estraWindow.restoreGamePerfBackup();
  }
  throw new Error('การคืนค่า settings.xml รองรับเฉพาะ Estra Desktop (Tauri)');
}

export async function openGtavSettingsFolder() {
  if (typeof window !== 'undefined' && window.estraWindow?.openGtavSettingsFolder) {
    return window.estraWindow.openGtavSettingsFolder();
  }
  throw new Error('เปิดโฟลเดอร์ได้เฉพาะบน Estra Desktop (Tauri)');
}
