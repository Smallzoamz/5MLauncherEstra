import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function isTauriDesktop() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export function initDesktopBridge() {
  if (!isTauriDesktop() || window.estraWindow) return;
  window.estraWindow = Object.freeze({
    minimize: () => { void invoke('window_minimize_cmd'); },
    hideToTray: () => { void invoke('window_hide_cmd'); },
    toggleMaximize: () => { void invoke('window_toggle_maximize_cmd'); },
    close: () => { void invoke('window_close_cmd'); },
    openExternal: url => invoke('open_external_url_cmd', { url }),
    getStartupSettings: () => invoke('get_startup_settings_cmd'),
    setStartupSettings: enabled => invoke('set_startup_settings_cmd', { enabled: Boolean(enabled) }),
    setLatestCity: state => {
      void invoke('set_latest_city_cmd', { name: state?.name || '', enabled: !!state?.enabled });
    },
    onLaunchLatest: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://launch-latest', () => { if (active) callback(); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onGameStatus: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://game-status', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    }
  });
}
