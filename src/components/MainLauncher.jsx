import React, { useState, useEffect } from 'react';
import { parseTarget } from '../shared/target';
import { lookupDirectoryServer } from '../shared/serverDirectory';
import presenceService from '../services/presenceService';
import { bannerImageUrl } from '../shared/serverMedia';
import { cityBackdrop } from '../shared/cityBackdrop';
import MicIndicator from './MicIndicator';
import ServerAvatar from './ServerAvatar';
import ScreenshotsGallery from './ScreenshotsGallery';
import PatchNewsSection from './PatchNewsSection';
import AddonsHub from './AddonsHub';
import { CrashAdvisorContent } from './CrashAdvisorModal';
import ModPresetPanel from './ModPresetPanel';
import NetworkWatcherPanel from './NetworkWatcherPanel';
import { CLEAN_PURE_PRESET_ID, evaluatePureModeCompatibility } from '../services/modPresetService';
import { APP_VERSION } from '../shared/patcherConfig';
import { SERVER_TAGS, DEFAULT_SERVER_TAG, normalizeServerTag } from '../shared/serverTags';
import { formatDetailedDurationThai, formatLastPlayedLabel, formatPlaytimeSteam } from '../shared/durationFormat';
import {
  Activity,
  BellOff,
  BellRing,
  BookOpen,
  Clock,
  FileWarning,
  Layers,
  Play,
  ArrowUpRight,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  ShieldCheck,
  Headphones,
  Trash2,
  ChevronDown,
  PackageCheck,
  Star,
  Users,
  ChevronRight,
  History,
  Sparkles,
  Wifi
} from 'lucide-react';

