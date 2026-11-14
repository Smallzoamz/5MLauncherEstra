import React, { useState, useEffect, useRef, useCallback } from 'react';
import ServerLibrary from './components/ServerLibrary';
import Header from './components/Header';
import ServerSidebar from './components/ServerSidebar';
import FriendsSidebar from './components/FriendsSidebar';
import MainLauncher from './components/MainLauncher';
import AuthModal from './components/AuthModal';
import MicTestModal from './components/MicTestModal';
import CacheModal from './components/CacheModal';
import SettingsModal from './components/SettingsModal';
import NewServerModal from './components/NewServerModal';
import PatcherModal from './components/PatcherModal';
import useDialogFocus from './components/useDialogFocus';
import { getSavedServers, saveServers, getActiveServerId, saveActiveServerId, getSettings, saveSettings } from './services/storageService';
import { queryServerInfo } from './services/fivemService';
import CityBackground from './components/CityBackground';
import audioService from './services/audioService';
import presenceService from './services/presenceService';
import { prepareLaunch } from './services/prepareLaunch';
import { createLaunchHistory, latestHistoryCity } from './services/launchHistory';
import LaunchHistory from './components/LaunchHistory';
import PrelaunchPatcher from './components/PrelaunchPatcher';
import { checkLauncherUpdate } from './services/patcherService';
import { isConfiguredGithubRepo } from './shared/patcherConfig';
import {
  fetchRealtimeToken,
  fetchSocialSession,
  fetchSocialState,
  loginAccount,
  logoutAccount,
  registerAccount,
  removeFriend,
  respondFriendRequest,
  searchSocialUsers,
  seedDemoFriends,
  sendFriendRequest,
  sendHeartbeat,
  toggleFavoriteFriend,
  toggleRemoteFavoriteServer
} from './services/socialService';
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
  favoriteServers: []
};

