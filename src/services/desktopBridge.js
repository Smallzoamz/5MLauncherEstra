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
    },
    setScreenshotConfig: config => invoke('set_screenshot_config_cmd', { config }),
    captureScreenshot: () => invoke('capture_screenshot_cmd'),
    listScreenshots: dir => invoke('list_screenshots_cmd', { dir: dir || null }),
    readScreenshotDataUrl: (filename, maxWidth = null, dir = null) =>
      invoke('read_screenshot_data_url_cmd', { filename, maxWidth, dir: dir || null }),
    copyScreenshotToClipboard: (filename, dir = null) =>
      invoke('copy_screenshot_to_clipboard_cmd', { filename, dir: dir || null }),
    deleteScreenshot: (filename, dir = null) =>
      invoke('delete_screenshot_cmd', { filename, dir: dir || null }),
    openScreenshotsFolder: (dir = null) =>
      invoke('open_screenshots_folder_cmd', { dir: dir || null }),
    onScreenshotCaptured: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://screenshot-captured', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onScreenshotError: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://screenshot-error', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    setOverlaySettings: settings => invoke('set_overlay_settings_cmd', { settings }),
    pushOverlayNotification: (payload, force = false) =>
      invoke('push_overlay_notification_cmd', { payload, force: Boolean(force) }),
    drainOverlayPending: () => invoke('drain_overlay_pending_cmd'),
    hideOverlayWindow: () => { void invoke('hide_overlay_window_cmd'); },
    onOverlayNotify: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://overlay-notify', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    }
  });
}
