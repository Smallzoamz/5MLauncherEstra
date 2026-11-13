import React, { useState, useEffect, useRef } from 'react';
import ServerLibrary from './components/ServerLibrary';
import Header from './components/Header';
import ServerSidebar from './components/ServerSidebar';
import MainLauncher from './components/MainLauncher';
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
import { checkLauncherUpdate } from './services/patcherService';
import { isConfiguredGithubRepo } from './shared/patcherConfig';

export default function App() {
  const [servers, setServers] = useState(getSavedServers);
  const [activeId, setActiveId] = useState(getActiveServerId);
  const [settings, setSettings] = useState(getSettings);
  const [modal, setVisibleModal] = useState(null);
  const [modalClosing, setModalClosing] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const modalTimer = useRef(null);
  const [background, setBackground] = useState({});
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
  useEffect(() => {
    if (!isConfiguredGithubRepo(settings.githubRepo)) return;
    let active = true;
    void checkLauncherUpdate(settings.githubRepo).then(info => { if (active) setLauncherUpdate(info); }).catch(() => {});
    return () => { active = false; };
  }, [settings.githubRepo]);
  useEffect(() => historyStore.subscribe(setHistory), [historyStore]);
  const launchCity = async city => {
    if (launchLock.current || settingsBusy) return;
    launchLock.current = true; setLaunchBusy(true); setLaunchFeedback(null); setGameNotice(null);
    // Snapshot the selected city/settings; changing tabs during preflight cannot retarget it.
    const target = { ...city }, preferences = { ...settings };
    let attempt;
    try {
      attempt = historyStore.begin(target);
      const result = await prepareLaunch(target, preferences);
      if (result.serverInfo) setServers(prev => prev.map(s => s.id === target.id && s.ip === target.ip ? { ...s, ...result.serverInfo } : s));
      historyStore.finish(attempt, 'sent');
      setLaunchFeedback({ message: result.message });
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
  launchLatestRef.current = () => { if (latestCity && !modal && !settingsBusy) { setActiveId(latestCity.id); void launchCity(latestCity); } };
  useEffect(() => window.estraWindow?.onLaunchLatest(() => launchLatestRef.current?.()), []);
  useEffect(() => {
    window.estraWindow?.setLatestCity({ name: latestCity?.name || '', enabled: !!latestCity && !launchBusy && !modal && !settingsBusy });
  }, [latestCity?.id, latestCity?.name, launchBusy, modal, settingsBusy]);
  useEffect(() => window.estraWindow?.onGameStatus(setGameNotice), []);
  const active = servers.find(s => s.id === activeId) || servers[0];
  const activeRef = useRef(active); activeRef.current = active;
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
  return <div className={`launcher-window${modalClosing ? ' modal-closing' : ''}`}>
    <CityBackground server={active} onStatus={setBackground} />
    {storageError && <p role="alert" className="error-message">{storageError}</p>}
    <div className="launcher-body">
      <ServerSidebar servers={servers} activeServerId={active?.id} onSelectServer={setActiveId}
        onRemoveServer={id => { setServers(prev => prev.filter(s => s.id !== id)); if (active?.id === id) setActiveId(''); }}
        onOpenNewServerModal={() => setModal('new')} onOpenLibrary={() => setModal('library')} onOpenHistory={() => setModal('history')} onOpenSettings={() => setModal('settings')} onOpenMicTest={() => setModal('mic')} onOpenPatcher={() => setModal('patcher')} hasLauncherUpdate={!!launcherUpdate?.available} />
      <div className="launcher-main"><div className="header-wrap" data-tauri-drag-region><Header onOpenLibrary={() => setModal('library')} onOpenPatcher={() => setModal('patcher')} hasLauncherUpdate={!!launcherUpdate?.available} /></div>
        {launcherUpdate?.available && <p className="notice" role="status">มี Estra Launcher เวอร์ชันใหม่ v{launcherUpdate.version} พร้อมอัปเดต — <button type="button" className="btn-inline-orange" onClick={() => setModal('patcher')}>เปิด Patcher</button></p>}
        {gameNotice && ['closed', 'startup-timeout', 'detection-error'].includes(gameNotice.state) && <p className="notice" role="status">{gameNotice.message}</p>}
        {launchFeedback?.error && <p className="error-message" role="alert">{launchFeedback.error}</p>}
        {launchFeedback?.message && <p className="notice" role="status">{launchFeedback.message}</p>}
        {history.error && <p className="error-message" role="alert">{history.error}</p>}
        <MainLauncher key={active?.id || 'empty'} server={active} settings={settings} onUpdateServer={update} backgroundKind={background.owner === `${active?.id || ''}|${active?.ip || ''}` ? background.kind : 'loading'}
          busy={launchBusy || settingsBusy} onLaunch={launchCity}
          onRefresh={() => setRefreshKey(k => k + 1)} isRefreshing={refreshing}
          onOpenNewServerModal={() => setModal('new')} onOpenSettings={() => setModal('settings')}
          onOpenCacheModal={() => setModal('cache')} onOpenMicTest={() => setModal('mic')} onOpenPatcher={() => setModal('patcher')} />
      </div>
    </div>
    {modal === 'library' && <ServerLibrary servers={servers} activeId={active?.id} onClose={() => setModal(null)} onAdd={() => setModal('new')} onSelect={id => { setActiveId(id); setModal(null); }} onRemove={id => { setServers(prev => prev.filter(s => s.id !== id)); if (active?.id === id) setActiveId(''); }} />}
    {modal === 'history' && <LaunchHistory history={history} servers={servers} busy={launchBusy} onLaunch={city => { setActiveId(city.id); void launchCity(city); }} onClear={() => historyStore.clear()} onClose={() => setModal(null)} />}
    <MicTestModal isOpen={modal === 'mic'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} />
    <CacheModal isOpen={modal === 'cache'} onClose={() => setModal(null)} settings={settings} />
    <SettingsModal isOpen={modal === 'settings'} onClose={() => setModal(null)} settings={settings} onSaveSettings={savePrefs} activeServer={active} onMaintenanceBusy={setSettingsBusy} />
    <PatcherModal isOpen={modal === 'patcher'} onClose={() => setModal(null)} activeServer={active} settings={settings} onSaveSettings={savePrefs} onUpdateServer={update} launcherUpdate={launcherUpdate} onLauncherUpdateChange={setLauncherUpdate} onBusyChange={setSettingsBusy} />
    <NewServerModal isOpen={modal === 'new'} onClose={() => setModal(null)} onAddServer={server => { setServers(prev => [server, ...prev]); setActiveId(server.id); }} />
  </div>;
}