export default function App() {
  const [servers, setServers] = useState(getSavedServers);
  const [activeId, setActiveId] = useState(getActiveServerId);
  const [settings, setSettings] = useState(getSettings);
  const [modal, setVisibleModal] = useState(null);
  const [authInitialMode, setAuthInitialMode] = useState('login');
  const [modalClosing, setModalClosing] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const modalTimer = useRef(null);
  const [background, setBackground] = useState({});
  const [centerTab, setCenterTab] = useState('general');
  const [navStack, setNavStack] = useState([{ tab: 'general', serverId: getActiveServerId() }]);
  const [navIndex, setNavIndex] = useState(0);
  const [friendsMobileOpen, setFriendsMobileOpen] = useState(false);
  const [social, setSocial] = useState(EMPTY_SOCIAL);

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
  const [showPatcherScreen, setShowPatcherScreen] = useState(true);
  const [presence, setPresence] = useState(presenceService.getPresence());

  useEffect(() => presenceService.subscribe(setPresence), []);

  useEffect(() => {
    if (showPatcherScreen || !isConfiguredGithubRepo(settings.githubRepo)) return;
    let active = true;
    void checkLauncherUpdate(settings.githubRepo).then(info => { if (active) setLauncherUpdate(info); }).catch(() => {});
    return () => { active = false; };
  }, [settings.githubRepo, showPatcherScreen]);

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
        favoriteServers: state.favoriteServers || []
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
              favoriteServers: state.favoriteServers || prev.favoriteServers
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

  const openAuth = (mode = 'login') => {
    setAuthInitialMode(mode);
    setModal('auth');
  };

  const handleLogin = async payload => {
    const res = await loginAccount(payload, settings.socialServerUrl);
    if (res?.authenticated) {
      await refreshSocial();
    }
  };

  const handleRegister = async payload => {
    const res = await registerAccount(payload, settings.socialServerUrl);
    if (res?.authenticated) {
      await refreshSocial();
    }
  };

  const handleLogout = async () => {
    await logoutAccount(settings.socialServerUrl);
    setSocial({ ...EMPTY_SOCIAL, loading: false });
  };

  const handleChangeStatus = async statusPref => {
    await sendHeartbeat({ statusPref, activeServer: currentInGameServer }, settings.socialServerUrl);
    await refreshSocial();
  };

  const applySocialStateResponse = res => {
    if (!res) return;
    setSocial(prev => ({
      ...prev,
      user: res.user || prev.user,
      friends: res.friends ?? prev.friends,
      incomingRequests: res.incomingRequests ?? prev.incomingRequests,
      outgoingRequests: res.outgoingRequests ?? prev.outgoingRequests,
      favoriteServers: res.favoriteServers ?? prev.favoriteServers
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

  const handleJoinFriendServer = srv => {
    if (!srv?.ip && !srv?.id) return;
    const match = servers.find(s => s.id === srv.id || s.ip === srv.ip);
    if (match) {
      handleSelectServer(match.id);
      setCenterTab('general');
      setFriendsMobileOpen(false);
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
      setLaunchFeedback({ message: result.message });
      if (social.authenticated) {
        void sendHeartbeat({ activeServer: { id: target.id, name: target.name, ip: target.ip } }, settings.socialServerUrl).catch(() => {});
      }
    } catch (error) {
      if (attempt) historyStore.finish(attempt, 'failed', error.message);
      setLaunchFeedback({ error: error.message });
    } finally {
      launchLock.current = false; setLaunchBusy(false);
      void presenceService.checkPresence();
    }
  };

  const latestCity = latestHistoryCity(history.entries, servers);
  const launchLatestRef = useRef(null);
  launchLatestRef.current = () => { if (latestCity && !modal && !settingsBusy && !showPatcherScreen) { setActiveId(latestCity.id); void launchCity(latestCity); } };
  useEffect(() => window.estraWindow?.onLaunchLatest(() => launchLatestRef.current?.()), []);
  useEffect(() => {
    window.estraWindow?.setLatestCity({ name: latestCity?.name || '', enabled: !!latestCity && !launchBusy && !modal && !settingsBusy && !showPatcherScreen });
  }, [latestCity?.id, latestCity?.name, launchBusy, modal, settingsBusy, showPatcherScreen]);
  useEffect(() => window.estraWindow?.onGameStatus(setGameNotice), []);

  useDialogFocus(modal, () => setModal(null));
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

  return (
    <div className={`launcher-window${modalClosing ? ' modal-closing' : ''}`}>
      <CityBackground server={active} onStatus={setBackground} />
      {storageError && <p role="alert" className="error-message">{storageError}</p>}
      {showPatcherScreen ? (
        <PrelaunchPatcher
          activeServer={active}
          settings={settings}
          launcherUpdate={launcherUpdate}
          onLauncherUpdateChange={setLauncherUpdate}
          onOpenPatcherSettings={() => setModal('patcher')}
          onEnterLauncher={() => setShowPatcherScreen(false)}
          paused={modal !== null}
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
            onOpenAuth={openAuth}
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
                onOpenAuth={openAuth}
              />
            </div>

            {launcherUpdate?.available && (
              <p className="notice main-alert-strip" role="status">
                มี Estra Launcher เวอร์ชันใหม่ v{launcherUpdate.version} พร้อมอัปเดต —{' '}
                <button type="button" className="btn-inline-orange" onClick={() => setModal('patcher')}>
                  เปิด Patcher
                </button>
              </p>
            )}
            {gameNotice && ['closed', 'startup-timeout', 'detection-error'].includes(gameNotice.state) && (
              <p className="notice main-alert-strip" role="status">{gameNotice.message}</p>
            )}
            {launchFeedback?.error && <p className="error-message main-alert-strip" role="alert">{launchFeedback.error}</p>}
            {launchFeedback?.message && <p className="notice main-alert-strip" role="status">{launchFeedback.message}</p>}
            {history.error && <p className="error-message main-alert-strip" role="alert">{history.error}</p>}

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
            onOpenAuth={openAuth}
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
            onSeedDemoFriends={async () => {
              const res = await seedDemoFriends(settings.socialServerUrl);
              applySocialStateResponse(res);
            }}
            onJoinFriendServer={handleJoinFriendServer}
          />
        </div>
      )}

      {modal === 'library' && (
        <ServerLibrary
          servers={servers}
          activeId={active?.id}
          onClose={() => setModal(null)}
          onAdd={() => setModal('new')}
          onSelect={id => { handleSelectServer(id); setModal(null); }}
          onToggleFavorite={handleToggleFavoriteServer}
          onRemove={id => { setServers(prev => prev.filter(s => s.id !== id)); if (active?.id === id) setActiveId(''); }}
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
        />
      )}
      <AuthModal
        isOpen={modal === 'auth'}
        initialMode={authInitialMode}
        onClose={() => setModal(null)}
        social={social}
        settings={settings}
        onSaveSettings={savePrefs}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onLogout={handleLogout}
        onChangeStatus={handleChangeStatus}
      />
      <MicTestModal isOpen={modal === 'mic'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} />
      <CacheModal isOpen={modal === 'cache'} onClose={() => setModal(null)} settings={settings} />
      <SettingsModal isOpen={modal === 'settings'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} activeServer={active} onMaintenanceBusy={setSettingsBusy} />
      <PatcherModal isOpen={modal === 'patcher'} onClose={() => setModal(null)} activeServer={active} settings={settings} onSaveSettings={savePrefs} onUpdateServer={update} launcherUpdate={launcherUpdate} onLauncherUpdateChange={setLauncherUpdate} onBusyChange={setSettingsBusy} onOpenFullPatcher={showPatcherScreen ? null : () => setShowPatcherScreen(true)} />
      <NewServerModal isOpen={modal === 'new'} onClose={() => setModal(null)} onAddServer={server => { setServers(prev => [server, ...prev]); setActiveId(server.id); }} />
    </div>
  );
}
