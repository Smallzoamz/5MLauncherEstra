import React, { useState, useEffect } from 'react';

import presenceService from '../services/presenceService';
import WindowMenu from './WindowMenu';
export default function Header({ onOpenLibrary, onOpenPatcher, hasLauncherUpdate }) {
  const [presence, setPresence] = useState(presenceService.getPresence());
  useEffect(() => presenceService.subscribe(setPresence), []);
  return <header className="main-header" data-tauri-drag-region><nav className="top-navigation" aria-label="หน้าหลัก"><span className="active">ภาพรวม<span className="nav-dot" /></span><button onClick={onOpenLibrary}>เมืองของฉัน</button><button className={hasLauncherUpdate ? 'has-update-badge' : ''} onClick={onOpenPatcher}>แพตช์ &amp; อัปเดต</button></nav>
    <div className="accounts-section" data-tauri-drag-region>{['discord', 'steam'].map(key => <Account key={key} type={key} value={presence[key]} />)}<WindowMenu /></div>
  </header>;
}

function Account({ type, value }) {
  const user = value.running ? value.user : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user?.id, user?.avatarUrl]);
  const platform = type === 'discord' ? 'Discord' : 'Steam';
  return <div className="account-pill" data-account={type} title={user ? `${platform} · ${user.displayName}` : value.profileError || value.error || platform}>
    {user && <span className="account-avatar">{user.avatarUrl && !broken ? <img src={user.avatarUrl} alt={`รูปโปรไฟล์ ${platform}`} referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : user.displayName.slice(0, 2)}</span>}
    <span className={`system-status-dot ${value.running ? 'active' : 'offline'}`} />
    <span className="account-copy">{platform}<small>{user?.displayName || (value.running == null ? 'ยังตรวจสอบไม่ได้' : value.running ? 'เปิดอยู่ · อ่านบัญชีไม่ได้' : 'ไม่ได้เปิด')}</small></span>
  </div>;
}


