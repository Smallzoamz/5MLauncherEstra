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
import { AlertToastStack } from './components/AlertToastStack';
import { UserAvatar } from './components/UserAvatar';
import useDialogFocus from './components/useDialogFocus';
import { getSavedServers, saveServers, getActiveServerId, saveActiveServerId, getSettings, saveSettings } from './services/storageService';
import { resolveCommunityLinks } from './shared/communityLinks';
import { queryServerInfo } from './services/fivemService';
import CityBackground from './components/CityBackground';
import audioService from './services/audioService';
import presenceService from './services/presenceService';
import { prepareLaunch } from './services/prepareLaunch';
import { createLaunchHistory, latestHistoryCity } from './services/launchHistory';
import LaunchHistory from './components/LaunchHistory';
import PrelaunchPatcher from './components/PrelaunchPatcher';
import { checkLauncherUpdate, installLauncherUpdate } from './services/patcherService';
import { DEFAULT_GITHUB_REPO } from './shared/patcherConfig';
import {
  changePassword,
  fetchRealtimeToken,
  fetchSocialSession,
  fetchSocialState,
  loginAccount,
  logoutAccount,
  registerAccount,
  removeFriend,
  respondFriendRequest,
  respondGameInvite,
  searchSocialUsers,
  sendFriendRequest,
  sendGameInvite,
  sendHeartbeat,
  toggleFavoriteFriend,
  toggleRemoteFavoriteServer,
  updateSocialProfile
} from './services/socialService';
import { apiGet } from './services/apiService';
import { subscribeSocialRealtime } from './services/socialRealtime';
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
  outgoingInvites: []
};