export default function MainLauncher({
  server,
  servers = [],
  directory = [],
  centerTab = 'general',
  onChangeTab,
  settings,
  backgroundKind,
  onUpdateServer,
  onToggleFavoriteServer,
  onSelectServer,
  onRefresh,
  isRefreshing,
  onOpenNewServerModal,
  onOpenLibrary,
  onOpenSettings,
  onOpenCacheModal,
  onOpenMicTest,
  onOpenPatcher,
  onOpenHistory,
  onOpenGuide,
  historyEntries = [],
  social,
  launcherUpdate,
  screenshotCaptureVersion = 0,
  crpAddonState,
  crpAddonBusy = false,
  onInstallCrpAddon,
  onUninstallCrpAddon,
  onSaveCrpConfig,
  onToggleCrpOverlay,
  voiceState,
  voiceMeter,
  voiceDownloadProgress,
  voiceBusy = false,
  onInstallVoiceAddon,
  onUninstallVoiceAddon,
  onSaveVoiceConfig,
  onStartVoiceCapture,
  onStopVoiceCapture,
  onDownloadLocalWhisper,
  onToggleVoiceOverlay,
  onRequestConfirm,
  playingServerId = '',
  onNotify,
  busy,
  onLaunch,
  discoverSubTab = 'crash',
  onChangeDiscoverSubTab,
  crashReport = null,
  crashScanning = false,
  crashFixBusyId = '',
  crashFixFeedback = null,
  onScanCrashLogs,
  onOpenCrashAdvisor,
  onRunCrashFix,
  modState = null,
  modBusy = false,
  onRefreshModPresets,
  onCreateModPreset,
  onSwitchModPreset,
  onDeleteModPreset,
  onOpenModPresetFolder,
  onBindServerModPreset,
  onToggleAutoCleanPure,
  routeReport = null,
  pingHistory = [],
  routeProbing = false,
  watcherMap = {},
  watcherReadyAlert = null,
  onProbeRoute,
  onToggleWatcher,
  onUpdateWatcher,
  onRearmWatcher,
  onQuickJoinWatchedServer,
  onDismissWatcherAlert
}) {
  const [editing, setEditing] = useState(false);
  const [ip, setIp] = useState(server?.ip || '');
  const [error, setError] = useState('');
  const [bannerDraft, setBannerDraft] = useState(server?.customBannerUrl || '');
  const [bannerError, setBannerError] = useState('');
  const [presence, setPresence] = useState(presenceService.getPresence());
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => presenceService.subscribe(setPresence), []);
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setEditing(false);
    setIp(server?.ip || '');
    setBannerDraft(server?.customBannerUrl || '');
    setError('');
    setBannerError('');
  }, [server?.id, server?.ip, server?.customBannerUrl]);

  if (centerTab === 'screenshots') {
    return (
      <main className="main-content">
        <ScreenshotsGallery
          settings={settings}
          captureVersion={screenshotCaptureVersion}
          onOpenSettings={onOpenSettings}
          onRequestConfirm={onRequestConfirm}
          onNotify={onNotify}
        />
      </main>
    );
  }

  if (centerTab === 'news') {
    return (
      <main className="main-content">
        <PatchNewsSection launcherUpdate={launcherUpdate} onOpenPatcher={onOpenPatcher} />
      </main>
    );
  }

  if (centerTab === 'addons') {
    return (
      <main className="main-content">
        <AddonsHub
          addonState={crpAddonState}
          busy={crpAddonBusy}
          settings={settings}
          onInstallAddon={onInstallCrpAddon}
          onUninstallAddon={onUninstallCrpAddon}
          onSaveConfig={onSaveCrpConfig}
          onToggleOverlayWindow={onToggleCrpOverlay}
          voiceState={voiceState}
          voiceMeter={voiceMeter}
          voiceDownloadProgress={voiceDownloadProgress}
          voiceBusy={voiceBusy}
          onInstallVoiceAddon={onInstallVoiceAddon}
          onUninstallVoiceAddon={onUninstallVoiceAddon}
          onSaveVoiceConfig={onSaveVoiceConfig}
          onStartVoiceCapture={onStartVoiceCapture}
          onStopVoiceCapture={onStopVoiceCapture}
          onDownloadLocalWhisper={onDownloadLocalWhisper}
          onToggleVoiceOverlay={onToggleVoiceOverlay}
          onRequestConfirm={onRequestConfirm}
          onNotify={onNotify}
        />
      </main>
    );
  }

  if (!server) {
    return (
      <main className="main-content empty-state">
        <span className="eyebrow">YOUR NEXT STORY STARTS HERE</span>
        <h2>ยังไม่มีเมืองหรือเซิร์ฟเวอร์ที่บันทึก</h2>
        <p>
          วาง IP, Cfx.re join link หรือคำสั่ง <code>connect ...</code> เพื่อเพิ่มเมืองของคุณได้เลย
          หากเมืองอยู่ในสารบัญกลาง ชื่อเมืองจะแสดงให้อัตโนมัติ
        </p>
        <div className="empty-state-actions">
          <button type="button" className="btn-action-play" onClick={onOpenNewServerModal}>
            <Plus size={15} />
            เพิ่มเซิร์ฟเวอร์แรก
          </button>
          <button type="button" className="btn-action-refresh" onClick={onOpenGuide}>
            <BookOpen size={15} />
            คู่มือการตั้งค่า
          </button>
        </div>
      </main>
    );
  }

  const change = (field, value) => onUpdateServer({ id: server.id, [field]: value });
  const saveIp = () => {
    if (!editing) {
      setIp(server.ip);
      setEditing(true);
      return;
    }
    try {
      const address = parseTarget(ip).address;
      const matched = lookupDirectoryServer(address, directory);
      onUpdateServer({
        id: server.id,
        ip: address,
        ...(matched
          ? {
              name: matched.name,
              tag: matched.tag || server.tag,
              directorySlug: matched.slug,
              patchManifestUrl: server.patchManifestUrl || matched.patchManifestUrl || '',
              customBannerUrl: server.customBannerUrl || matched.customBannerUrl || ''
            }
          : { directorySlug: '', lastFetchedName: '' }),
        status: 'Unknown',
        onlinePlayers: null,
        maxPlayers: null,
        gameBuild: null,
        lockPure: null,
        ping: null,
        queryError: null,
        logoUrl: null,
        iconSource: null,
        bannerUrl: null,
        connectingBannerUrl: null
      });
      setEditing(false);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const occupancy =
    server.status === 'Online' && server.maxPlayers > 0
      ? Math.min(100, Math.round((server.onlinePlayers / server.maxPlayers) * 100))
      : null;

  const words = server.name.trim().split(/\s+/);
  const titleTop = words.length > 1 ? words.slice(0, -1).join(' ') : server.name;
  const titleBottom = words.length > 1 ? words.at(-1) : '';
  const processBlocked = !server.cl2 && presence.fivem?.running !== false;
  const processMessage =
    presence.fivem?.running === true
      ? server.cl2
        ? 'FiveM กำลังทำงานอยู่ • CL2 พร้อมเปิดเกมตัวที่สอง'
        : 'FiveM กำลังทำงานอยู่ — ปิดเกมเดิม หรือเปิด CL2 เพื่อเริ่มเกมตัวที่สอง'
      : presence.fivem?.running === false
        ? 'FiveM ยังไม่ได้เปิด • พร้อมเริ่มเกม'
        : 'กำลังรอตรวจสอบสถานะ FiveM';

  const heroArtSrc =
    bannerImageUrl(server.customBannerUrl) ||
    bannerImageUrl(server.bannerUrl) ||
    bannerImageUrl(server.connectingBannerUrl) ||
    cityBackdrop(server);

  const friendsInCity = (social?.friends || []).filter(
    f =>
      f.presence === 'in-game' &&
      f.currentServer &&
      (f.currentServer.id === server.id || f.currentServer.ip === server.ip)
  );
  const isPlayingThisCity = !!playingServerId && playingServerId === server.id;
  const steamPlaytime = formatPlaytimeSteam(server.playtimeSeconds);
  const lastPlayedText = formatLastPlayedLabel(server.lastPlayedAt, isPlayingThisCity, nowTick);
  const serverOfflineDuration = server.status === 'Offline' && server.lastOnlineAt
    ? formatDetailedDurationThai(server.lastOnlineAt, nowTick, { underMinuteText: 'ไม่ถึง 1 นาที' })
    : '';

  const resumeCities = [...servers]
    .sort((a, b) => {
      if (a.id === server.id) return -1;
      if (b.id === server.id) return 1;
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return 0;
    })
    .slice(0, 3);

  const isWatchingServer = Boolean(watcherMap?.[server.id]?.enabled);
  const pureCompat = evaluatePureModeCompatibility(server, modState);
  const activePresetObj = (modState?.presets || []).find(p => p.id === modState?.activePresetId) || null;
  const fivemRunning = presence.fivem?.running === true;

  const jumpToDiagnostics = subTab => {
    onChangeDiscoverSubTab?.(subTab);
    onChangeTab?.('discover');
  };

  const openDetailsPanel = () => {
    if (centerTab === 'discover') {
      onChangeTab?.('general');
      setTimeout(() => {
        const details = document.getElementById('server-config');
        if (details) {
          details.open = true;
          details.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        }
      }, 30);
      return;
    }
    const details = document.getElementById('server-config');
    if (details) {
      details.open = !details.open;
      if (details.open) details.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    }
  };

  return (
    <main className="main-content">
      {centerTab === 'discover' && (
        <section className="subtab-panel" aria-label="กิจกรรมและสถานะระบบ">
          <div className="subtab-banner">
            <div>
              <span className="eyebrow">ACTIVITY, DIAGNOSTICS &amp; TOOLS</span>
              <h2>กิจกรรมระบบ · วิเคราะห์ Crash · ม็อด &amp; Watcher</h2>
              <p>วิเคราะห์เกมเด้งอัตโนมัติ สลับโปรไฟล์ม็อดตาม Pure Mode และตรวจเส้นทาง/เฝ้ารีสตาร์ทเมือง</p>
            </div>
            <button type="button" className="soft-button" onClick={onOpenHistory}>
              <History size={15} /> ประวัติทั้งหมด ({historyEntries.length})
            </button>
          </div>

          <div className="diag-subtabs" role="tablist" aria-label="หมวดเครื่องมือระบบ">
            <button
              type="button"
              role="tab"
              aria-selected={discoverSubTab === 'crash'}
              className={`diag-subtab-btn${discoverSubTab === 'crash' ? ' active' : ''}`}
              onClick={() => onChangeDiscoverSubTab?.('crash')}
            >
              <FileWarning size={14} /> Crash Advisor &amp; สถานะเครื่อง
              {crashReport?.hasCrash && <span className="diag-dot danger" />}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={discoverSubTab === 'mods'}
              className={`diag-subtab-btn${discoverSubTab === 'mods' ? ' active' : ''}`}
              onClick={() => onChangeDiscoverSubTab?.('mods')}
            >
              <Layers size={14} /> โปรไฟล์ม็อด &amp; Pure Mode
              {pureCompat.mismatch && <span className="diag-dot amber" />}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={discoverSubTab === 'watcher'}
              className={`diag-subtab-btn${discoverSubTab === 'watcher' ? ' active' : ''}`}
              onClick={() => onChangeDiscoverSubTab?.('watcher')}
            >
              <Wifi size={14} /> Watcher &amp; Ping/Route
              {Object.values(watcherMap || {}).some(r => r?.enabled) && <span className="diag-dot emerald" />}
            </button>
          </div>

          {discoverSubTab === 'crash' && (
            <>
              <div className="diag-panel">
                <div className="diag-panel-header">
                  <div>
                    <span className="eyebrow">CRASH LOG ANALYZER &amp; AUTO-FIX</span>
                    <h3>วิเคราะห์สาเหตุ FiveM เด้งอัตโนมัติ</h3>
                  </div>
                </div>
                <CrashAdvisorContent
                  report={crashReport}
                  scanning={crashScanning}
                  actionBusyId={crashFixBusyId}
                  actionFeedback={crashFixFeedback}
                  onRescan={onScanCrashLogs}
                  onRunFix={onRunCrashFix}
                  onNotify={onNotify}
                />
              </div>

              <div className="activity-grid">
                <div className="activity-card">
                  <span className="eyebrow">PROCESS STATUS</span>
                  <ul>
                    <li>FiveM: <strong>{presence.fivem?.running ? 'กำลังทำงานอยู่' : presence.fivem?.running === false ? 'ปิดอยู่' : 'ไม่ทราบสถานะ'}</strong></li>
                    <li>Steam: <strong>{presence.steam?.running ? presence.steam.user?.displayName || 'เปิดอยู่' : 'ไม่ได้เปิด'}</strong></li>
                    <li>Discord: <strong>{presence.discord?.running ? presence.discord.user?.displayName || 'เปิดอยู่' : 'ไม่ได้เปิด'}</strong></li>
                  </ul>
                </div>
                <div className="activity-card">
                  <span className="eyebrow">RECENT LAUNCHES</span>
                  {historyEntries.length === 0 ? (
                    <p className="help-text">ยังไม่มีประวัติการกดเข้าเมือง</p>
                  ) : (
                    <ul>
                      {historyEntries.slice(0, 4).map(entry => (
                        <li key={entry.id}>
                          <span>{entry.city?.name}</span>
                          <strong>{entry.status === 'sent' ? 'ส่งคำสั่งแล้ว' : entry.status === 'failed' ? 'ไม่สำเร็จ' : entry.status}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}

          {discoverSubTab === 'mods' && (
            <ModPresetPanel
              server={server}
              settings={settings}
              modState={modState}
              busy={modBusy || busy}
              fivemRunning={fivemRunning}
              onRefresh={onRefreshModPresets}
              onCreatePreset={onCreateModPreset}
              onSwitchPreset={onSwitchModPreset}
              onDeletePreset={onDeleteModPreset}
              onOpenFolder={onOpenModPresetFolder}
              onBindServerPreset={onBindServerModPreset}
              onToggleAutoCleanPure={onToggleAutoCleanPure}
              onRequestConfirm={onRequestConfirm}
            />
          )}

          {discoverSubTab === 'watcher' && (
            <NetworkWatcherPanel
              server={server}
              servers={servers}
              routeReport={routeReport}
              pingHistory={pingHistory}
              probing={routeProbing}
              watcherMap={watcherMap}
              readyAlert={watcherReadyAlert}
              launchBusy={busy}
              onProbeRoute={onProbeRoute}
              onToggleWatcher={onToggleWatcher}
              onUpdateWatcher={onUpdateWatcher}
              onRearmWatcher={onRearmWatcher}
              onQuickJoinServer={onQuickJoinWatchedServer}
              onDismissReadyAlert={onDismissWatcherAlert}
            />
          )}
        </section>
      )}

      {centerTab === 'general' && (
        <>
          {watcherReadyAlert && (
            <div className="watcher-ready-banner" role="status">
              <div className="watcher-ready-copy">
                <span className="diag-pill tone-emerald">
                  <Radio size={11} /> {watcherReadyAlert.badge}
                </span>
                <strong>{watcherReadyAlert.serverName}</strong>
                <span>{watcherReadyAlert.subtitle}</span>
              </div>
              <div className="watcher-ready-actions">
                <button
                  type="button"
                  className="btn-action-play"
                  disabled={busy}
                  onClick={() => onQuickJoinWatchedServer?.(watcherReadyAlert.serverId)}
                >
                  <Play size={13} fill="currentColor" /> เข้าเมืองทันที
                </button>
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => onDismissWatcherAlert?.()}
                >
                  ปิด
                </button>
              </div>
            </div>
          )}

          <section
            className={`hero-section hero-showcase-card${server.name.length > 28 ? ' has-long-title' : ''}`}
            key={server.id}
            aria-labelledby="selected-server"
          >
            <img className="hero-card-art" src={heroArtSrc} referrerPolicy="no-referrer" alt="" />
            <div className="hero-card-scrim" aria-hidden="true" />

            <div className="hero-card-topbar">
              <div className="selected-city">
                <ServerAvatar server={server} />
                <span>
                  <span className="eyebrow">SELECTED CITY</span>
                  <span className="hero-tag">
                    {normalizeServerTag(server.tag, DEFAULT_SERVER_TAG)} <span>·</span> FiveM
                  </span>
                </span>
              </div>

              <div className="hero-topbar-right">
                {friendsInCity.length > 0 && (
                  <div className="hero-friends-pill" title={friendsInCity.map(f => f.displayName).join(', ')}>
                    <Users size={13} />
                    <span>เพื่อน {friendsInCity.length} คนในเมือง</span>
                    <div className="mini-avatar-stack">
                      {friendsInCity.slice(0, 3).map(f => (
                        <span key={f.id} style={{ background: f.avatarColor || '#2b6bf3' }}>
                          {f.displayName.slice(0, 1).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={`hero-fav-btn${isWatchingServer ? ' active is-watch-btn' : ''}`}
                  aria-label={isWatchingServer ? `หยุดเฝ้า ${server.name}` : `เฝ้ารีสตาร์ทและสล็อตว่างของ ${server.name}`}
                  aria-pressed={isWatchingServer}
                  title="เฝ้าแจ้งเตือนเมื่อเมืองรีสตาร์ทเสร็จหรือมีสล็อตว่าง"
                  onClick={() => onToggleWatcher?.(server)}
                >
                  {isWatchingServer ? <BellRing size={14} /> : <BellOff size={14} />}
                  <span>{isWatchingServer ? 'กำลังเฝ้า' : 'เฝ้าเมือง'}</span>
                </button>

                <button
                  type="button"
                  className={`hero-fav-btn${server.favorite ? ' active' : ''}`}
                  aria-label={server.favorite ? `เลิกปักหมุด ${server.name}` : `ปักหมุด ${server.name} เป็นเมืองโปรด`}
                  aria-pressed={!!server.favorite}
                  onClick={() => onToggleFavoriteServer?.(server)}
                >
                  <Star size={14} fill={server.favorite ? 'currentColor' : 'none'} />
                  <span>{server.favorite ? 'เมืองโปรด' : 'ปักหมุดโปรด'}</span>
                </button>
              </div>
            </div>

            <div className="hero-copy">
              <h1 id="selected-server">
                <span>{titleTop}</span>
                {titleBottom && <span>{titleBottom}</span>}
              </h1>

              <div className="hero-badges-row">
                <span className={`hero-recommend-badge ${server.status === 'Online' ? 'online' : server.status === 'Offline' ? 'offline' : ''}`}>
                  {server.status === 'Online'
                    ? `Online · ${server.onlinePlayers ?? 0}/${server.maxPlayers ?? '—'}${occupancy != null ? ` (${occupancy}%)` : ''}`
                    : server.status === 'Offline'
                      ? (serverOfflineDuration ? `Offline · มาแล้ว ${serverOfflineDuration}` : 'Offline')
                      : 'กำลังรอตรวจสถานะ'}
                </span>
                {server.gameBuild && <span className="hero-spec-badge">Build {server.gameBuild}</span>}
                {server.lockPure != null && <span className="hero-spec-badge">Pure {server.lockPure}</span>}
                <button
                  type="button"
                  className="hero-spec-badge hero-spec-btn"
                  title="เปิดทดสอบ Ping / Jitter และ Route Check"
                  onClick={() => jumpToDiagnostics('watcher')}
                >
                  <Activity size={11} />
                  {server.ping != null ? `${server.ping} ms` : 'ตรวจ Ping'}
                </button>
              </div>

              <p className="hero-description">
                เรื่องราวต่อไปของคุณ เริ่มต้นที่นี่ · <span className="hero-ip-inline">{server.ip}</span>
              </p>

              <div className="hero-steam-stats" aria-label="สถิติการเล่นเมืองนี้">
                <div className="hero-stat-item" title={steamPlaytime.full}>
                  <span className="hero-stat-label"><Clock size={12} /> เวลาเล่นทั้งหมด</span>
                  <strong className="hero-stat-value">{steamPlaytime.short}</strong>
                </div>
                <div className="hero-stat-divider" aria-hidden="true" />
                <div className="hero-stat-item" title={server.lastPlayedAt ? new Date(server.lastPlayedAt).toLocaleString('th-TH') : 'ยังไม่เคยเข้าเมืองนี้'}>
                  <span className="hero-stat-label">เล่นล่าสุด</span>
                  <strong className={`hero-stat-value${isPlayingThisCity ? ' playing-now' : ''}`}>{lastPlayedText}</strong>
                </div>
              </div>

              <div className="hero-actions">
                <button
                  className="play-button btn-action-play"
                  aria-label="กดเล่น"
                  aria-describedby="fivem-process-status"
                  disabled={busy || editing || processBlocked}
                  onClick={() => onLaunch(server)}
                >
                  <span className="play-icon">
                    <Play size={14} fill="currentColor" />
                  </span>
                  {busy ? 'กำลังเตรียมเกม…' : processBlocked && presence.fivem?.running ? 'เกมกำลังทำงาน' : 'เข้าเมือง'}
                  <span className="play-label">{server.cl2 ? 'CL2' : 'PLAY'}</span>
                </button>

                <button className="hero-edit" onClick={openDetailsPanel} aria-label="รายละเอียดเมือง">
                  <SlidersHorizontal size={15} /> รายละเอียดเมือง
                </button>

                <button
                  type="button"
                  className="hero-edit hero-cache-btn"
                  disabled={busy}
                  onClick={onOpenCacheModal}
                  aria-label="ล้างแคช"
                >
                  <Trash2 size={15} /> ล้างแคช
                </button>
              </div>

              <div className={`process-status${processBlocked ? ' blocked' : ''}`}>
                <span id="fivem-process-status" role="status">
                  {presence.fivem?.error ? 'ตรวจสอบสถานะ FiveM ไม่ได้ กรุณาตรวจใหม่' : processMessage}
                </span>
                <button
                  className="icon-button"
                  aria-label="ตรวจสถานะ FiveM อีกครั้ง"
                  title="ตรวจสถานะ FiveM อีกครั้ง"
                  onClick={() => presenceService.checkPresence()}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            <span className="art-caption">
              {backgroundKind === 'banner'
                ? 'CITY BANNER / ' + server.name
                : backgroundKind === 'custom'
                  ? 'CUSTOM BANNER / ' + server.name
                  : 'CITY THEME / ' + server.name}
            </span>
          </section>

          <section className="resume-shelf" aria-label="เมืองล่าสุดและเมืองโปรด">
            <div className="shelf-heading">
              <div className="shelf-title-group">
                <h3>Resume my cities</h3>
                <span className="friends-count-pill">{servers.length}</span>
              </div>
              <button type="button" className="shelf-explore-btn" onClick={onOpenLibrary}>
                <span>Explore all</span>
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="resume-cards-grid">
              {resumeCities.map(city => {
                const thumb =
                  bannerImageUrl(city.customBannerUrl) ||
                  bannerImageUrl(city.bannerUrl) ||
                  bannerImageUrl(city.connectingBannerUrl) ||
                  cityBackdrop(city);
                const cityFriends = (social?.friends || []).filter(
                  f => f.presence === 'in-game' && f.currentServer && (f.currentServer.id === city.id || f.currentServer.ip === city.ip)
                );
                return (
                  <div
                    key={city.id}
                    className={`resume-city-card${city.id === server.id ? ' active' : ''}`}
                  >
                    <button
                      type="button"
                      className="resume-city-hit"
                      onClick={() => onSelectServer?.(city.id)}
                    >
                      <img className="resume-city-art" src={thumb} referrerPolicy="no-referrer" alt="" />
                      <div className="resume-city-scrim" aria-hidden="true" />
                      <div className="resume-city-top">
                        <ServerAvatar server={city} />
                        {cityFriends.length > 0 && (
                          <span className="resume-friends-badge">
                            <Users size={11} /> {cityFriends.length}
                          </span>
                        )}
                      </div>
                      <div className="resume-city-bottom">
                        <strong>{city.name}</strong>
                        <small>
                          {city.tag || 'FiveM'} · {city.status === 'Online' && city.onlinePlayers != null ? `${city.onlinePlayers}/${city.maxPlayers}` : city.ip}
                          {city.playtimeSeconds > 0 ? ` · ${formatPlaytimeSteam(city.playtimeSeconds).short}` : ''}
                        </small>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`resume-fav-dot${city.favorite ? ' active' : ''}`}
                      aria-label={city.favorite ? `เลิกปักหมุด ${city.name}` : `ปักหมุด ${city.name}`}
                      onClick={() => onToggleFavoriteServer?.(city)}
                    >
                      <Star size={12} fill={city.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="dashboard-heading">
            <span className="eyebrow">BEFORE YOU JUMP IN</span>
            <span>ทุกอย่างพร้อม สำหรับเมืองของคุณ</span>
          </div>

          <section className="dashboard-grid" aria-label="ข้อมูลก่อนเข้าเมือง">
            <article className="dashboard-card server-health">
              <header>
                <span className="eyebrow">สถานะเมือง</span>
                <button
                  className="icon-button"
                  aria-label="รีเฟรช"
                  title="ตรวจสอบใหม่"
                  disabled={isRefreshing}
                  onClick={onRefresh}
                >
                  <RefreshCw size={15} className={isRefreshing ? 'spinning' : ''} />
                </button>
              </header>
              <div className="population-row">
                <strong>
                  {server.onlinePlayers ?? '—'} / {server.maxPlayers ?? '—'}
                </strong>
                <span className={`live-label ${server.status === 'Online' ? 'online' : server.status === 'Offline' ? 'offline' : ''}`}>
                  <i />
                  {isRefreshing
                    ? 'กำลังตรวจสอบ…'
                    : ['Online', 'Offline'].includes(server.status)
                      ? server.status
                      : 'ตรวจสอบไม่ได้'}
                </span>
              </div>
              <div
                className="capacity-bars"
                title={occupancy === null ? 'ยังไม่ทราบความจุ' : `ใช้ความจุ ${occupancy}%`}
                aria-hidden="true"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <span
                    key={i}
                    className={occupancy !== null && i < Math.ceil((occupancy / 100) * 24) ? 'filled' : ''}
                  />
                ))}
              </div>
              <footer>
                <span>ความจุเซิร์ฟเวอร์ {occupancy === null ? '—' : occupancy + '%'}</span>
                <span title="เวลาตอบ HTTP/API ไม่ใช่ ping ในเกม">
                  {server.ping != null ? server.ping + ' ms · API' : 'รอข้อมูล'}
                </span>
              </footer>
            </article>

            <article className="dashboard-card session-card">
              <header>
                <span className="eyebrow">การเชื่อมต่อของคุณ</span>
                <ShieldCheck size={17} />
              </header>
              <div className="session-stats">
                <div>
                  <span>GAME BUILD</span>
                  <strong>{server.gameBuild || '—'}</strong>
                </div>
                <div>
                  <span>PURE MODE</span>
                  <strong>{server.lockPure ?? '—'}</strong>
                </div>
                <div>
                  <span>CL2</span>
                  <button
                    role="switch"
                    aria-label="เปิด FiveM ตัวที่สอง (Legacy)"
                    disabled={busy}
                    aria-checked={!!server.cl2}
                    className={`mini-switch ${server.cl2 ? 'on' : ''}`}
                    onClick={() => change('cl2', !server.cl2)}
                  >
                    <i />
                  </button>
                </div>
              </div>
              <div className={`session-mod-strip${pureCompat.mismatch ? ' is-conflict' : ''}`}>
                <span className="session-mod-label">
                  {pureCompat.mismatch ? <ShieldAlert size={13} /> : <Layers size={13} />}
                  <span>
                    {activePresetObj ? activePresetObj.name : 'Mod Presets'}
                    {pureCompat.mismatch ? ' · Pure Mode ชน!' : ''}
                  </span>
                </span>
                <div className="session-mod-actions">
                  {pureCompat.mismatch && !fivemRunning && (
                    <button
                      type="button"
                      className="session-mini-btn danger"
                      disabled={modBusy || busy}
                      onClick={() => onSwitchModPreset?.(CLEAN_PURE_PRESET_ID)}
                    >
                      Clean ทันที
                    </button>
                  )}
                  <button
                    type="button"
                    className="session-mini-btn"
                    onClick={() => jumpToDiagnostics('mods')}
                  >
                    จัดการม็อด
                  </button>
                </div>
              </div>
              <footer>
                <span className="endpoint" title={server.ip}>
                  {server.ip}
                </span>
                <span>LEGACY</span>
              </footer>
            </article>

            <article className="dashboard-card audio-card">
              <header>
                <span className="eyebrow">SOUND CHECK</span>
                <Headphones size={17} />
              </header>
              <MicIndicator onOpenMicTest={onOpenMicTest} />
              <footer>
                <span>ทดสอบเสียงก่อนเข้าเมือง</span>
                <ArrowUpRight size={15} />
              </footer>
            </article>
          </section>
        </>
      )}

      {server.queryError && <p className="query-note">{server.queryError}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}

      <div className="workspace-footer">
        <span className="local-note">
          <i /> ESTRA FIVEM LAUNCHER <span>/</span> v{APP_VERSION} · RUST/TAURI
        </span>
        <div className="workspace-footer-actions">
          <button
            className="quiet-button"
            disabled={busy || crashScanning}
            onClick={() => onOpenCrashAdvisor?.()}
            aria-label="วิเคราะห์ Crash Log ล่าสุด"
          >
            <FileWarning size={14} /> วิเคราะห์ Crash
          </button>
          <button
            className="quiet-button"
            disabled={busy}
            onClick={() => jumpToDiagnostics('watcher')}
            aria-label="ทดสอบเส้นทางและเฝ้าเมือง"
          >
            <Wifi size={14} /> Ping &amp; Watcher
          </button>
          <button className="quiet-button" disabled={busy} onClick={onOpenPatcher} aria-label="เปิด Patcher">
            <PackageCheck size={14} /> เปิด Patcher
          </button>
          <button className="quiet-button" disabled={busy} onClick={onOpenSettings} aria-label="เปิดการตั้งค่าด่วน">
            <Sparkles size={14} /> ตั้งค่าระบบ
          </button>
        </div>
      </div>

      {centerTab === 'general' && (
        <details id="server-config" className="configuration-panel">
          <summary>
            <SlidersHorizontal size={16} />
            <span>ตั้งค่ารายละเอียดเมือง</span>
            <ChevronDown size={16} />
          </summary>
          <div className="form-grid">
            <div className="form-row-2col">
              <div>
                <div className="form-field-header">
                  <label className="field-label" htmlFor="server-name">
                    ชื่อเซิร์ฟเวอร์
                  </label>
                  <button className="field-btn-action" onClick={onOpenNewServerModal}>
                    + NEW
                  </button>
                </div>
                <div className="input-container">
                  <input
                    id="server-name"
                    maxLength={100}
                    value={server.name}
                    onChange={e => change('name', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <div className="form-field-header">
                  <label className="field-label" htmlFor="server-ip">
                    ที่อยู่เซิร์ฟเวอร์
                  </label>
                </div>
                <div className="input-container">
                  <input
                    id="server-ip"
                    maxLength={300}
                    placeholder="IP:port, cfx.re/join/xxxxx หรือ connect ..."
                    value={editing ? ip : server.ip}
                    readOnly={!editing}
                    onChange={e => setIp(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveIp();
                      if (e.key === 'Escape') setEditing(false);
                    }}
                  />
                  <button className="btn-inline-orange" onClick={saveIp}>
                    {editing ? 'SAVE' : 'EDIT'}
                  </button>
                </div>
              </div>
            </div>

            <div className="tag-selector-row">
              <span className="tag-label">TAG</span>
              <div className="tag-pills-group">
                {SERVER_TAGS.map(tag => {
                  const activeTag = normalizeServerTag(server.tag, DEFAULT_SERVER_TAG);
                  return (
                    <button
                      key={tag}
                      className={`tag-pill-btn ${activeTag === tag ? 'active-roleplay' : ''}`}
                      aria-pressed={activeTag === tag}
                      onClick={() => change('tag', tag)}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-row-multi">
              <div>
                <label className="field-label" htmlFor="player-note">
                  Name ใน FiveM
                </label>
                <div className="input-container">
                  <input
                    id="player-note"
                    maxLength={100}
                    value={server.inGameName || ''}
                    onChange={e => change('inGameName', e.target.value)}
                    placeholder="เว้นว่างเพื่อใช้ชื่อปัจจุบัน"
                  />
                </div>
                <small className="help-text">
                  ใช้เป็น Name ใน Settings ของ FiveM เมื่อกดเข้าเมือง ต้องปิด FiveM ก่อนเปลี่ยนชื่อ • ชื่อตัวละคร RP ขึ้นอยู่กับระบบของเมือง
                </small>
              </div>
              <div>
                <span className="field-label">GAME BUILD</span>
                <div className="input-container input-locked">{server.gameBuild || 'ไม่ระบุ'}</div>
              </div>
              <div>
                <span className="field-label">PURE MODE</span>
                <div className="input-container input-locked">{server.lockPure ?? 'ไม่ระบุ'}</div>
              </div>
            </div>

            <p className="help-text">
              ตรวจ Game Build และ Pure Mode ล่าสุดจากเซิร์ฟเวอร์ก่อนเปิดเกมทุกครั้ง • CL2 สำหรับ GTA V Legacy
            </p>

            <div>
              <label className="field-label" htmlFor="city-mod-preset">
                โปรไฟล์ม็อดประจำเมือง (สลับอัตโนมัติก่อนเข้าเมือง)
              </label>
              <div className="input-container">
                <select
                  id="city-mod-preset"
                  value={server.modPresetId || ''}
                  onChange={e => change('modPresetId', e.target.value)}
                >
                  <option value="">ใช้โปรไฟล์ม็อดปัจจุบัน (ไม่สลับอัตโนมัติ)</option>
                  {(modState?.presets || []).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.pureSafe ? '(Pure 1/2 Safe)' : '(Pure 0)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-inline-orange"
                  onClick={() => jumpToDiagnostics('mods')}
                >
                  จัดการม็อด
                </button>
              </div>
              <small className="help-text">
                เมื่อกดเข้าเมืองนี้ Launcher จะสลับโฟลเดอร์ mods/ และ plugins/ ให้ตรงกับโปรไฟล์ที่ผูกไว้อัตโนมัติ (ต้องปิด FiveM ก่อน)
              </small>
            </div>

            <div>
              <label className="field-label" htmlFor="city-banner">
                รูปพื้นหลังเมือง (URL รูปภาพ)
              </label>
              <div className="input-container">
                <input
                  id="city-banner"
                  type="url"
                  maxLength={2048}
                  value={bannerDraft}
                  onChange={e => setBannerDraft(e.target.value)}
                  placeholder="https://example.com/city-banner.jpg"
                  aria-describedby="city-banner-help"
                />
                <button
                  className="btn-inline-orange"
                  onClick={() => {
                    const value = bannerDraft.trim();
                    const safe = bannerImageUrl(value);
                    if (value && !safe) {
                      setBannerError('กรุณาระบุ URL รูปภาพแบบ HTTP หรือ HTTPS');
                      return;
                    }
                    change('customBannerUrl', safe);
                    setBannerDraft(safe || '');
                    setBannerError('');
                  }}
                >
                  บันทึกรูป
                </button>
              </div>
              {bannerError && (
                <p role="alert" className="error-message">
                  {bannerError}
                </p>
              )}
              <p id="city-banner-help" className="help-text">
                {backgroundKind === 'banner'
                  ? 'กำลังใช้แบนเนอร์ที่เซิร์ฟเวอร์ประกาศ'
                  : backgroundKind === 'custom'
                    ? 'กำลังใช้รูปที่คุณกำหนดให้เมืองนี้'
                    : backgroundKind === 'loading'
                      ? 'กำลังโหลดรูปพื้นหลัง…'
                      : 'ไม่มีแบนเนอร์ที่โหลดได้ จึงใช้ธีมและโลโก้ประจำเมือง'}{' '}
                • เว้นว่างแล้วบันทึกเพื่อกลับไปใช้รูปอัตโนมัติ
              </p>
            </div>
          </div>
        </details>
      )}
    </main>
  );
}
