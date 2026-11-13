import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriDesktop } from './desktopBridge';
import { APP_VERSION, DEFAULT_GITHUB_REPO } from '../shared/patcherConfig';

function requireTauri() {
  if (!isTauriDesktop()) {
    throw new Error('ฟีเจอร์ Patcher และ Auto-Update ทำงานในโหมดแอปเดสก์ท็อป (Tauri) เท่านั้น');
  }
}

export async function checkLauncherUpdate(githubRepo = DEFAULT_GITHUB_REPO) {
  if (!isTauriDesktop()) {
    return {
      configured: false,
      githubRepo: githubRepo || DEFAULT_GITHUB_REPO,
      currentVersion: APP_VERSION,
      available: false,
      version: null,
      notes: null,
      date: null,
      message: 'เปิดผ่านโหมดเบราว์เซอร์ — ตัวตรวจอัปเดตทำงานในแอปเดสก์ท็อป (Tauri)'
    };
  }
  return invoke('check_launcher_update_cmd', { githubRepo: githubRepo || null });
}

export async function installLauncherUpdate(githubRepo = DEFAULT_GITHUB_REPO) {
  requireTauri();
  return invoke('install_launcher_update_cmd', { githubRepo: githubRepo || null });
}

export async function checkCityPatch({ manifestUrl, fivemPath = '', serverId }) {
  requireTauri();
  return invoke('check_city_patch_cmd', { manifestUrl, fivemPath, serverId });
}

export async function applyCityPatch({ manifestUrl, fivemPath = '', serverId }) {
  requireTauri();
  return invoke('apply_city_patch_cmd', { manifestUrl, fivemPath, serverId });
}

export async function cancelCityPatch() {
  if (!isTauriDesktop()) return;
  return invoke('cancel_city_patch_cmd');
}

export function subscribePatchProgress(callback) {
  if (!isTauriDesktop() || typeof callback !== 'function') return () => {};
  let active = true;
  let unlistenFn = null;
  void listen('estra://patch-progress', event => { if (active) callback(event.payload); }).then(unlisten => {
    if (active) unlistenFn = unlisten;
    else unlisten();
  });
  return () => { active = false; unlistenFn?.(); };
}

export function subscribeUpdaterProgress(callback) {
  if (!isTauriDesktop() || typeof callback !== 'function') return () => {};
  let active = true;
  let unlistenFn = null;
  void listen('estra://updater-progress', event => { if (active) callback(event.payload); }).then(unlisten => {
    if (active) unlistenFn = unlisten;
    else unlisten();
  });
  return () => { active = false; unlistenFn?.(); };
}
