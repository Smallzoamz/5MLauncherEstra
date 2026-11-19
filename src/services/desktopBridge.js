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
    },
    setPerfOverlaySettings: settings => invoke('set_perf_overlay_settings_cmd', { settings }),
    getPerfOverlaySnapshot: () => invoke('get_perf_metrics_snapshot_cmd'),
    onPerfMetrics: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://perf-metrics', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    setClockOverlaySettings: settings => invoke('set_clock_overlay_settings_cmd', { settings }),
    getClockOverlayState: () => invoke('get_clock_overlay_state_cmd'),
    onClockOverlayState: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://clock-overlay-state', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    getCrpAddonState: () => invoke('get_crp_addon_state_cmd'),
    installCrpAddon: () => invoke('install_crp_addon_cmd'),
    uninstallCrpAddon: () => invoke('uninstall_crp_addon_cmd'),
    setCrpOverlayConfig: config => invoke('set_crp_overlay_config_cmd', { config }),
    toggleCrpOverlayWindow: (visible = null) => invoke('toggle_crp_overlay_window_cmd', { visible }),
    hideCrpOverlayWindow: () => invoke('hide_crp_overlay_window_cmd'),
    copyTextToClipboard: text => invoke('copy_text_to_clipboard_cmd', { text }),
    onCrpAddonState: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://crp-addon-state', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onCrpScheduleFired: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://crp-schedule-fired', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    getVoiceNoteState: () => invoke('get_voice_note_state_cmd'),
    installVoiceNoteAddon: () => invoke('install_voice_note_addon_cmd'),
    uninstallVoiceNoteAddon: () => invoke('uninstall_voice_note_addon_cmd'),
    setVoiceNoteConfig: config => invoke('set_voice_note_config_cmd', { config }),
    startVoiceNoteCapture: () => invoke('start_voice_note_capture_cmd'),
    stopVoiceNoteCapture: () => invoke('stop_voice_note_capture_cmd'),
    downloadLocalWhisper: modelId => invoke('download_local_whisper_cmd', { modelId }),
    toggleVoiceNoteOverlay: (visible = null) => invoke('toggle_voice_note_overlay_cmd', { visible }),
    hideVoiceNoteOverlay: () => invoke('hide_voice_note_overlay_cmd'),
    getLastVoiceClip: () => invoke('get_last_voice_clip_cmd'),
    onVoiceNoteState: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://voice-note-state', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onVoiceNoteMeter: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://voice-note-meter', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onVoiceNoteTranscript: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://voice-note-transcript', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onVoiceNoteError: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://voice-note-error', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    onVoiceNoteDownload: callback => {
      if (typeof callback !== 'function') return () => {};
      let active = true;
      let unlistenFn = null;
      void listen('estra://voice-note-download', event => { if (active) callback(event.payload); }).then(unlisten => {
        if (active) unlistenFn = unlisten;
        else unlisten();
      });
      return () => { active = false; unlistenFn?.(); };
    },
    analyzeCrashLogs: ({ fivemPath = '', sinceUnixMs = null, serverCtx = null } = {}) =>
      invoke('analyze_crash_logs_cmd', { fivemPath, sinceUnixMs, serverCtx }),
    getModPresets: (fivemPath = '') =>
      invoke('get_mod_presets_cmd', { fivemPath }),
    createModPreset: ({ fivemPath = '', name, description = '', cloneFromLive = false }) =>
      invoke('create_mod_preset_cmd', { fivemPath, name, description, cloneFromLive }),
    switchModPreset: ({ fivemPath = '', presetId }) =>
      invoke('switch_mod_preset_cmd', { fivemPath, presetId }),
    deleteModPreset: ({ fivemPath = '', presetId }) =>
      invoke('delete_mod_preset_cmd', { fivemPath, presetId }),
    openModPresetFolder: ({ fivemPath = '', presetId }) =>
      invoke('open_mod_preset_folder_cmd', { fivemPath, presetId }),
    probeServerRoute: ({ target, samples = 6 }) =>
      invoke('probe_server_route_cmd', { target, samples })
  });
}
