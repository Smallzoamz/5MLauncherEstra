import React, { useState, useEffect } from 'react';
import { parseTarget } from '../shared/target';
import presenceService from '../services/presenceService';
import { bannerImageUrl } from '../shared/serverMedia';
import { cityBackdrop } from '../shared/cityBackdrop';
import MicIndicator from './MicIndicator';
import ServerAvatar from './ServerAvatar';
import { normalizePatchManifestUrl } from '../shared/patcherConfig';
import {
  Play,
  ArrowUpRight,
  RefreshCw,
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
  Sparkles
} from 'lucide-react';

export default function MainLauncher({
  server,
  servers = [],
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
  historyEntries = [],
  social,
  launcherUpdate,
  busy,
  onLaunch
}) {
  const [editing, setEditing] = useState(false);
  const [ip, setIp] = useState(server?.ip || '');
  const [error, setError] = useState('');
  const [bannerDraft, setBannerDraft] = useState(server?.customBannerUrl || '');
  const [bannerError, setBannerError] = useState('');
  const [patchDraft, setPatchDraft] = useState(server?.patchManifestUrl || '');
  const [patchError, setPatchError] = useState('');
  const [presence, setPresence] = useState(presenceService.getPresence());

  useEffect(() => presenceService.subscribe(setPresence), []);

  if (!server) {
    return (
      <main className="main-content empty-state">
        <span className="eyebrow">YOUR NEXT STORY STARTS HERE</span>
        <h2>ยังไม่มีเซิร์ฟเวอร์ที่บันทึก</h2>
        <p>เพิ่ม IP หรือ Cfx.re join link เพื่อเริ่มใช้งาน</p>
        <button className="btn-action-refresh" onClick={onOpenNewServerModal}>
          เพิ่มเซิร์ฟเวอร์
        </button>
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
      onUpdateServer({
        id: server.id,
        ip: address,
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

  const resumeCities = [...servers]
    .sort((a, b) => {
      if (a.id === server.id) return -1;
      if (b.id === server.id) return 1;
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return 0;
    })
    .slice(0, 3);

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
      {centerTab === 'news' && (
        <section className="subtab-panel" aria-label="แพตช์และข่าวสารของเมือง">
          <div className="subtab-banner">
            <div>
              <span className="eyebrow">CITY PATCH &amp; UPDATES</span>
              <h2>แพตช์ของ {server.name}</h2>
              <p>
                {server.patchManifestUrl
                  ? `เชื่อมต่อไปยัง: ${server.patchManifestUrl}`
                  : 'เมืองนี้ยังไม่ได้ตั้งค่า Patch Manifest URL — สามารถระบุลิงก์ GitHub Raw HTTPS ด้านล่างได้'}
              </p>
            </div>
            <button type="button" className="btn-action-play" onClick={onOpenPatcher}>
              <PackageCheck size={16} /> เปิดศูนย์ Patcher
            </button>
          </div>
          {launcherUpdate?.available && (
            <div className="subtab-update-card">
              <div>
                <span className="eyebrow">LAUNCHER UPDATE</span>
                <strong>Estra Launcher v{launcherUpdate.version} พร้อมอัปเดต</strong>
                {launcherUpdate.notes && <pre className="subtab-notes">{launcherUpdate.notes}</pre>}
              </div>
              <button type="button" className="btn-inline-cobalt" onClick={onOpenPatcher}>
                ดูรายละเอียดอัปเดต
              </button>
            </div>
          )}
        </section>
      )}

      {centerTab === 'discover' && (
        <section className="subtab-panel" aria-label="กิจกรรมและสถานะระบบ">
          <div className="subtab-banner">
            <div>
              <span className="eyebrow">ACTIVITY &amp; SYSTEM</span>
              <h2>กิจกรรมล่าสุด &amp; สถานะเครื่อง</h2>
              <p>ตรวจสอบ Steam, Discord, FiveM process และประวัติการเข้าเมืองล่าสุดของคุณ</p>
            </div>
            <button type="button" className="soft-button" onClick={onOpenHistory}>
              <History size={15} /> ประวัติทั้งหมด ({historyEntries.length})
            </button>
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
        </section>
      )}

      {centerTab === 'general' && (
        <>
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
                    {server.tag || 'ไม่มีหมวดหมู่'} <span>·</span> FiveM
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
                      ? 'Offline'
                      : 'กำลังรอตรวจสถานะ'}
                </span>
                {server.gameBuild && <span className="hero-spec-badge">Build {server.gameBuild}</span>}
                {server.lockPure != null && <span className="hero-spec-badge">Pure {server.lockPure}</span>}
              </div>

              <p className="hero-description">
                เรื่องราวต่อไปของคุณ เริ่มต้นที่นี่ · <span className="hero-ip-inline">{server.ip}</span>
              </p>

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
                        <small>{city.tag || 'FiveM'} · {city.status === 'Online' && city.onlinePlayers != null ? `${city.onlinePlayers}/${city.maxPlayers}` : city.ip}</small>
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
          <i /> ESTRA FIVEM LAUNCHER <span>/</span> v2.0.1 · RUST/TAURI
        </span>
        <div className="workspace-footer-actions">
          <button className="quiet-button" disabled={busy} onClick={onOpenPatcher} aria-label="เปิด Patcher">
            <PackageCheck size={14} /> เปิด Patcher
          </button>
          <button className="quiet-button" disabled={busy} onClick={onOpenSettings} aria-label="เปิดการตั้งค่าด่วน">
            <Sparkles size={14} /> ตั้งค่าระบบ
          </button>
        </div>
      </div>

      {centerTab !== 'discover' && (
        <details id="server-config" className="configuration-panel" open={centerTab === 'news' ? true : undefined}>
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
                {['ไม่มี', 'Roleplay', 'Training'].map(tag => (
                  <button
                    key={tag}
                    className={`tag-pill-btn ${server.tag === tag ? 'active-roleplay' : ''}`}
                    aria-pressed={server.tag === tag}
                    onClick={() => change('tag', tag)}
                  >
                    {tag}
                  </button>
                ))}
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

            <div>
              <label className="field-label" htmlFor="city-patch-manifest">
                Patch Manifest URL ของเมือง (HTTPS · GitHub)
              </label>
              <div className="input-container">
                <input
                  id="city-patch-manifest"
                  type="url"
                  maxLength={2048}
                  value={patchDraft}
                  onChange={e => setPatchDraft(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/owner/repo/main/patch-manifest.json"
                />
                <button
                  className="btn-inline-orange"
                  onClick={() => {
                    const value = patchDraft.trim();
                    const safe = normalizePatchManifestUrl(value);
                    if (value && !safe) {
                      setPatchError('กรุณาระบุ URL แบบ HTTPS เท่านั้น');
                      return;
                    }
                    change('patchManifestUrl', safe || '');
                    setPatchDraft(safe || '');
                    setPatchError('');
                  }}
                >
                  บันทึกแพตช์
                </button>
              </div>
              {patchError && (
                <p role="alert" className="error-message">
                  {patchError}
                </p>
              )}
              <p className="help-text">
                ใช้สำหรับตรวจไฟล์และดาวน์โหลดแพตช์เสริมของเมืองผ่านเมนู Patcher • เว้นว่างได้ถ้าเมืองไม่มีไฟล์แพตช์
              </p>
            </div>
          </div>
        </details>
      )}
    </main>
  );
}
