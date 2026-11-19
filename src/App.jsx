import React, { useState, useEffect, useRef, useCallback } from 'react';
import ServerLibrary from './components/ServerLibrary';
import Header from './components/Header';
import ServerSidebar from './components/ServerSidebar';
import FriendsSidebar from './components/FriendsSidebar';
import MainLauncher from './components/MainLauncher';
import AuthModal from './components/AuthModal';
import AuthScreen from './components/AuthScreen';
import MicTestModal from './components/MicTestModal';
import CacheModal from './components/CacheModal';
import SettingsModal from './components/SettingsModal';
import NewServerModal from './components/NewServerModal';
import PatcherModal from './components/PatcherModal';
import ConfirmModal from './components/ConfirmModal';
import GuideModal from './components/GuideModal';
import UpdatePromptModal from './components/UpdatePromptModal';
import CrashAdvisorModal from './components/CrashAdvisorModal';
import { AlertToastStack } from './components/AlertToastStack';
import { UserAvatar } from './components/UserAvatar';
import useDialogFocus from './components/useDialogFocus';
import { getSavedServers, saveServers, getActiveServerId, saveActiveServerId, claimLegacyServersOnce, resetLive, getSettings, saveSettings, hasSeenOnboardingGuide, markOnboardingGuideSeen } from './services/storageService';
import { buildServersSyncPayload, buildServersSyncSignature, mergeCloudServersWithLocalCache } from './shared/userServersSync';
import { fetchServerDirectory, loadCachedServerDirectory } from './services/serverDirectoryService';
import { applyDirectoryMetadataToServer, lookupDirectoryServer, normalizeDirectoryAddress, syncLiveServerName } from './shared/serverDirectory';
import { DEFAULT_SERVER_TAG, normalizeServerTag } from './shared/serverTags';
import { resolveCommunityLinks } from './shared/communityLinks';
import { queryServerInfo, cleanRealCache } from './services/fivemService';
import { analyzeCrashLogs } from './services/crashAnalyzerService';
import {
  CLEAN_PURE_PRESET_ID,
  createModPreset,
  deleteModPreset,
  getModPresetsState,
  openModPresetFolder,
  switchModPreset
} from './services/modPresetService';
import {
  appendPingHistory,
  createDefaultWatcherRule,
  evaluateWatcherTransition,
  loadWatcherMap,
  probeServerRoute,
  saveWatcherMap
} from './services/serverWatcherService';
import CityBackground from './components/CityBackground';
import audioService from './services/audioService';
import presenceService from './services/presenceService';
import { playShutterSound, syncScreenshotSettings } from './services/screenshotService';
import { syncClockOverlaySettings, syncPerfOverlaySettings } from './services/perfOverlayService';
import {
  detectFriendOverlayTransitions,
  playOverlayFriendChime,
  pushOverlayNotification,
  shouldDeliverOverlay,
  syncOverlaySettings
} from './services/overlayService';
import {
  DEFAULT_CRP_CONFIG,
  evaluateDueSchedules,
  installCrpOverlayAddon,
  loadCrpAddonState,
  saveCrpOverlayConfig,
  toggleCrpOverlayWindow,
  uninstallCrpOverlayAddon
} from './services/crpOverlayService';
import {
  DEFAULT_VOICE_NOTE_CONFIG,
  downloadLocalWhisperRuntime,
  installVoiceNoteAddon,
  loadVoiceNoteState,
  saveVoiceNoteConfig,
  startVoiceNoteCapture,
  stopVoiceNoteCapture,
  toggleVoiceNoteOverlayWindow,
  uninstallVoiceNoteAddon
} from './services/voiceNoteService';
import { isTauriDesktop } from './services/desktopBridge';
import OverlayApp from './components/OverlayApp';
import { prepareLaunch } from './services/prepareLaunch';
import { createLaunchHistory, latestHistoryCity } from './services/launchHistory';
import LaunchHistory from './components/LaunchHistory';
import PrelaunchPatcher from './components/PrelaunchPatcher';
import { checkLauncherUpdate, installLauncherUpdate } from './services/patcherService';
import { DEFAULT_GITHUB_REPO } from './shared/patcherConfig';
import {
  changePassword,
  fetchChatHistory,
  fetchRealtimeToken,
  fetchSocialSession,
  fetchSocialState,
  loginAccount,
  logoutAccount,
  markChatRead,
  registerAccount,
  removeFriend,
  respondFriendRequest,
  respondGameInvite,
  searchSocialUsers,
  sendChatMessage,
  sendFriendRequest,
  sendGameInvite,
  sendHeartbeat,
  syncUserServers,
  toggleFavoriteFriend,
  toggleRemoteFavoriteServer,
  updateSocialProfile
} from './services/socialService';
import { apiGet, apiPost } from './services/apiService';
import { subscribeSocialRealtime } from './services/socialRealtime';
import { clearUserChatCache } from './services/chatCacheService';
import { isSupabaseGatewayUrl, resolveSocialServerUrl } from './shared/supabaseConfig';

const EMPTY_SOCIAL = {
  loading: true,
  authenticated: false,
  mode: 'local',
  user: null,
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  favoriteServers: [],
  incomingInvites: [],
  outgoingInvites: [],
  unreadMessages: {}
};

