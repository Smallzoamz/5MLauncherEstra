import React, { useState, useEffect } from 'react';
import { parseTarget } from '../shared/target';
import presenceService from '../services/presenceService';
import { bannerImageUrl } from '../shared/serverMedia';
import MicIndicator from './MicIndicator';
import ServerAvatar from './ServerAvatar';
import { normalizePatchManifestUrl } from '../shared/patcherConfig';
import { Play, ArrowUpRight, RefreshCw, SlidersHorizontal, ShieldCheck, Headphones, Trash2, ChevronDown, PackageCheck } from 'lucide-react';

export default function MainLauncher({ server, settings, backgroundKind, onUpdateServer, onRefresh, isRefreshing, onOpenNewServerModal, onOpenSettings, onOpenCacheModal, onOpenMicTest, onOpenPatcher, busy, onLaunch }) {
  const [editing, setEditing] = useState(false);
  const [ip, setIp] = useState(server?.ip || '');
  const [error, setError] = useState('');
  const [bannerDraft, setBannerDraft] = useState(server?.customBannerUrl || '');
  const [bannerError, setBannerError] = useState('');
  const [patchDraft, setPatchDraft] = useState(server?.patchManifestUrl || '');
  const [patchError, setPatchError] = useState('');
  const [presence, setPresence] = useState(presenceService.getPresence());
  useEffect(() => presenceService.subscribe(setPresence), []);
  if (!server) return <main className="main-content empty-state"><span className="eyebrow">YOUR NEXT STORY STARTS HERE</span><h2>ยังไม่มีเซิร์ฟเวอร์ที่บันทึก</h2><p>เพิ่ม IP หรือ Cfx.re join link เพื่อเริ่มใช้งาน</p><button className="btn-action-refresh" onClick={onOpenNewServerModal}>เพิ่มเซิร์ฟเวอร์</button></main>;
  const change = (field, value) => onUpdateServer({ id: server.id, [field]: value });
  const saveIp = () => {
    if (!editing) { setIp(server.ip); setEditing(true); return; }
    try {
      const address = parseTarget(ip).address;
      onUpdateServer({ id: server.id, ip: address, status: 'Unknown', onlinePlayers: null, maxPlayers: null, gameBuild: null, lockPure: null, ping: null, queryError: null, logoUrl: null, iconSource: null, bannerUrl: null, connectingBannerUrl: null });
      setEditing(false); setError('');
    } catch (err) { setError(err.message); }
  };
  const occupancy = server.status === 'Online' && server.maxPlayers > 0 ? Math.min(100, Math.round((server.onlinePlayers / server.maxPlayers) * 100)) : null;
  const words = server.name.trim().split(/\s+/);
  const titleTop = words.length > 1 ? words.slice(0, -1).join(' ') : server.name;
  const titleBottom = words.length > 1 ? words.at(-1) : '';
  const processBlocked = !server.cl2 && presence.fivem?.running !== false;
  const processMessage = presence.fivem?.running === true
    ? (server.cl2 ? 'FiveM กำลังทำงานอยู่ • CL2 พร้อมเปิดเกมตัวที่สอง' : 'FiveM กำลังทำงานอยู่ — ปิดเกมเดิม หรือเปิด CL2 เพื่อเริ่มเกมตัวที่สอง')
    : presence.fivem?.running === false ? 'FiveM ยังไม่ได้เปิด • พร้อมเริ่มเกม' : 'กำลังรอตรวจสอบสถานะ FiveM';
  return <main className="main-content">
    <section className={`hero-section${server.name.length > 28 ? ' has-long-title' : ''}`} key={server.id} aria-labelledby="selected-server">
      <div className="hero-copy">
        <div className="selected-city"><ServerAvatar server={server} /><span><span className="eyebrow">SELECTED CITY</span><span className="hero-tag">{server.tag || 'ไม่มีหมวดหมู่'} <span>·</span> FiveM</span></span></div>
        <h1 id="selected-server"><span>{titleTop}</span>{titleBottom && <span>{titleBottom}</span>}</h1>
        <p className="hero-description">เรื่องราวต่อไปของคุณ เริ่มต้นที่นี่</p>
        <div className="hero-actions"><button className="play-button btn-action-play" aria-label="กดเล่น" aria-describedby="fivem-process-status" disabled={busy || editing || processBlocked} onClick={() => onLaunch(server)}><span className="play-icon"><Play size={15} fill="currentColor" /></span>{busy ? 'กำลังเตรียมเกม…' : processBlocked && presence.fivem?.running ? 'เกมกำลังทำงาน' : 'เข้าเมือง'}<span className="play-label">{server.cl2 ? 'CL2' : 'PLAY'}</span></button>
          <button className="hero-edit" onClick={() => { const details = document.getElementById('server-config'); details.open = !details.open; if (details.open) details.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }} aria-label="รายละเอียดเมือง"><SlidersHorizontal size={17} /> รายละเอียดเมือง</button></div>
        <div className={`process-status${processBlocked ? ' blocked' : ''}`}><span id="fivem-process-status" role="status">{presence.fivem?.error ? 'ตรวจสอบสถานะ FiveM ไม่ได้ กรุณาตรวจใหม่' : processMessage}</span><button className="icon-button" aria-label="ตรวจสถานะ FiveM อีกครั้ง" title="ตรวจสถานะ FiveM อีกครั้ง" onClick={() => presenceService.checkPresence()}><RefreshCw size={13} /></button></div>
      </div>
      <span className="art-caption">{backgroundKind === 'banner' ? 'CITY BANNER / ' + server.name : backgroundKind === 'custom' ? 'CUSTOM BANNER / ' + server.name : 'CITY THEME / ' + server.name}</span>
    </section>
    <div className="dashboard-heading"><span className="eyebrow">BEFORE YOU JUMP IN</span><span>ทุกอย่างพร้อม สำหรับเมืองของคุณ</span></div>
    <section className="dashboard-grid" aria-label="ข้อมูลก่อนเข้าเมือง">
      <article className="dashboard-card server-health">
        <header><span className="eyebrow">สถานะเมือง</span><button className="icon-button" aria-label="รีเฟรช" title="ตรวจสอบใหม่" disabled={isRefreshing} onClick={onRefresh}><RefreshCw size={15} className={isRefreshing ? 'spinning' : ''} /></button></header>
        <div className="population-row"><strong>{server.onlinePlayers ?? '—'} / {server.maxPlayers ?? '—'}</strong><span className={`live-label ${server.status === 'Online' ? 'online' : server.status === 'Offline' ? 'offline' : ''}`}><i />{isRefreshing ? 'กำลังตรวจสอบ…' : ['Online', 'Offline'].includes(server.status) ? server.status : 'ตรวจสอบไม่ได้'}</span></div>
        <div className="capacity-bars" title={occupancy === null ? 'ยังไม่ทราบความจุ' : `ใช้ความจุ ${occupancy}%`} aria-hidden="true">{Array.from({length:24},(_,i)=><span key={i} className={occupancy !== null && i < Math.ceil(occupancy/100*24) ? 'filled' : ''} />)}</div>
        <footer><span>ความจุเซิร์ฟเวอร์ {occupancy === null ? '—' : occupancy+'%'}</span><span title="เวลาตอบ HTTP/API ไม่ใช่ ping ในเกม">{server.ping != null ? server.ping+' ms · API' : 'รอข้อมูล'}</span></footer>
      </article>
      <article className="dashboard-card session-card"><header><span className="eyebrow">การเชื่อมต่อของคุณ</span><ShieldCheck size={17} /></header>
        <div className="session-stats"><div><span>GAME BUILD</span><strong>{server.gameBuild || '—'}</strong></div><div><span>PURE MODE</span><strong>{server.lockPure ?? '—'}</strong></div><div><span>CL2</span><button role="switch" aria-label="เปิด FiveM ตัวที่สอง (Legacy)" disabled={busy} aria-checked={!!server.cl2} className={`mini-switch ${server.cl2 ? 'on' : ''}`} onClick={() => change('cl2', !server.cl2)}><i /></button></div></div>
        <footer><span className="endpoint" title={server.ip}>{server.ip}</span><span>LEGACY</span></footer>
      </article>
      <article className="dashboard-card audio-card"><header><span className="eyebrow">SOUND CHECK</span><Headphones size={17} /></header><MicIndicator onOpenMicTest={onOpenMicTest} /><footer><span>ทดสอบเสียงก่อนเข้าเมือง</span><ArrowUpRight size={15} /></footer></article>
    </section>
    {server.queryError && <p className="query-note">{server.queryError}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="workspace-footer"><span className="local-note"><i /> ESTRA FIVEM LAUNCHER <span>/</span> v2.0.0 · RUST/TAURI</span><div className="workspace-footer-actions"><button className="quiet-button" disabled={busy} onClick={onOpenPatcher} aria-label="เปิด Patcher"><PackageCheck size={14} /> เปิด Patcher</button><button className="quiet-button" disabled={busy} onClick={onOpenCacheModal} aria-label="ล้างแคช"><Trash2 size={14} /> ล้างแคชเซิร์ฟเวอร์</button></div></div>
    <details id="server-config" className="configuration-panel"><summary><SlidersHorizontal size={16} /><span>ตั้งค่ารายละเอียดเมือง</span><ChevronDown size={16} /></summary>
    <div className="form-grid">
      <div className="form-row-2col">
        <div><div className="form-field-header"><label className="field-label" htmlFor="server-name">ชื่อเซิร์ฟเวอร์</label><button className="field-btn-action" onClick={onOpenNewServerModal}>+ NEW</button></div>
          <div className="input-container"><input id="server-name" maxLength={100} value={server.name} onChange={e => change('name', e.target.value)} /></div></div>
        <div><div className="form-field-header"><label className="field-label" htmlFor="server-ip">ที่อยู่เซิร์ฟเวอร์</label></div>
          <div className="input-container"><input id="server-ip" value={editing ? ip : server.ip} readOnly={!editing} onChange={e => setIp(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveIp(); if (e.key === 'Escape') setEditing(false); }} /><button className="btn-inline-orange" onClick={saveIp}>{editing ? 'SAVE' : 'EDIT'}</button></div></div>
      </div>
      <div className="tag-selector-row"><span className="tag-label">TAG</span><div className="tag-pills-group">
        {['ไม่มี', 'Roleplay', 'Training'].map(tag => <button key={tag} className={`tag-pill-btn ${server.tag === tag ? 'active-roleplay' : ''}`} aria-pressed={server.tag === tag} onClick={() => change('tag', tag)}>{tag}</button>)}
      </div></div>
      <div className="form-row-multi">
        <div><label className="field-label" htmlFor="player-note">Name ใน FiveM</label><div className="input-container"><input id="player-note" maxLength={100} value={server.inGameName || ''} onChange={e => change('inGameName', e.target.value)} placeholder="เว้นว่างเพื่อใช้ชื่อปัจจุบัน" /></div><small className="help-text">ใช้เป็น Name ใน Settings ของ FiveM เมื่อกดเข้าเมือง ต้องปิด FiveM ก่อนเปลี่ยนชื่อ • ชื่อตัวละคร RP ขึ้นอยู่กับระบบของเมือง</small></div>
        <div><span className="field-label">GAME BUILD</span><div className="input-container input-locked">{server.gameBuild || 'ไม่ระบุ'}</div></div>
        <div><span className="field-label">PURE MODE</span><div className="input-container input-locked">{server.lockPure ?? 'ไม่ระบุ'}</div></div>

      </div>
      <p className="help-text">ตรวจ Game Build และ Pure Mode ล่าสุดจากเซิร์ฟเวอร์ก่อนเปิดเกมทุกครั้ง • CL2 สำหรับ GTA V Legacy</p>
      <div><label className="field-label" htmlFor="city-banner">รูปพื้นหลังเมือง (URL รูปภาพ)</label>
        <div className="input-container"><input id="city-banner" type="url" maxLength={2048} value={bannerDraft} onChange={e => setBannerDraft(e.target.value)} placeholder="https://example.com/city-banner.jpg" aria-describedby="city-banner-help" />
          <button className="btn-inline-orange" onClick={() => { const value = bannerDraft.trim(); const safe = bannerImageUrl(value); if (value && !safe) { setBannerError('กรุณาระบุ URL รูปภาพแบบ HTTP หรือ HTTPS'); return; } change('customBannerUrl', safe); setBannerDraft(safe || ''); setBannerError(''); }}>บันทึกรูป</button></div>
        {bannerError && <p role="alert" className="error-message">{bannerError}</p>}
        <p id="city-banner-help" className="help-text">{backgroundKind === 'banner' ? 'กำลังใช้แบนเนอร์ที่เซิร์ฟเวอร์ประกาศ' : backgroundKind === 'custom' ? 'กำลังใช้รูปที่คุณกำหนดให้เมืองนี้' : backgroundKind === 'loading' ? 'กำลังโหลดรูปพื้นหลัง…' : 'ไม่มีแบนเนอร์ที่โหลดได้ จึงใช้ธีมและโลโก้ประจำเมือง'} • เว้นว่างแล้วบันทึกเพื่อกลับไปใช้รูปอัตโนมัติ</p>
      </div>
      <div><label className="field-label" htmlFor="city-patch-manifest">Patch Manifest URL ของเมือง (HTTPS · GitHub)</label>
        <div className="input-container"><input id="city-patch-manifest" type="url" maxLength={2048} value={patchDraft} onChange={e => setPatchDraft(e.target.value)} placeholder="https://raw.githubusercontent.com/owner/repo/main/patch-manifest.json" />
          <button className="btn-inline-orange" onClick={() => { const value = patchDraft.trim(); const safe = normalizePatchManifestUrl(value); if (value && !safe) { setPatchError('กรุณาระบุ URL แบบ HTTPS เท่านั้น'); return; } change('patchManifestUrl', safe || ''); setPatchDraft(safe || ''); setPatchError(''); }}>บันทึกแพตช์</button></div>
        {patchError && <p role="alert" className="error-message">{patchError}</p>}
        <p className="help-text">ใช้สำหรับตรวจไฟล์และดาวน์โหลดแพตช์เสริมของเมืองผ่านเมนู Patcher • เว้นว่างได้ถ้าเมืองไม่มีไฟล์แพตช์</p>
      </div>
    </div>

    </details>
  </main>;
}