export default function App() {
  const [servers, setServers] = useState(getSavedServers);
  const [activeId, setActiveId] = useState(getActiveServerId);
  const [settings, setSettings] = useState(getSettings);
  const [modal, setVisibleModal] = useState(null);
  const [modalClosing, setModalClosing] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const modalTimer = useRef(null);
  const [background, setBackground] = useState({});
  const [centerTab, setCenterTab] = useState('general');
  const [navStack, setNavStack] = useState([{ tab: 'general', serverId: getActiveServerId() }]);
  const [navIndex, setNavIndex] = useState(0);
  const [friendsMobileOpen, setFriendsMobileOpen] = useState(false);
  const [social, setSocial] = useState(EMPTY_SOCIAL);
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
  const [screenStage, setScreenStage] = useState('splash');
  const [presence, setPresence] = useState(presenceService.getPresence());
  const mustChangePromptedRef = useRef(false);

  useEffect(() => presenceService.subscribe(setPresence), []);

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

  const mergeRemoteFavorites = useCallback(favList => {
    if (!Array.isArray(favList) || !favList.length) return;
    const favIds = new Set(favList.map(f => f.id));
    setServers(prev => {
      let changed = false;
      const next = prev.map(s => {
        if (favIds.has(s.id) && !s.favorite) {
          changed = true;
          return { ...s, favorite: true };
        }
        return s;
      });
      return changed ? next : prev;
    });
  }, []);

  const refreshSocial = useCallback(async () => {
    try {
      const me = await fetchSocialSession(settings.socialServerUrl);
      if (!me?.authenticated) {
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
        outgoingInvites: state.outgoingInvites || []
      });
      mergeRemoteFavorites(state.favoriteServers);
    } catch {
      setSocial(prev => ({ ...prev, loading: false }));
    }
  }, [settings.socialServerUrl, mergeRemoteFavorites]);

  useEffect(() => {
    void refreshSocial();
  }, [refreshSocial]);

  useEffect(() => {
    let activeDetect = true;
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
    const resolvedUrl = resolveSocialServerUrl(settings.socialServerUrl);
    if (!social.authenticated || !social.user?.id || !isSupabaseGatewayUrl(resolvedUrl)) return undefined;
    let alive = true;
    let unsubscribe = () => {};

    void (async () => {
      try {
        const res = await fetchRealtimeToken(settings.socialServerUrl);
        if (!alive || !res?.accessToken) return;
        unsubscribe = subscribeSocialRealtime({
          accessToken: res.accessToken,
          userId: social.user.id,
          socialServerUrl: resolvedUrl,
          onChange: () => {
            if (alive) void refreshSocial();
          }
        });
      } catch {}
    })();

    return () => {
      alive = false;
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
              outgoingInvites: state.outgoingInvites || []
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

  const handleLogout = async () => {
    await logoutAccount(settings.socialServerUrl);
    clearTimeout(modalTimer.current);
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
      outgoingInvites: res.outgoingInvites ?? prev.outgoingInvites
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

  const handleJoinFriendServer = (srv, options = {}) => {
    if (!srv?.ip && !srv?.id) return;
    const match = servers.find(s => s.id === srv.id || s.ip === srv.ip);
    if (match) {
      handleSelectServer(match.id);
      setCenterTab('general');
      setFriendsMobileOpen(false);
      if (options.autoLaunch) void launchCity(match);
      return;
    }
    const created = {
      id: srv.id || crypto.randomUUID(),
      name: srv.name || srv.ip,
      ip: srv.ip,
      tag: 'Roleplay',
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
      const result = await prepareLaunch(target, preferences);
      if (result.serverInfo) setServers(prev => prev.map(s => s.id === target.id && s.ip === target.ip ? { ...s, ...result.serverInfo } : s));
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
  useEffect(() => window.estraWindow?.onGameStatus(payload => {
    setGameNotice(payload ? { ...payload, _seq: ++alertSeqRef.current } : null);
  }), []);

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
  useEffect(() => { try { saveServers(servers); setStorageError(''); } catch { setStorageError('บันทึกข้อมูลไม่ได้ กรุณาอนุญาต browser storage การเปลี่ยนแปลงอาจหายเมื่อปิดหน้า'); } }, [servers]);
  useEffect(() => { try { saveActiveServerId(activeId); } catch { setStorageError('บันทึกเซิร์ฟเวอร์ที่เลือกไม่ได้'); } }, [activeId]);

  useEffect(() => {
    if (!active) { setRefreshing(false); return; }
    const controller = new AbortController();
    let timer;
    const query = async () => {
      setRefreshing(true);
      const result = await queryServerInfo(activeRef.current, controller.signal);
      if (controller.signal.aborted) return;
      setServers(prev => prev.map(s => s.id === active.id && s.ip === active.ip ? {
        ...s, onlinePlayers: result.clients, maxPlayers: result.maxClients,
        status: result.status, ping: result.ping, gameBuild: result.gameBuild,
        lockPure: result.lockPure,
        logoUrl: result.online ? (result.logoUrl || null) : s.logoUrl,
        iconSource: result.online ? (result.iconSource || null) : s.iconSource,
        bannerUrl: result.online ? (result.bannerUrl || null) : s.bannerUrl,
        connectingBannerUrl: result.online ? (result.connectingBannerUrl || null) : s.connectingBannerUrl,
        checkedAt: result.checkedAt, queryError: result.error || null
      } : s));
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
          paused={modal !== null}
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
            hasLauncherUpdate={!!launcherUpdate?.available}
            social={social}
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
              historyEntries={history.entries}
              social={social}
              launcherUpdate={launcherUpdate}
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
      <SettingsModal isOpen={modal === 'settings'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} activeServer={active} onMaintenanceBusy={setSettingsBusy} gameEnv={gameEnv} onGameEnvUpdate={setGameEnv} onRequestConfirm={requestConfirm} />
      <PatcherModal isOpen={modal === 'patcher'} onClose={() => setModal(null)} activeServer={active} settings={settings} onUpdateServer={update} launcherUpdate={launcherUpdate} onLauncherUpdateChange={setLauncherUpdate} onBusyChange={setSettingsBusy} onOpenFullPatcher={screenStage === 'launcher' ? () => setScreenStage('splash') : null} onRequestConfirm={requestConfirm} />
      <NewServerModal isOpen={modal === 'new'} onClose={() => setModal(null)} onAddServer={server => { setServers(prev => [server, ...prev]); setActiveId(server.id); }} />
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
    </div>
  );
}