export default function App() {
  const [servers, setServers] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [settings, setSettings] = useState(getSettings);
  const [modal, setVisibleModal] = useState(null);
  const [modalClosing, setModalClosing] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const modalTimer = useRef(null);
  const [background, setBackground] = useState({});
  const [centerTab, setCenterTab] = useState('general');
  const [navStack, setNavStack] = useState([{ tab: 'general', serverId: '' }]);
  const [navIndex, setNavIndex] = useState(0);
  const hydratedUserIdRef = useRef('');
  const lastSyncedSigRef = useRef('');
  const serverSyncTimerRef = useRef(null);
  const activePlaySessionRef = useRef({ serverId: '', lastCommittedAtMs: 0 });
  const lastLaunchedServerIdRef = useRef('');
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [friendsMobileOpen, setFriendsMobileOpen] = useState(false);
  const [social, setSocial] = useState(EMPTY_SOCIAL);
  const [realtimeAccessToken, setRealtimeAccessToken] = useState('');
  const [chatRealtimeTick, setChatRealtimeTick] = useState(0);
  const [gameEnv, setGameEnv] = useState(null);
  const [dismissedInvites, setDismissedInvites] = useState({});
  const alertSeqRef = useRef(1);
  const [dismissedAlerts, setDismissedAlerts] = useState({});
  const [uiNotice, setUiNotice] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const requestConfirm = useCallback(opts => setConfirmState(opts), []);
  const closeConfirm = useCallback(() => setConfirmState(null), []);

  const setModal = value => {
    if (settingsBusy) return;
    if (!value && modalClosing) return;
    if (!value && modal === 'guide') markOnboardingGuideSeen();
    clearTimeout(modalTimer.current);
    if (value) { setModalClosing(false); setVisibleModal(value); return; }
    if (modal === 'mic') audioService.stopMicStream();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVisibleModal(null); setModalClosing(false); return; }
    setModalClosing(true);
    modalTimer.current = setTimeout(() => { setVisibleModal(null); setModalClosing(false); }, 160);
  };
  useEffect(() => () => clearTimeout(modalTimer.current), []);

  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [gameNotice, setGameNotice] = useState(null);
  const [historyStore] = useState(() => createLaunchHistory({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }));
  const [history, setHistory] = useState(historyStore.getSnapshot);
  const [launchBusy, setLaunchBusy] = useState(false);
  const launchLock = useRef(false);
  const [launchFeedback, setLaunchFeedback] = useState(null);
  const [launcherUpdate, setLauncherUpdate] = useState(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState('');
  const [screenStage, setScreenStage] = useState('splash');
  const [presence, setPresence] = useState(presenceService.getPresence());
  const [directory, setDirectory] = useState(loadCachedServerDirectory);
  const [screenshotCaptureVersion, setScreenshotCaptureVersion] = useState(0);
  const [crpAddonState, setCrpAddonState] = useState({
    installed: false,
    manifest: null,
    config: DEFAULT_CRP_CONFIG,
    overlayVisible: false,
    installDir: ''
  });
  const [crpAddonBusy, setCrpAddonBusy] = useState(false);
  const [voiceNoteState, setVoiceNoteState] = useState({
    installed: false,
    manifest: null,
    config: DEFAULT_VOICE_NOTE_CONFIG,
    listening: false,
    overlayVisible: false,
    localEngineReady: false,
    localModelReady: false,
    localModelsDownloaded: [],
    activeCaptureLabel: '',
    installDir: ''
  });
  const [voiceMeter, setVoiceMeter] = useState({ level: 0, speaking: false, transcribing: false });
  const [voiceDownloadProgress, setVoiceDownloadProgress] = useState(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [discoverSubTab, setDiscoverSubTab] = useState('crash');
  const [crashReport, setCrashReport] = useState(null);
  const [crashScanning, setCrashScanning] = useState(false);
  const [crashFixBusyId, setCrashFixBusyId] = useState('');
  const [crashFixFeedback, setCrashFixFeedback] = useState(null);
  const [modState, setModState] = useState(null);
  const [modBusy, setModBusy] = useState(false);
  const [routeReportByServer, setRouteReportByServer] = useState({});
  const [pingHistoryByServer, setPingHistoryByServer] = useState({});
  const [routeProbing, setRouteProbing] = useState(false);
  const [watcherMap, setWatcherMap] = useState(() => loadWatcherMap());
  const [watcherReadyAlert, setWatcherReadyAlert] = useState(null);
  const watcherMapRef = useRef(watcherMap);
  watcherMapRef.current = watcherMap;
  const watcherLastPollRef = useRef({});
  const crpFiredKeysRef = useRef(new Set());
  const crpAddonStateRef = useRef(crpAddonState);
  crpAddonStateRef.current = crpAddonState;
  const friendOverlayMapRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const [guideFirstVisit, setGuideFirstVisit] = useState(() => !hasSeenOnboardingGuide());
  const mustChangePromptedRef = useRef(false);
  const guideAutoOpenedRef = useRef(false);

  useEffect(() => presenceService.subscribe(setPresence), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchServerDirectory({ signal: controller.signal }).then(entries => {
      if (!controller.signal.aborted && entries?.length) setDirectory(entries);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!directory?.length) return;
    setServers(prev => {
      let changed = false;
      const next = prev.map(srv => {
        const synced = applyDirectoryMetadataToServer(srv, directory);
        if (synced.changed) changed = true;
        return synced.server;
      });
      return changed ? next : prev;
    });
  }, [directory]);

  useEffect(() => {
    if (screenStage !== 'launcher') return;
    let active = true;
    const pollUpdate = () => {
      void checkLauncherUpdate(DEFAULT_GITHUB_REPO)
        .then(info => { if (active) setLauncherUpdate(info); })
        .catch(() => {});
    };
    pollUpdate();
    const timer = setInterval(pollUpdate, 30 * 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [screenStage]);

  useEffect(() => {
    if (screenStage === 'auth' && social.authenticated) {
      setScreenStage('launcher');
    } else if (screenStage === 'launcher' && !social.loading && !social.authenticated) {
      clearTimeout(modalTimer.current);
      setVisibleModal(null);
      setModalClosing(false);
      setScreenStage('auth');
    }
  }, [screenStage, social.loading, social.authenticated]);

  useEffect(() => {
    if (!social.authenticated || !social.user?.mustChangePassword) {
      mustChangePromptedRef.current = false;
      return;
    }
    if (screenStage === 'launcher' && !mustChangePromptedRef.current) {
      mustChangePromptedRef.current = true;
      setModal('auth');
    }
  }, [screenStage, social.authenticated, social.user?.mustChangePassword]);

  useEffect(() => {
    if (launcherUpdate?.available && launcherUpdate?.version && dismissedUpdateVersion !== launcherUpdate.version) {
      setUpdateModalOpen(true);
    }
  }, [launcherUpdate?.available, launcherUpdate?.version, dismissedUpdateVersion]);

  useEffect(() => {
    if (screenStage !== 'launcher' || !social.authenticated) return;
    if (social.user?.mustChangePassword) return;
    if (modal !== null || updateModalOpen || guideAutoOpenedRef.current || hasSeenOnboardingGuide()) return;
    guideAutoOpenedRef.current = true;
    setGuideFirstVisit(true);
    setModal('guide');
  }, [screenStage, social.authenticated, social.user?.mustChangePassword, modal, updateModalOpen]);

  useEffect(() => historyStore.subscribe(setHistory), [historyStore]);

  const active = servers.find(s => s.id === activeId) || servers[0];
  const activeRef = useRef(active);
  activeRef.current = active;

  const pushNav = useCallback((nextTab, nextServerId) => {
    setNavStack(prev => {
      const sliced = prev.slice(0, navIndex + 1);
      const top = sliced.at(-1);
      if (top && top.tab === nextTab && top.serverId === nextServerId) return sliced;
      const updated = [...sliced, { tab: nextTab, serverId: nextServerId }].slice(-20);
      setNavIndex(updated.length - 1);
      return updated;
    });
  }, [navIndex]);

  const handleSelectServer = useCallback(id => {
    setActiveId(id);
    pushNav(centerTab, id);
  }, [centerTab, pushNav]);

  const handleChangeTab = useCallback(tab => {
    setCenterTab(tab);
    pushNav(tab, activeRef.current?.id || '');
  }, [pushNav]);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navStack.length - 1;
  const handleGoBack = () => {
    if (!canGoBack) return;
    const target = navStack[navIndex - 1];
    setNavIndex(navIndex - 1);
    setCenterTab(target.tab);
    if (target.serverId && servers.some(s => s.id === target.serverId)) setActiveId(target.serverId);
  };
  const handleGoForward = () => {
    if (!canGoForward) return;
    const target = navStack[navIndex + 1];
    setNavIndex(navIndex + 1);
    setCenterTab(target.tab);
    if (target.serverId && servers.some(s => s.id === target.serverId)) setActiveId(target.serverId);
  };

  const hydrateUserServers = useCallback(state => {
    const uid = state?.user?.id;
    if (!uid) return;
    const hasSyncedServers = !!state.hasSyncedServers;
    const cloudServers = Array.isArray(state.savedServers) ? state.savedServers : [];
    const cloudActiveId = typeof state.activeServerId === 'string' ? state.activeServerId : '';
    const favIds = new Set((state.favoriteServers || []).map(f => f.id));

    const applyLocalDecorations = list => {
      let next = list.map(s => (favIds.has(s.id) && !s.favorite ? { ...s, favorite: true } : s));
      if (directoryRef.current?.length) {
        next = next.map(srv => applyDirectoryMetadataToServer(srv, directoryRef.current).server);
      }
      return next;
    };

    if (hydratedUserIdRef.current !== uid) {
      let hydrated;
      let nextActiveId = '';
      if (hasSyncedServers) {
        const cached = getSavedServers(uid);
        hydrated = applyLocalDecorations(mergeCloudServersWithLocalCache(cloudServers, cached, resetLive));
        const localActive = getActiveServerId(uid);
        nextActiveId = (cloudActiveId && hydrated.some(s => s.id === cloudActiveId))
          ? cloudActiveId
          : (hydrated.find(s => s.id === localActive)?.id || hydrated[0]?.id || '');
        lastSyncedSigRef.current = buildServersSyncSignature(hydrated, nextActiveId);
      } else {
        const perUserLocal = getSavedServers(uid);
        const perUserActive = getActiveServerId(uid);
        const claimed = !perUserLocal.length ? claimLegacyServersOnce() : null;
        const initialList = perUserLocal.length ? perUserLocal : (claimed?.servers || []);
        hydrated = applyLocalDecorations(initialList.map(resetLive));
        nextActiveId = hydrated.some(s => s.id === perUserActive)
          ? perUserActive
          : (hydrated.some(s => s.id === claimed?.activeServerId) ? claimed.activeServerId : (hydrated[0]?.id || ''));
        lastSyncedSigRef.current = hydrated.length > 0 ? '__pending_initial_sync__' : buildServersSyncSignature([], '');
      }

      hydratedUserIdRef.current = uid;
      try {
        saveServers(hydrated, uid);
        saveActiveServerId(nextActiveId, uid);
      } catch {}
      setServers(hydrated);
      setActiveId(nextActiveId);
      setNavStack([{ tab: 'general', serverId: nextActiveId }]);
      setNavIndex(0);
      return;
    }

    const currentSig = buildServersSyncSignature(serversRef.current, activeIdRef.current);
    if (currentSig !== lastSyncedSigRef.current || !hasSyncedServers) {
      return;
    }

    const cloudSig = buildServersSyncSignature(cloudServers, cloudActiveId);
    if (cloudSig === lastSyncedSigRef.current) {
      return;
    }

    const merged = applyLocalDecorations(mergeCloudServersWithLocalCache(cloudServers, serversRef.current, resetLive));
    const nextActiveId = (cloudActiveId && merged.some(s => s.id === cloudActiveId))
      ? cloudActiveId
      : (merged.some(s => s.id === activeIdRef.current) ? activeIdRef.current : (merged[0]?.id || ''));
    lastSyncedSigRef.current = buildServersSyncSignature(merged, nextActiveId);
    setServers(merged);
    setActiveId(nextActiveId);
  }, []);

  const refreshSocial = useCallback(async () => {
    try {
      const me = await fetchSocialSession(settings.socialServerUrl);
      if (!me?.authenticated) {
        clearTimeout(serverSyncTimerRef.current);
        hydratedUserIdRef.current = '';
        lastSyncedSigRef.current = '';
        setServers([]);
        setActiveId('');
        setSocial({ ...EMPTY_SOCIAL, loading: false, mode: me?.mode || 'local' });
        return;
      }
      const state = await fetchSocialState(settings.socialServerUrl);
      setSocial({
        loading: false,
        authenticated: true,
        mode: state.mode || me.mode || 'local',
        user: state.user,
        friends: state.friends || [],
        incomingRequests: state.incomingRequests || [],
        outgoingRequests: state.outgoingRequests || [],
        favoriteServers: state.favoriteServers || [],
        incomingInvites: state.incomingInvites || [],
        outgoingInvites: state.outgoingInvites || [],
        unreadMessages: state.unreadMessages || {}
      });
      hydrateUserServers(state);
    } catch {
      setSocial(prev => ({ ...prev, loading: false }));
    }
  }, [settings.socialServerUrl, hydrateUserServers]);

  useEffect(() => {
    void refreshSocial();
  }, [refreshSocial]);

  useEffect(() => {
    let activeDetect = true;
    if (window.estraWindow?.getStartupSettings) {
      void window.estraWindow.getStartupSettings()
        .then(state => {
          if (!activeDetect || typeof state?.enabled !== 'boolean') return;
          setSettings(prev => {
            if (prev.runOnWindowsStartup === state.enabled) return prev;
            const next = { ...prev, runOnWindowsStartup: state.enabled };
            try { saveSettings(next); } catch {}
            return next;
          });
        })
        .catch(() => {});
    }
    void apiGet(`/api/game-environment?path=${encodeURIComponent(settings.fivemPath || '')}`)
      .then(env => {
        if (!activeDetect || !env?.success) return;
        setGameEnv(env);
        if (!settings.fivemPath && env.fivem?.found && env.fivem?.root) {
          setSettings(prev => {
            if (prev.fivemPath) return prev;
            const next = { ...prev, fivemPath: env.fivem.root };
            try { saveSettings(next); } catch {}
            return next;
          });
        }
      })
      .catch(() => {});
    return () => { activeDetect = false; };
  }, []);

  useEffect(() => {
    void syncScreenshotSettings(settings, active?.name || '').catch(() => {});
  }, [
    settings.screenshotEnabled,
    settings.screenshotHotkey,
    settings.screenshotOnlyInGame,
    settings.perfOverlayIncludeInScreenshots,
    settings.clockOverlayIncludeInScreenshots,
    settings.screenshotDir,
    active?.name
  ]);

  useEffect(() => {
    void syncOverlaySettings(settings).catch(() => {});
  }, [
    settings.overlayNotificationsEnabled,
    settings.overlayNotifyScreenshot,
    settings.overlayNotifyFriendOnline,
    settings.overlayNotifyFriendInGame
  ]);

  useEffect(() => {
    void syncPerfOverlaySettings(settings).catch(() => {});
  }, [
    settings.perfOverlayEnabled,
    settings.perfOverlayOnlyInGame,
    settings.perfOverlayIncludeInScreenshots,
    settings.perfOverlayPosition
  ]);

  useEffect(() => {
    void syncClockOverlaySettings(settings).catch(() => {});
  }, [
    settings.clockOverlayEnabled,
    settings.clockOverlayOnlyInGame,
    settings.clockOverlayIncludeInScreenshots,
    settings.clockOverlayPosition
  ]);

  useEffect(() => {
    if (!social.authenticated) {
      friendOverlayMapRef.current = null;
      return;
    }
    if (social.loading) return;
    const { nextMap, notifications } = detectFriendOverlayTransitions(
      friendOverlayMapRef.current,
      social.friends
    );
    friendOverlayMapRef.current = nextMap;
    if (!notifications.length) return;

    const currentSettings = settingsRef.current;
    const deliverable = notifications
      .filter(item => shouldDeliverOverlay(currentSettings, item.kind, false))
      .slice(0, 3);
    if (!deliverable.length) return;

    for (const item of deliverable) {
      void pushOverlayNotification(item, { settings: currentSettings }).catch(() => {});
    }
    if (currentSettings?.screenshotPlaySound !== false) {
      playOverlayFriendChime();
    }
  }, [social.authenticated, social.loading, social.friends]);

  useEffect(() => {
    const offCaptured = window.estraWindow?.onScreenshotCaptured?.(payload => {
      setScreenshotCaptureVersion(v => v + 1);
      if (settingsRef.current?.screenshotPlaySound !== false) {
        playShutterSound();
      }
      setUiNotice({
        message: payload?.message || 'บันทึกภาพหน้าจอแล้ว',
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    });
    const offError = window.estraWindow?.onScreenshotError?.(err => {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'จับภาพหน้าจอไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    });
    return () => {
      offCaptured?.();
      offError?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadCrpAddonState()
      .then(state => {
        if (active && state) setCrpAddonState(state);
      })
      .catch(() => {});

    const offAddonState = window.estraWindow?.onCrpAddonState?.(state => {
      if (active && state) setCrpAddonState(state);
    });
    const offScheduleFired = window.estraWindow?.onCrpScheduleFired?.(payload => {
      if (!active || !payload) return;
      if (crpAddonStateRef.current?.config?.playAlertSound !== false) {
        playOverlayFriendChime();
      }
      setUiNotice({
        message: `${payload.badge}: ${payload.title}`,
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    });

    return () => {
      active = false;
      offAddonState?.();
      offScheduleFired?.();
    };
  }, []);

  useEffect(() => {
    if (screenStage !== 'launcher' && centerTab !== 'addons') return;
    let active = true;
    void loadCrpAddonState()
      .then(state => {
        if (active && state) setCrpAddonState(state);
      })
      .catch(() => {});
    void loadVoiceNoteState()
      .then(state => {
        if (active && state) setVoiceNoteState(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [screenStage, centerTab]);

  useEffect(() => {
    let active = true;
    void loadVoiceNoteState()
      .then(state => {
        if (active && state) setVoiceNoteState(state);
      })
      .catch(() => {});

    const offVoiceState = window.estraWindow?.onVoiceNoteState?.(state => {
      if (active && state) setVoiceNoteState(state);
    });
    const offMeter = window.estraWindow?.onVoiceNoteMeter?.(m => {
      if (active && m) setVoiceMeter(m);
    });
    const offDl = window.estraWindow?.onVoiceNoteDownload?.(p => {
      if (active && p) setVoiceDownloadProgress(p.percent >= 100 ? null : p);
    });
    const offErr = window.estraWindow?.onVoiceNoteError?.(err => {
      if (!active) return;
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'Voice To Note ขัดข้อง',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    });

    return () => {
      active = false;
      offVoiceState?.();
      offMeter?.();
      offDl?.();
      offErr?.();
    };
  }, []);

  useEffect(() => {
    if (isTauriDesktop()) return undefined;
    if (!crpAddonState.installed || !crpAddonState.config?.enabled || !crpAddonState.config?.showScheduleToasts) {
      return undefined;
    }
    const tick = () => {
      const cfg = crpAddonStateRef.current?.config;
      if (!cfg?.schedules?.length) return;
      const { alerts, nextFired } = evaluateDueSchedules(cfg.schedules, new Date(), crpFiredKeysRef.current);
      crpFiredKeysRef.current = nextFired;
      for (const alert of alerts) {
        if (cfg.playAlertSound !== false) playOverlayFriendChime();
        void pushOverlayNotification(alert.payload, { force: false, settings: settingsRef.current }).catch(() => {});
        setUiNotice({
          message: `${alert.payload.badge}: ${alert.payload.title}`,
          tone: 'notice',
          _seq: ++alertSeqRef.current
        });
      }
    };
    tick();
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, [crpAddonState.installed, crpAddonState.config?.enabled, crpAddonState.config?.showScheduleToasts]);

  useEffect(() => {
    const resolvedUrl = resolveSocialServerUrl(settings.socialServerUrl);
    if (!social.authenticated || !social.user?.id || !isSupabaseGatewayUrl(resolvedUrl)) {
      setRealtimeAccessToken('');
      return undefined;
    }
    let alive = true;
    let unsubscribe = () => {};

    void (async () => {
      try {
        const res = await fetchRealtimeToken(settings.socialServerUrl);
        if (!alive || !res?.accessToken) return;
        setRealtimeAccessToken(res.accessToken);
        unsubscribe = subscribeSocialRealtime({
          accessToken: res.accessToken,
          userId: social.user.id,
          socialServerUrl: resolvedUrl,
          onChange: () => {
            if (alive) void refreshSocial();
          },
          onDirectMessage: () => {
            if (alive) setChatRealtimeTick(t => t + 1);
          }
        });
      } catch {}
    })();

    return () => {
      alive = false;
      setRealtimeAccessToken('');
      unsubscribe();
    };
  }, [social.authenticated, social.user?.id, social.mode, settings.socialServerUrl, refreshSocial]);

  const currentInGameServer = presence.fivem?.running && active ? { id: active.id, name: active.name, ip: active.ip } : null;
  const currentServerKey = currentInGameServer ? `${currentInGameServer.id}|${currentInGameServer.name}|${currentInGameServer.ip}` : '';

  useEffect(() => {
    if (!social.authenticated) return;
    let alive = true;
    const beat = async () => {
      try {
        await sendHeartbeat({ activeServer: currentInGameServer }, settings.socialServerUrl);
        if (alive) {
          const state = await fetchSocialState(settings.socialServerUrl);
          if (alive) {
            setSocial(prev => ({
              ...prev,
              user: state.user || prev.user,
              friends: state.friends || [],
              incomingRequests: state.incomingRequests || [],
              outgoingRequests: state.outgoingRequests || [],
              favoriteServers: state.favoriteServers || prev.favoriteServers,
              incomingInvites: state.incomingInvites || [],
              outgoingInvites: state.outgoingInvites || [],
              unreadMessages: state.unreadMessages ?? prev.unreadMessages ?? {}
            }));
          }
        }
      } catch {}
    };
    void beat();
    const id = setInterval(beat, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [social.authenticated, currentServerKey, settings.socialServerUrl]);

  const openAccountModal = () => {
    setModal('auth');
  };

  const handleLogin = async payload => {
    const res = await loginAccount(payload, settings.socialServerUrl);
    if (res?.authenticated) {
      await refreshSocial();
      setScreenStage('launcher');
    }
  };

  const handleRegister = async payload => {
    const res = await registerAccount(payload, settings.socialServerUrl);
    if (res?.authenticated) {
      await refreshSocial();
      setScreenStage('launcher');
    }
  };

  const flushActivePlaytime = useCallback((nowMs = Date.now()) => {
    const sess = activePlaySessionRef.current;
    if (!sess.serverId || !sess.lastCommittedAtMs) return;
    const elapsedSec = Math.floor((nowMs - sess.lastCommittedAtMs) / 1000);
    if (elapsedSec < 1) return;
    sess.lastCommittedAtMs += elapsedSec * 1000;
    const playedIso = new Date(nowMs).toISOString();
    const targetId = sess.serverId;
    setServers(prev => prev.map(s => (
      s.id === targetId
        ? { ...s, playtimeSeconds: Math.max(0, Math.floor(Number(s.playtimeSeconds) || 0)) + elapsedSec, lastPlayedAt: playedIso }
        : s
    )));
  }, []);

  useEffect(() => {
    if (screenStage !== 'launcher' || !social.authenticated || hydratedUserIdRef.current !== social.user?.id || !presence.fivem?.running) {
      flushActivePlaytime();
      if (!presence.fivem?.running) {
        activePlaySessionRef.current = { serverId: '', lastCommittedAtMs: 0 };
        lastLaunchedServerIdRef.current = '';
      }
      return undefined;
    }

    const candidateId = activePlaySessionRef.current.serverId || lastLaunchedServerIdRef.current || active?.id || '';
    if (!candidateId || !serversRef.current.some(s => s.id === candidateId)) {
      return undefined;
    }

    if (!activePlaySessionRef.current.serverId) {
      const nowMs = Date.now();
      activePlaySessionRef.current = { serverId: candidateId, lastCommittedAtMs: nowMs };
      const startedIso = new Date(nowMs).toISOString();
      setServers(prev => prev.map(s => (
        s.id === candidateId ? { ...s, lastPlayedAt: startedIso } : s
      )));
    }

    const timer = setInterval(() => flushActivePlaytime(), 60_000);
    return () => clearInterval(timer);
  }, [presence.fivem?.running, screenStage, social.authenticated, social.user?.id, active?.id, flushActivePlaytime]);

  const handleLogout = async () => {
    const prevUserId = social.user?.id;
    clearTimeout(serverSyncTimerRef.current);
    const sess = activePlaySessionRef.current;
    let exportServers = serversRef.current;
    if (sess.serverId && sess.lastCommittedAtMs) {
      const nowMs = Date.now();
      const elapsedSec = Math.floor((nowMs - sess.lastCommittedAtMs) / 1000);
      if (elapsedSec >= 1) {
        const playedIso = new Date(nowMs).toISOString();
        exportServers = exportServers.map(s => (
          s.id === sess.serverId
            ? { ...s, playtimeSeconds: Math.max(0, Math.floor(Number(s.playtimeSeconds) || 0)) + elapsedSec, lastPlayedAt: playedIso }
            : s
        ));
      }
      activePlaySessionRef.current = { serverId: '', lastCommittedAtMs: 0 };
      lastLaunchedServerIdRef.current = '';
    }
    if (prevUserId && hydratedUserIdRef.current === prevUserId) {
      const dirtySig = buildServersSyncSignature(exportServers, activeIdRef.current);
      if (dirtySig !== lastSyncedSigRef.current) {
        try {
          const payload = buildServersSyncPayload(exportServers, activeIdRef.current);
          await syncUserServers(payload.servers, payload.activeServerId, settings.socialServerUrl);
        } catch {}
      }
    }
    await logoutAccount(settings.socialServerUrl);
    if (prevUserId) clearUserChatCache(prevUserId);
    hydratedUserIdRef.current = '';
    lastSyncedSigRef.current = '';
    setServers([]);
    setActiveId('');
    setNavStack([{ tab: 'general', serverId: '' }]);
    setNavIndex(0);
    clearTimeout(modalTimer.current);
    setRealtimeAccessToken('');
    setVisibleModal(null);
    setModalClosing(false);
    setSocial({ ...EMPTY_SOCIAL, loading: false });
    setScreenStage('auth');
  };

  const handleChangeStatus = async statusPref => {
    await sendHeartbeat({ statusPref, activeServer: currentInGameServer }, settings.socialServerUrl);
    await refreshSocial();
  };

  const handleUpdateProfile = async payload => {
    const res = await updateSocialProfile(payload, settings.socialServerUrl);
    if (res?.user) {
      setSocial(prev => ({ ...prev, user: res.user }));
    }
    return res;
  };

  const handleChangePassword = async payload => {
    const res = await changePassword(payload, settings.socialServerUrl);
    if (res?.user) {
      setSocial(prev => ({ ...prev, user: res.user }));
    }
    await refreshSocial();
    return res;
  };

  const communityLinks = resolveCommunityLinks(settings);

  const handleOpenCommunityLink = async (channel, url) => {
    if (!url) {
      setUiNotice({
        _seq: ++alertSeqRef.current,
        tone: 'error',
        message: `ไม่สามารถเปิด ${channel.thaiLabel} ได้`
      });
      return;
    }
    try {
      if (window.estraWindow?.openExternal) {
        await window.estraWindow.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setUiNotice({
        _seq: ++alertSeqRef.current,
        tone: 'error',
        message: err?.message || `ไม่สามารถเปิด ${channel.thaiLabel} ได้`
      });
    }
  };

  const applySocialStateResponse = res => {
    if (!res) return;
    setSocial(prev => ({
      ...prev,
      user: res.user || prev.user,
      friends: res.friends ?? prev.friends,
      incomingRequests: res.incomingRequests ?? prev.incomingRequests,
      outgoingRequests: res.outgoingRequests ?? prev.outgoingRequests,
      favoriteServers: res.favoriteServers ?? prev.favoriteServers,
      incomingInvites: res.incomingInvites ?? prev.incomingInvites,
      outgoingInvites: res.outgoingInvites ?? prev.outgoingInvites,
      unreadMessages: res.unreadMessages ?? prev.unreadMessages ?? {}
    }));
  };

  const handleToggleFavoriteServer = async targetServer => {
    if (!targetServer) return;
    const nextFav = !targetServer.favorite;
    setServers(prev => prev.map(s => (s.id === targetServer.id ? { ...s, favorite: nextFav } : s)));
    if (social.authenticated) {
      try {
        const res = await toggleRemoteFavoriteServer(
          { id: targetServer.id, name: targetServer.name, ip: targetServer.ip, tag: targetServer.tag || '' },
          nextFav,
          settings.socialServerUrl
        );
        if (res?.favoriteServers) {
          setSocial(prev => ({ ...prev, favoriteServers: res.favoriteServers }));
        }
      } catch {}
    }
  };

  const handleOpenGuide = () => {
    setGuideFirstVisit(false);
    setModal('guide');
  };

  const handleCloseGuide = () => {
    markOnboardingGuideSeen();
    setGuideFirstVisit(false);
    setModal(null);
  };

  const handleJoinFriendServer = (srv, options = {}) => {
    if (!srv?.ip && !srv?.id) return;
    const normalizedIp = normalizeDirectoryAddress(srv.ip || '') || srv.ip || '';
    const match = servers.find(
      s => s.id === srv.id || (normalizedIp && normalizeDirectoryAddress(s.ip) === normalizedIp) || s.ip === srv.ip
    );
    if (match) {
      handleSelectServer(match.id);
      setCenterTab('general');
      setFriendsMobileOpen(false);
      if (options.autoLaunch) void launchCity(match);
      return;
    }
    const dirMatch = lookupDirectoryServer(normalizedIp, directory);
    const created = {
      id: srv.id || crypto.randomUUID(),
      name: dirMatch?.name || srv.name || normalizedIp,
      ip: dirMatch?.address || normalizedIp,
      tag: normalizeServerTag(dirMatch?.tag, DEFAULT_SERVER_TAG),
      patchManifestUrl: dirMatch?.patchManifestUrl || '',
      customBannerUrl: dirMatch?.customBannerUrl || '',
      directorySlug: dirMatch?.slug || '',
      inGameName: '',
      cl2: false,
      favorite: false,
      status: 'Unknown',
      onlinePlayers: null,
      maxPlayers: null,
      gameBuild: null,
      lockPure: null,
      ping: null
    };
    setServers(prev => [created, ...prev]);
    handleSelectServer(created.id);
    setCenterTab('general');
    setFriendsMobileOpen(false);
    if (options.autoLaunch) void launchCity(created);
  };

  const launchCity = async city => {
    if (launchLock.current || settingsBusy) return;
    launchLock.current = true; setLaunchBusy(true); setLaunchFeedback(null); setGameNotice(null);
    const target = { ...city }, preferences = { ...settings };
    let attempt;
    try {
      attempt = historyStore.begin(target);
      const result = await prepareLaunch(target, preferences, {
        onModPresetSwitched: nextModState => {
          if (nextModState) setModState(nextModState);
        }
      });
      lastLaunchedServerIdRef.current = target.id;
      const nowIso = new Date().toISOString();
      setServers(prev => prev.map(s => (
        s.id === target.id && s.ip === target.ip
          ? { ...s, ...(result.serverInfo || {}), lastPlayedAt: nowIso }
          : s
      )));
      historyStore.finish(attempt, 'sent');
      setLaunchFeedback({ message: result.message, _seq: ++alertSeqRef.current });
      if (social.authenticated) {
        void sendHeartbeat({ activeServer: { id: target.id, name: target.name, ip: target.ip } }, settings.socialServerUrl).catch(() => {});
      }
    } catch (error) {
      if (attempt) historyStore.finish(attempt, 'failed', error.message);
      setLaunchFeedback({ error: error.message, _seq: ++alertSeqRef.current });
    } finally {
      launchLock.current = false; setLaunchBusy(false);
      void presenceService.checkPresence();
    }
  };

  const latestCity = latestHistoryCity(history.entries, servers);
  const launchLatestRef = useRef(null);
  launchLatestRef.current = () => { if (latestCity && !modal && !settingsBusy && screenStage === 'launcher') { setActiveId(latestCity.id); void launchCity(latestCity); } };
  useEffect(() => window.estraWindow?.onLaunchLatest(() => launchLatestRef.current?.()), []);
  useEffect(() => {
    window.estraWindow?.setLatestCity({ name: latestCity?.name || '', enabled: !!latestCity && !launchBusy && !modal && !settingsBusy && screenStage === 'launcher' });
  }, [latestCity?.id, latestCity?.name, launchBusy, modal, settingsBusy, screenStage]);
  const handleRefreshModPresets = useCallback(async () => {
    setModBusy(true);
    try {
      const next = await getModPresetsState(settingsRef.current.fivemPath);
      setModState(next);
    } catch {
      setModState(null);
    } finally {
      setModBusy(false);
    }
  }, []);

  const handleCreateModPreset = useCallback(async ({ name, description, cloneFromLive }) => {
    setModBusy(true);
    try {
      const next = await createModPreset({
        fivemPath: settingsRef.current.fivemPath,
        name,
        description,
        cloneFromLive
      });
      setModState(next);
      setUiNotice({ message: `สร้างโปรไฟล์ม็อด "${name}" สำเร็จ`, tone: 'notice', _seq: ++alertSeqRef.current });
      return true;
    } catch (err) {
      setUiNotice({ message: err?.message || 'สร้างโปรไฟล์ม็อดไม่สำเร็จ', tone: 'error', _seq: ++alertSeqRef.current });
      return false;
    } finally {
      setModBusy(false);
    }
  }, []);

  const handleSwitchModPreset = useCallback(async presetId => {
    setModBusy(true);
    try {
      const next = await switchModPreset(settingsRef.current.fivemPath, presetId);
      setModState(next);
      const switched = next?.presets?.find(p => p.id === presetId);
      setUiNotice({
        message: `สลับโปรไฟล์ม็อดเป็น "${switched?.name || presetId}" เรียบร้อยแล้ว`,
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
      return true;
    } catch (err) {
      setUiNotice({ message: err?.message || 'สลับโปรไฟล์ม็อดไม่สำเร็จ', tone: 'error', _seq: ++alertSeqRef.current });
      return false;
    } finally {
      setModBusy(false);
    }
  }, []);

  const handleDeleteModPreset = useCallback(async presetId => {
    setModBusy(true);
    try {
      const next = await deleteModPreset(settingsRef.current.fivemPath, presetId);
      setModState(next);
      setServers(prev => prev.map(s => (s.modPresetId === presetId ? { ...s, modPresetId: '' } : s)));
      setUiNotice({ message: 'ลบโปรไฟล์ม็อดออกจากคลังแล้ว', tone: 'notice', _seq: ++alertSeqRef.current });
    } catch (err) {
      setUiNotice({ message: err?.message || 'ลบโปรไฟล์ม็อดไม่สำเร็จ', tone: 'error', _seq: ++alertSeqRef.current });
    } finally {
      setModBusy(false);
    }
  }, []);

  const handleOpenModPresetFolder = useCallback(async presetId => {
    try {
      await openModPresetFolder(settingsRef.current.fivemPath, presetId);
    } catch (err) {
      setUiNotice({ message: err?.message || 'เปิดโฟลเดอร์ไม่สำเร็จ', tone: 'error', _seq: ++alertSeqRef.current });
    }
  }, []);

  const handleScanCrashLogs = useCallback(async ({ sinceUnixMs = null, openModalIfCrash = false, openModalAlways = false } = {}) => {
    setCrashScanning(true);
    setCrashFixFeedback(null);
    const currentCity = serversRef.current.find(s => s.id === (lastLaunchedServerIdRef.current || activeIdRef.current)) || null;
    try {
      const report = await analyzeCrashLogs({
        fivemPath: settingsRef.current.fivemPath,
        sinceUnixMs,
        server: currentCity
      });
      setCrashReport(report);
      if (openModalAlways || (openModalIfCrash && report?.isRecentSessionCrash)) {
        setModal('crash');
      }
      return report;
    } catch (err) {
      const msg = err?.message || 'ไม่สามารถอ่านไฟล์ Log/Crash ของ FiveM ได้';
      setCrashFixFeedback({ tone: 'error', message: msg });
      if (openModalAlways) setModal('crash');
      return null;
    } finally {
      setCrashScanning(false);
    }
  }, []);

  const handleProbeRoute = useCallback(async targetServer => {
    if (!targetServer?.ip) return;
    setRouteProbing(true);
    try {
      const report = await probeServerRoute(targetServer.ip, 6);
      setRouteReportByServer(prev => ({ ...prev, [targetServer.id]: report }));
      if (report?.avgMs != null) {
        setPingHistoryByServer(prev => ({
          ...prev,
          [targetServer.id]: appendPingHistory(prev[targetServer.id], {
            ts: report.checkedAtMs,
            ping: report.avgMs
          })
        }));
      }
    } catch (err) {
      setUiNotice({ message: err?.message || 'ทดสอบเส้นทางไม่สำเร็จ', tone: 'error', _seq: ++alertSeqRef.current });
    } finally {
      setRouteProbing(false);
    }
  }, []);

  const handleRunCrashFix = useCallback(async fixId => {
    if (!fixId || crashFixBusyId) return;
    if (fixId === 'open_mic_test') {
      setModal('mic');
      return;
    }
    if (fixId === 'open_network_diag') {
      setModal(null);
      setDiscoverSubTab('watcher');
      setCenterTab('discover');
      const targetSrv = serversRef.current.find(s => s.id === activeIdRef.current);
      if (targetSrv) void handleProbeRoute(targetSrv);
      return;
    }

    setCrashFixBusyId(fixId);
    setCrashFixFeedback(null);
    try {
      if (fixId === 'clean_cache') {
        const res = await cleanRealCache(settingsRef.current);
        if (!res?.success) throw new Error(res?.error || 'ล้างแคชไม่สำเร็จ');
        setCrashFixFeedback({ tone: 'notice', message: `ล้างแคชเมืองสำเร็จ (${(res.steps || []).join(' • ')})` });
      } else if (fixId === 'clean_shaders') {
        const res = await apiPost('/api/clean-maintenance', {
          fivemPath: settingsRef.current.fivemPath,
          categories: ['shaders']
        });
        if (!res?.success) throw new Error(res?.error || 'ล้าง Shader ไม่สำเร็จ');
        setCrashFixFeedback({ tone: 'notice', message: `ล้าง Shader / GPU Cache สำเร็จ (${res.deletedFiles || 0} ไฟล์)` });
      } else if (fixId === 'clean_logs_crashes') {
        const res = await apiPost('/api/clean-maintenance', {
          fivemPath: settingsRef.current.fivemPath,
          categories: ['logs', 'crashes']
        });
        if (!res?.success) throw new Error(res?.error || 'ล้าง Log/Crash ไม่สำเร็จ');
        setCrashFixFeedback({ tone: 'notice', message: `ล้างไฟล์ Log และ Crash เก่าแล้ว (${res.deletedFiles || 0} ไฟล์)` });
      } else if (fixId === 'switch_preset_clean') {
        const ok = await handleSwitchModPreset(CLEAN_PURE_PRESET_ID);
        if (!ok) throw new Error('สลับเป็น Clean Pure Mode ไม่สำเร็จ');
        setCrashFixFeedback({ tone: 'notice', message: 'สลับเป็น Clean Pure Mode เรียบร้อยแล้ว (ไฟล์ม็อดเดิมเก็บอยู่ในคลังปลอดภัย)' });
      }
    } catch (err) {
      setCrashFixFeedback({ tone: 'error', message: err?.message || 'ดำเนินการแก้ไขไม่สำเร็จ' });
    } finally {
      setCrashFixBusyId('');
    }
  }, [crashFixBusyId, handleProbeRoute, handleSwitchModPreset]);

  const handleToggleWatcher = useCallback(targetServer => {
    if (!targetServer?.id) return;
    setWatcherMap(prev => {
      const existing = prev[targetServer.id];
      const next = { ...prev };
      if (existing?.enabled) {
        delete next[targetServer.id];
        setUiNotice({ message: `หยุดเฝ้าเมือง ${targetServer.name} แล้ว`, tone: 'notice', _seq: ++alertSeqRef.current });
      } else {
        next[targetServer.id] = createDefaultWatcherRule(targetServer);
        watcherLastPollRef.current[targetServer.id] = 0;
        setUiNotice({
          message: `เริ่มเฝ้าเมือง ${targetServer.name} — จะแจ้งเตือนเมื่อรีสตาร์ทเสร็จหรือมีสล็อตว่าง`,
          tone: 'notice',
          _seq: ++alertSeqRef.current
        });
      }
      saveWatcherMap(next);
      return next;
    });
  }, []);

  const handleUpdateWatcher = useCallback((serverId, patch) => {
    setWatcherMap(prev => {
      const current = prev[serverId];
      if (!current) return prev;
      const next = { ...prev, [serverId]: { ...current, ...patch } };
      saveWatcherMap(next);
      return next;
    });
  }, []);

  const handleRearmWatcher = useCallback(serverId => {
    setWatcherMap(prev => {
      const current = prev[serverId];
      if (!current) return prev;
      const next = { ...prev, [serverId]: { ...current, armedRestart: true, armedSlots: true } };
      saveWatcherMap(next);
      return next;
    });
  }, []);

  const handleQuickJoinWatchedServer = useCallback(serverId => {
    const city = serversRef.current.find(s => s.id === serverId);
    if (!city) return;
    setWatcherReadyAlert(null);
    setActiveId(city.id);
    setCenterTab('general');
    void launchCity(city);
  }, []);

  useEffect(() => {
    if (screenStage !== 'launcher') return;
    void handleRefreshModPresets();
  }, [screenStage, settings.fivemPath, handleRefreshModPresets]);

  useEffect(() => {
    if (screenStage !== 'launcher') return;
    let cancelled = false;
    const tick = async () => {
      const currentMap = watcherMapRef.current;
      const enabledRules = Object.values(currentMap).filter(r => r?.enabled);
      if (!enabledRules.length) return;
      const now = Date.now();
      for (const rule of enabledRules) {
        if (cancelled) return;
        const city = serversRef.current.find(s => s.id === rule.serverId);
        if (!city) continue;
        const lastPoll = watcherLastPollRef.current[city.id] || 0;
        if (now - lastPoll < (rule.intervalSec || 30) * 1000) continue;
        watcherLastPollRef.current[city.id] = now;
        try {
          const result = await queryServerInfo(city);
          if (cancelled) return;
          const nowIso = new Date().toISOString();
          setServers(prev => prev.map(s => {
            if (s.id !== city.id || s.ip !== city.ip) return s;
            return {
              ...s,
              onlinePlayers: result.clients,
              maxPlayers: result.maxClients,
              status: result.status,
              ping: result.ping,
              gameBuild: result.gameBuild ?? s.gameBuild,
              lockPure: result.lockPure ?? s.lockPure,
              lastOnlineAt: result.status === 'Online' ? (result.checkedAt || nowIso) : (s.lastOnlineAt || null),
              checkedAt: result.checkedAt,
              queryError: result.error || null
            };
          }));
          const latestRule = watcherMapRef.current[city.id];
          if (!latestRule?.enabled) continue;
          const { nextRule, events } = evaluateWatcherTransition(latestRule, city, result, nowIso);
          setWatcherMap(prev => {
            if (!prev[city.id]?.enabled) return prev;
            const next = { ...prev, [city.id]: nextRule };
            saveWatcherMap(next);
            return next;
          });
          for (const ev of events) {
            setWatcherReadyAlert(ev);
            if (settingsRef.current.screenshotPlaySound !== false) {
              playOverlayFriendChime();
            }
            void pushOverlayNotification(
              {
                id: `watcher-${ev.serverId}-${Date.now()}`,
                kind: 'server-watcher',
                badge: ev.badge,
                title: ev.title,
                subtitle: ev.subtitle,
                detail: ev.detail,
                imageUrl: '',
                initials: ev.serverName.slice(0, 2).toUpperCase(),
                accentColor: '#10b981',
                durationMs: 7000
              },
              { settings: settingsRef.current }
            ).catch(() => {});
          }
        } catch {}
      }
    };
    const timer = window.setInterval(() => { void tick(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [screenStage]);

  useEffect(() => window.estraWindow?.onGameStatus(payload => {
    setGameNotice(payload ? { ...payload, _seq: ++alertSeqRef.current } : null);
    if (payload?.state === 'closed' && settingsRef.current.autoAnalyzeCrashAfterExit !== false) {
      void handleScanCrashLogs({
        sinceUnixMs: payload.sessionStartedAtMs || null,
        openModalIfCrash: true
      });
    }
  }), [handleScanCrashLogs]);

  const handleDismissAlert = useCallback(id => {
    if (id.startsWith('launch-')) {
      setLaunchFeedback(null);
      return;
    }
    if (id.startsWith('ui:')) {
      setUiNotice(null);
      return;
    }
    setDismissedAlerts(prev => ({ ...prev, [id]: true }));
  }, []);

  useDialogFocus(modal, () => { if (!confirmState) setModal(null); });
  useEffect(() => {
    const uid = social.user?.id;
    if (!social.authenticated || !uid || hydratedUserIdRef.current !== uid) return;
    try {
      saveServers(servers, uid);
      setStorageError('');
    } catch {
      setStorageError('บันทึกข้อมูลไม่ได้ กรุณาอนุญาต browser storage การเปลี่ยนแปลงอาจหายเมื่อปิดหน้า');
    }
  }, [servers, social.authenticated, social.user?.id]);

  useEffect(() => {
    const uid = social.user?.id;
    if (!social.authenticated || !uid || hydratedUserIdRef.current !== uid) return;
    try {
      saveActiveServerId(activeId, uid);
    } catch {
      setStorageError('บันทึกเซิร์ฟเวอร์ที่เลือกไม่ได้');
    }
  }, [activeId, social.authenticated, social.user?.id]);

  useEffect(() => {
    const uid = social.user?.id;
    if (!social.authenticated || !uid || hydratedUserIdRef.current !== uid) return;
    const nextSig = buildServersSyncSignature(servers, activeId);
    if (nextSig === lastSyncedSigRef.current) return;

    clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = setTimeout(async () => {
      if (hydratedUserIdRef.current !== uid) return;
      const payload = buildServersSyncPayload(serversRef.current, activeIdRef.current);
      const sentSig = JSON.stringify(payload);
      try {
        await syncUserServers(payload.servers, payload.activeServerId, settings.socialServerUrl);
        if (hydratedUserIdRef.current === uid) {
          lastSyncedSigRef.current = sentSig;
        }
      } catch {}
    }, 650);

    return () => clearTimeout(serverSyncTimerRef.current);
  }, [servers, activeId, social.authenticated, social.user?.id, settings.socialServerUrl]);

  useEffect(() => {
    if (!active) { setRefreshing(false); return; }
    const controller = new AbortController();
    let timer;
    const query = async () => {
      setRefreshing(true);
      const result = await queryServerInfo(activeRef.current, controller.signal);
      if (controller.signal.aborted) return;
      setServers(prev => prev.map(s => {
        if (s.id !== active.id || s.ip !== active.ip) return s;
        const syncedName = syncLiveServerName(s, result, directoryRef.current);
        return {
          ...s,
          name: syncedName.name,
          lastFetchedName: syncedName.lastFetchedName,
          onlinePlayers: result.clients, maxPlayers: result.maxClients,
          status: result.status, ping: result.ping, gameBuild: result.gameBuild,
          lockPure: result.lockPure,
          logoUrl: result.online ? (result.logoUrl || null) : s.logoUrl,
          iconSource: result.online ? (result.iconSource || null) : s.iconSource,
          bannerUrl: result.online ? (result.bannerUrl || null) : s.bannerUrl,
          connectingBannerUrl: result.online ? (result.connectingBannerUrl || null) : s.connectingBannerUrl,
          lastOnlineAt: result.status === 'Online' ? (result.checkedAt || new Date().toISOString()) : (s.lastOnlineAt || null),
          checkedAt: result.checkedAt, queryError: result.error || null
        };
      }));
      if (result.online && result.ping != null) {
        setPingHistoryByServer(prev => ({
          ...prev,
          [active.id]: appendPingHistory(prev[active.id], { ts: Date.now(), ping: result.ping })
        }));
      }
      setRefreshing(false);
      timer = setTimeout(query, 30000);
    };
    query();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active?.id, active?.ip, refreshKey]);

  const update = patch => setServers(prev => prev.map(s => s.id === patch.id ? { ...s, ...patch } : s));
  const savePrefs = value => {
    try { saveSettings(value); setSettings(value); setStorageError(''); }
    catch { setSettings(value); setStorageError('บันทึกการตั้งค่าไม่ได้ ค่าจะใช้ได้เฉพาะรอบนี้'); }
  };

  const handleInstallCrpAddon = async () => {
    if (crpAddonBusy) return;
    setCrpAddonBusy(true);
    try {
      const next = await installCrpOverlayAddon();
      setCrpAddonState(next);
      setUiNotice({
        message: 'ติดตั้ง FiveM C-RP-SRP Overlay สำเร็จ! กด Alt+O เพื่อเปิด-ปิดบนหน้าจอเกมได้ทันที',
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ติดตั้งฟีเจอร์เสริมไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    } finally {
      setCrpAddonBusy(false);
    }
  };

  const handleUninstallCrpAddon = async () => {
    if (crpAddonBusy) return;
    setCrpAddonBusy(true);
    try {
      const next = await uninstallCrpOverlayAddon();
      setCrpAddonState(next);
      setUiNotice({
        message: 'ถอนการติดตั้ง FiveM C-RP-SRP Overlay เรียบร้อยแล้ว',
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ถอนการติดตั้งไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    } finally {
      setCrpAddonBusy(false);
    }
  };

  const handleSaveCrpConfig = async nextConfig => {
    try {
      const next = await saveCrpOverlayConfig(nextConfig);
      setCrpAddonState(next);
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'บันทึกการตั้งค่า Overlay ไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    }
  };

  const handleToggleCrpOverlay = async () => {
    try {
      const nextVisible = await toggleCrpOverlayWindow(null);
      setCrpAddonState(prev => ({ ...prev, overlayVisible: Boolean(nextVisible) }));
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ไม่สามารถเปิด-ปิดหน้าต่าง Overlay ได้',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    }
  };

  const handleInstallVoiceAddon = async () => {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      const next = await installVoiceNoteAddon();
      setVoiceNoteState(next);
      setUiNotice({
        message: 'ติดตั้ง Voice To Note สำเร็จ! ตั้งค่า Engine หรือลองทดสอบ Word Suggestion ได้เลย',
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ติดตั้ง Voice To Note ไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleUninstallVoiceAddon = async () => {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      const next = await uninstallVoiceNoteAddon();
      setVoiceNoteState(next);
      setVoiceDownloadProgress(null);
      setUiNotice({
        message: 'ถอนการติดตั้ง Voice To Note เรียบร้อยแล้ว',
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ถอนการติดตั้ง Voice To Note ไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleSaveVoiceConfig = async nextConfig => {
    try {
      const next = await saveVoiceNoteConfig(nextConfig);
      setVoiceNoteState(next);
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'บันทึกการตั้งค่า Voice To Note ไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    }
  };

  const handleStartVoiceCapture = async () => {
    try {
      const next = await startVoiceNoteCapture();
      setVoiceNoteState(next);
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'เริ่มจับเสียงไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    }
  };

  const handleStopVoiceCapture = async () => {
    try {
      const next = await stopVoiceNoteCapture();
      setVoiceNoteState(next);
    } catch {}
  };

  const handleDownloadLocalWhisper = async modelId => {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      const next = await downloadLocalWhisperRuntime(modelId);
      setVoiceNoteState(next);
      setVoiceDownloadProgress(null);
      setUiNotice({
        message: 'ดาวน์โหลด Local Whisper Engine และโมเดลพร้อมใช้งานแล้ว!',
        tone: 'notice',
        _seq: ++alertSeqRef.current
      });
    } catch (err) {
      setVoiceDownloadProgress(null);
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ดาวน์โหลด Local Whisper ไม่สำเร็จ',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleToggleVoiceOverlay = async () => {
    try {
      const nextVisible = await toggleVoiceNoteOverlayWindow(null);
      setVoiceNoteState(prev => ({ ...prev, overlayVisible: Boolean(nextVisible) }));
    } catch (err) {
      setUiNotice({
        message: typeof err === 'string' ? err : err?.message || 'ไม่สามารถเปิด-ปิดหน้าต่าง Voice Overlay ได้',
        tone: 'error',
        _seq: ++alertSeqRef.current
      });
    }
  };

  const floatingAlerts = [];
  if (social.authenticated && social.user?.mustChangePassword && !dismissedAlerts[`must-chpw:${social.user.id}`]) {
    floatingAlerts.push({
      id: `must-chpw:${social.user.id}`,
      tone: 'notice',
      content: (
        <>
          บัญชีนี้สมัครผ่าน Discord — กรุณาเปลี่ยนรหัสผ่านใหม่ทันทีหลัง Login ครั้งแรก{' '}
          <button type="button" className="btn-inline-cobalt" onClick={openAccountModal}>
            เปลี่ยนรหัสผ่าน
          </button>
        </>
      )
    });
  }
  if (launcherUpdate?.available && !dismissedAlerts[`update:${launcherUpdate.version}`]) {
    floatingAlerts.push({
      id: `update:${launcherUpdate.version}`,
      tone: 'notice',
      content: (
        <>
          มี Estra Launcher เวอร์ชันใหม่ v{launcherUpdate.version} พร้อมอัปเดต —{' '}
          <button
            type="button"
            className="btn-inline-cobalt"
            onClick={() => requestConfirm({
              title: 'อัปเดต Estra Launcher',
              message: `ต้องการดาวน์โหลดและติดตั้งเวอร์ชัน v${launcherUpdate.version} และรีสตาร์ทโปรแกรมใช่หรือไม่?`,
              detail: 'ระบบจะตรวจสอบลายเซ็นความปลอดภัยก่อนติดตั้งอัตโนมัติ',
              confirmLabel: 'อัปเดตเลย',
              tone: 'primary',
              onConfirm: () => installLauncherUpdate(DEFAULT_GITHUB_REPO)
            })}
          >
            อัปเดตเลย
          </button>{' '}
          <button type="button" className="btn-inline-orange" onClick={() => setModal('patcher')}>
            ดูรายละเอียด
          </button>
        </>
      )
    });
  }
  if (gameNotice && ['closed', 'startup-timeout', 'detection-error'].includes(gameNotice.state)) {
    const gameAlertId = `game:${gameNotice._seq || 0}`;
    if (!dismissedAlerts[gameAlertId]) {
      floatingAlerts.push({
        id: gameAlertId,
        tone: gameNotice.state === 'detection-error' ? 'error' : 'notice',
        content: gameNotice.message
      });
    }
  }
  if (launchFeedback?.error) {
    floatingAlerts.push({
      id: `launch-err:${launchFeedback._seq || 0}`,
      tone: 'error',
      content: launchFeedback.error
    });
  }
  if (launchFeedback?.message) {
    floatingAlerts.push({
      id: `launch-msg:${launchFeedback._seq || 0}`,
      tone: 'notice',
      content: launchFeedback.message
    });
  }
  if (uiNotice?.message) {
    floatingAlerts.push({
      id: `ui:${uiNotice._seq || 0}`,
      tone: uiNotice.tone || 'notice',
      content: uiNotice.message
    });
  }
  if (history.error && !dismissedAlerts[`history:${history.error}`]) {
    floatingAlerts.push({
      id: `history:${history.error}`,
      tone: 'error',
      content: history.error
    });
  }

  return (
    <div className={`launcher-window${modalClosing ? ' modal-closing' : ''}`}>
      <CityBackground server={active} onStatus={setBackground} />
      {storageError && <p role="alert" className="error-message">{storageError}</p>}
      {screenStage === 'splash' ? (
        <PrelaunchPatcher
          activeServer={active}
          settings={settings}
          launcherUpdate={launcherUpdate}
          onLauncherUpdateChange={setLauncherUpdate}
          onOpenPatcherSettings={() => setModal('patcher')}
          onEnterLauncher={() => setScreenStage(social.authenticated ? 'launcher' : 'auth')}
          nextStepLabel={social.authenticated ? 'เข้าสู่หน้าลันเชอร์' : 'เข้าสู่ระบบ / สมัครสมาชิก'}
          skipStepLabel={social.authenticated ? 'ข้ามไปหน้าลันเชอร์' : 'ข้ามไปหน้าเข้าสู่ระบบ'}
          paused={modal !== null || updateModalOpen}
          onOpenUpdateModal={() => {
            setDismissedUpdateVersion('');
            setUpdateModalOpen(true);
          }}
        />
      ) : screenStage === 'auth' ? (
        <AuthScreen
          social={social}
          settings={settings}
          communityLinks={communityLinks}
          onOpenCommunityLink={handleOpenCommunityLink}
          onOpenSplash={() => setScreenStage('splash')}
          onLogin={handleLogin}
          onRegister={handleRegister}
        />
      ) : (
        <div className="launcher-body">
          <ServerSidebar
            servers={servers}
            activeServerId={active?.id}
            centerTab={centerTab}
            onChangeTab={handleChangeTab}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onGoBack={handleGoBack}
            onGoForward={handleGoForward}
            onSelectServer={handleSelectServer}
            onToggleFavoriteServer={handleToggleFavoriteServer}
            onRemoveServer={id => { setServers(prev => prev.filter(s => s.id !== id)); if (active?.id === id) setActiveId(''); }}
            onOpenNewServerModal={() => setModal('new')}
            onOpenLibrary={() => setModal('library')}
            onOpenHistory={() => setModal('history')}
            onOpenSettings={() => setModal('settings')}
            onOpenMicTest={() => setModal('mic')}
            onOpenPatcher={() => setModal('patcher')}
            onOpenCacheModal={() => setModal('cache')}
            onOpenGuide={handleOpenGuide}
            hasLauncherUpdate={!!launcherUpdate?.available}
            social={social}
            crpAddonInstalled={Boolean(crpAddonState?.installed || voiceNoteState?.installed)}
            onOpenAuth={openAccountModal}
            communityLinks={communityLinks}
            onOpenCommunityLink={handleOpenCommunityLink}
          />

          <div className="launcher-main">
            <div className="header-wrap" data-tauri-drag-region>
              <Header
                centerTab={centerTab}
                onChangeTab={handleChangeTab}
                onOpenLibrary={() => setModal('library')}
                onOpenPatcher={() => setModal('patcher')}
                onOpenGuide={handleOpenGuide}
                hasLauncherUpdate={!!launcherUpdate?.available}
                launcherUpdate={launcherUpdate}
                gameNotice={gameNotice}
                social={social}
                onToggleFriendsMobile={() => setFriendsMobileOpen(v => !v)}
              />
            </div>

            <AlertToastStack alerts={floatingAlerts} onDismiss={handleDismissAlert} />

            <MainLauncher
              key={active?.id || 'empty'}
              server={active}
              servers={servers}
              directory={directory}
              centerTab={centerTab}
              onChangeTab={handleChangeTab}
              settings={settings}
              onUpdateServer={update}
              onToggleFavoriteServer={handleToggleFavoriteServer}
              onSelectServer={handleSelectServer}
              backgroundKind={background.owner === `${active?.id || ''}|${active?.ip || ''}` ? background.kind : 'loading'}
              busy={launchBusy || settingsBusy}
              onLaunch={launchCity}
              onRefresh={() => setRefreshKey(k => k + 1)}
              isRefreshing={refreshing}
              onOpenNewServerModal={() => setModal('new')}
              onOpenLibrary={() => setModal('library')}
              onOpenSettings={() => setModal('settings')}
              onOpenCacheModal={() => setModal('cache')}
              onOpenMicTest={() => setModal('mic')}
              onOpenPatcher={() => setModal('patcher')}
              onOpenHistory={() => setModal('history')}
              onOpenGuide={handleOpenGuide}
              historyEntries={history.entries}
              social={social}
              launcherUpdate={launcherUpdate}
              screenshotCaptureVersion={screenshotCaptureVersion}
              crpAddonState={crpAddonState}
              crpAddonBusy={crpAddonBusy}
              onInstallCrpAddon={handleInstallCrpAddon}
              onUninstallCrpAddon={handleUninstallCrpAddon}
              onSaveCrpConfig={handleSaveCrpConfig}
              onToggleCrpOverlay={handleToggleCrpOverlay}
              voiceState={voiceNoteState}
              voiceMeter={voiceMeter}
              voiceDownloadProgress={voiceDownloadProgress}
              voiceBusy={voiceBusy}
              onInstallVoiceAddon={handleInstallVoiceAddon}
              onUninstallVoiceAddon={handleUninstallVoiceAddon}
              onSaveVoiceConfig={handleSaveVoiceConfig}
              onStartVoiceCapture={handleStartVoiceCapture}
              onStopVoiceCapture={handleStopVoiceCapture}
              onDownloadLocalWhisper={handleDownloadLocalWhisper}
              onToggleVoiceOverlay={handleToggleVoiceOverlay}
              onRequestConfirm={requestConfirm}
              playingServerId={presence.fivem?.running ? (activePlaySessionRef.current.serverId || lastLaunchedServerIdRef.current || active?.id || '') : ''}
              onNotify={(message, tone = 'notice') => setUiNotice({ message, tone, _seq: ++alertSeqRef.current })}
              discoverSubTab={discoverSubTab}
              onChangeDiscoverSubTab={setDiscoverSubTab}
              crashReport={crashReport}
              crashScanning={crashScanning}
              crashFixBusyId={crashFixBusyId}
              crashFixFeedback={crashFixFeedback}
              onScanCrashLogs={() => void handleScanCrashLogs({})}
              onOpenCrashAdvisor={() => void handleScanCrashLogs({ openModalAlways: true })}
              onRunCrashFix={handleRunCrashFix}
              modState={modState}
              modBusy={modBusy}
              onRefreshModPresets={handleRefreshModPresets}
              onCreateModPreset={handleCreateModPreset}
              onSwitchModPreset={handleSwitchModPreset}
              onDeleteModPreset={handleDeleteModPreset}
              onOpenModPresetFolder={handleOpenModPresetFolder}
              onBindServerModPreset={(serverId, presetId) => update({ id: serverId, modPresetId: presetId })}
              onToggleAutoCleanPure={checked => savePrefs({ ...settings, autoCleanModsForPureMode: checked })}
              routeReport={active ? routeReportByServer[active.id] || null : null}
              pingHistory={active ? pingHistoryByServer[active.id] || [] : []}
              routeProbing={routeProbing}
              watcherMap={watcherMap}
              watcherReadyAlert={watcherReadyAlert}
              onProbeRoute={handleProbeRoute}
              onToggleWatcher={handleToggleWatcher}
              onUpdateWatcher={handleUpdateWatcher}
              onRearmWatcher={handleRearmWatcher}
              onQuickJoinWatchedServer={handleQuickJoinWatchedServer}
              onDismissWatcherAlert={() => setWatcherReadyAlert(null)}
            />
          </div>

          {friendsMobileOpen && (
            <div className="friends-mobile-backdrop" onClick={() => setFriendsMobileOpen(false)} aria-hidden="true" />
          )}

          <FriendsSidebar
            openOnMobile={friendsMobileOpen}
            onCloseMobile={() => setFriendsMobileOpen(false)}
            social={social}
            activeServer={active}
            onOpenAuth={openAccountModal}
            onSendFriendRequest={async target => {
              const res = await sendFriendRequest(target, settings.socialServerUrl);
              applySocialStateResponse(res);
              return res;
            }}
            onRespondRequest={async (requestId, action) => {
              const res = await respondFriendRequest(requestId, action, settings.socialServerUrl);
              applySocialStateResponse(res);
            }}
            onToggleFavoriteFriend={async (friendId, favorite) => {
              const res = await toggleFavoriteFriend(friendId, favorite, settings.socialServerUrl);
              applySocialStateResponse(res);
            }}
            onRemoveFriend={async friendId => {
              const res = await removeFriend(friendId, settings.socialServerUrl);
              applySocialStateResponse(res);
            }}
            onSearchUsers={query => searchSocialUsers(query, settings.socialServerUrl)}
            onInviteFriend={async (friendId, server) => {
              const targetSrv = server || active;
              const res = await sendGameInvite(
                friendId,
                { id: targetSrv.id, name: targetSrv.name, ip: targetSrv.ip },
                settings.socialServerUrl
              );
              applySocialStateResponse(res);
              return res;
            }}
            onRespondInvite={async (inviteId, action, serverToJoin) => {
              const res = await respondGameInvite(inviteId, action, settings.socialServerUrl);
              applySocialStateResponse(res);
              if (action === 'accept' && (res?.inviteServer || serverToJoin)) {
                handleJoinFriendServer(res?.inviteServer || serverToJoin, { autoLaunch: true });
              }
              return res;
            }}
            onJoinFriendServer={handleJoinFriendServer}
            onFetchChatHistory={async friendId => {
              const res = await fetchChatHistory(friendId, settings.socialServerUrl);
              if (res?.unreadMessages) {
                setSocial(prev => ({ ...prev, unreadMessages: res.unreadMessages }));
              }
              return res;
            }}
            onSendChatMessage={async (friendId, body) => {
              const res = await sendChatMessage(friendId, body, settings.socialServerUrl);
              if (res?.unreadMessages) {
                setSocial(prev => ({ ...prev, unreadMessages: res.unreadMessages }));
              }
              return res;
            }}
            onMarkChatRead={async friendId => {
              const res = await markChatRead(friendId, settings.socialServerUrl);
              if (res?.unreadMessages) {
                setSocial(prev => ({ ...prev, unreadMessages: res.unreadMessages }));
              }
              return res;
            }}
            realtimeAccessToken={realtimeAccessToken}
            socialServerUrl={resolveSocialServerUrl(settings.socialServerUrl)}
            chatRealtimeTick={chatRealtimeTick}
            onRequestConfirm={requestConfirm}
          />
        </div>
      )}

      {screenStage === 'launcher' && social.authenticated && (() => {
        const activeInvite = (social.incomingInvites || []).find(inv => !dismissedInvites[inv.id]);
        if (!activeInvite) return null;
        return (
          <div className="game-invite-toast" role="status" aria-live="polite">
            <UserAvatar user={activeInvite.fromUser} fallbackInitials="FR" showPresence />
            <div className="game-invite-toast-meta">
              <strong>{activeInvite.fromUser?.displayName || 'เพื่อน'} ชวนเล่นด้วยกัน</strong>
              <small>เมือง: {activeInvite.server?.name}</small>
            </div>
            <div className="game-invite-toast-actions">
              <button
                type="button"
                className="btn-inline-cobalt"
                onClick={async () => {
                  setDismissedInvites(prev => ({ ...prev, [activeInvite.id]: true }));
                  try {
                    const res = await respondGameInvite(activeInvite.id, 'accept', settings.socialServerUrl);
                    applySocialStateResponse(res);
                    handleJoinFriendServer(res?.inviteServer || activeInvite.server, { autoLaunch: true });
                  } catch (err) {
                    setLaunchFeedback({ error: err.message, _seq: ++alertSeqRef.current });
                  }
                }}
              >
                เข้าร่วมเลย
              </button>
              <button
                type="button"
                className="req-decline"
                aria-label="ปฏิเสธคำชวนเล่น"
                onClick={async () => {
                  setDismissedInvites(prev => ({ ...prev, [activeInvite.id]: true }));
                  try {
                    const res = await respondGameInvite(activeInvite.id, 'decline', settings.socialServerUrl);
                    applySocialStateResponse(res);
                  } catch {}
                }}
              >
                ปฏิเสธ
              </button>
            </div>
          </div>
        );
      })()}

      {modal === 'library' && (
        <ServerLibrary
          servers={servers}
          activeId={active?.id}
          onClose={() => setModal(null)}
          onAdd={() => setModal('new')}
          onSelect={id => { handleSelectServer(id); setModal(null); }}
          onToggleFavorite={handleToggleFavoriteServer}
          onRemove={id => { setServers(prev => prev.filter(s => s.id !== id)); if (active?.id === id) setActiveId(''); }}
          onRequestConfirm={requestConfirm}
        />
      )}
      {modal === 'history' && (
        <LaunchHistory
          history={history}
          servers={servers}
          busy={launchBusy}
          onLaunch={city => { setActiveId(city.id); void launchCity(city); }}
          onClear={() => historyStore.clear()}
          onClose={() => setModal(null)}
          onRequestConfirm={requestConfirm}
        />
      )}
      <AuthModal
        isOpen={modal === 'auth'}
        onClose={() => setModal(null)}
        social={social}
        settings={settings}
        onLogout={handleLogout}
        onChangeStatus={handleChangeStatus}
        onUpdateProfile={handleUpdateProfile}
        onChangePassword={handleChangePassword}
        onRequestConfirm={requestConfirm}
      />
      <MicTestModal isOpen={modal === 'mic'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} />
      <CacheModal isOpen={modal === 'cache'} onClose={() => setModal(null)} settings={settings} />
      <CrashAdvisorModal
        isOpen={modal === 'crash'}
        onClose={() => setModal(null)}
        report={crashReport}
        scanning={crashScanning}
        actionBusyId={crashFixBusyId}
        actionFeedback={crashFixFeedback}
        onRescan={() => void handleScanCrashLogs({})}
        onRunFix={handleRunCrashFix}
        onNotify={(message, tone = 'notice') => setUiNotice({ message, tone, _seq: ++alertSeqRef.current })}
      />
      <SettingsModal isOpen={modal === 'settings'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} activeServer={active} onMaintenanceBusy={setSettingsBusy} gameEnv={gameEnv} onGameEnvUpdate={setGameEnv} onRequestConfirm={requestConfirm} />
      <PatcherModal isOpen={modal === 'patcher'} onClose={() => setModal(null)} activeServer={active} settings={settings} onUpdateServer={update} launcherUpdate={launcherUpdate} onLauncherUpdateChange={setLauncherUpdate} onBusyChange={setSettingsBusy} onOpenFullPatcher={screenStage === 'launcher' ? () => setScreenStage('splash') : null} onRequestConfirm={requestConfirm} />
      <NewServerModal isOpen={modal === 'new'} onClose={() => setModal(null)} directory={directory} onAddServer={server => { setServers(prev => [server, ...prev]); setActiveId(server.id); }} />
      <GuideModal
        isOpen={modal === 'guide'}
        onClose={handleCloseGuide}
        settings={settings}
        gameEnv={gameEnv}
        servers={servers}
        isFirstVisit={guideFirstVisit}
        onOpenSettings={() => { markOnboardingGuideSeen(); setModal('settings'); }}
        onOpenNewServerModal={() => { markOnboardingGuideSeen(); setModal('new'); }}
        onOpenMicTest={() => { markOnboardingGuideSeen(); setModal('mic'); }}
        onOpenCacheModal={() => { markOnboardingGuideSeen(); setModal('cache'); }}
      />
      <UpdatePromptModal
        isOpen={updateModalOpen}
        launcherUpdate={launcherUpdate}
        onBusyChange={setSettingsBusy}
        onClose={() => {
          if (launcherUpdate?.version) setDismissedUpdateVersion(launcherUpdate.version);
          setUpdateModalOpen(false);
        }}
      />
      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message}
        detail={confirmState?.detail}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        tone={confirmState?.tone}
        onConfirm={confirmState?.onConfirm}
        onCancel={closeConfirm}
      />
      {!isTauriDesktop() && <OverlayApp />}
    </div>
  );
}
