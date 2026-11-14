import React, { useState, useEffect, useRef } from 'react';
import { Bell, Users } from 'lucide-react';
import presenceService from '../services/presenceService';
import WindowMenu from './WindowMenu';

export default function Header({
  centerTab,
  onChangeTab,
  onOpenPatcher,
  hasLauncherUpdate,
  launcherUpdate,
  gameNotice,
  social,
  onToggleFriendsMobile,
  onOpenAuth
}) {
  const [presence, setPresence] = useState(presenceService.getPresence());
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  useEffect(() => presenceService.subscribe(setPresence), []);
  useEffect(() => {
    const onDown = e => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const incomingCount = social?.incomingRequests?.length || 0;
  const notifCount = (hasLauncherUpdate ? 1 : 0) + incomingCount + (gameNotice ? 1 : 0);

  return (
    <header className="main-header" data-tauri-drag-region>
      <nav className="top-navigation" aria-label="หน้าหลัก">
        <button
          type="button"
          className={centerTab === 'general' ? 'active' : ''}
          aria-pressed={centerTab === 'general'}
          onClick={() => onChangeTab('general')}
        >
          ภาพรวม
          {centerTab === 'general' && <span className="nav-dot" />}
        </button>
        <button
          type="button"
          className={`${centerTab === 'news' ? 'active' : ''}${hasLauncherUpdate ? ' has-update-badge' : ''}`}
          aria-pressed={centerTab === 'news'}
          onClick={() => onChangeTab('news')}
        >
          แพตช์ &amp; ข่าวสาร
          {centerTab === 'news' && <span className="nav-dot" />}
        </button>
        <button
          type="button"
          className={centerTab === 'discover' ? 'active' : ''}
          aria-pressed={centerTab === 'discover'}
          onClick={() => onChangeTab('discover')}
        >
          กิจกรรม &amp; ระบบ
          {centerTab === 'discover' && <span className="nav-dot" />}
        </button>
      </nav>

      <div className="accounts-section" data-tauri-drag-region>
        {['discord', 'steam'].map(key => (
          <Account key={key} type={key} value={presence[key]} />
        ))}

        <div className="notif-wrap" ref={notifRef}>
          <button
            type="button"
            className="header-icon-btn"
            aria-label="การแจ้งเตือน"
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen(v => !v)}
          >
            <Bell size={16} />
            {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
          </button>
          {notifOpen && (
            <div className="notif-popover" role="region" aria-label="รายการแจ้งเตือน">
              <div className="notif-popover-head">
                <strong>การแจ้งเตือน</strong>
                <span>{notifCount} รายการ</span>
              </div>
              {notifCount === 0 ? (
                <p className="notif-empty">ไม่มีการแจ้งเตือนใหม่ในขณะนี้</p>
              ) : (
                <ul className="notif-list">
                  {hasLauncherUpdate && (
                    <li>
                      <span>มีอัปเดต Estra Launcher v{launcherUpdate?.version}</span>
                      <button type="button" className="btn-inline-cobalt" onClick={() => { setNotifOpen(false); onOpenPatcher(); }}>
                        เปิด Patcher
                      </button>
                    </li>
                  )}
                  {incomingCount > 0 && (
                    <li>
                      <span>มีคำขอเป็นเพื่อนใหม่ {incomingCount} รายการ</span>
                      <button type="button" className="btn-inline-cobalt" onClick={() => { setNotifOpen(false); onToggleFriendsMobile(); }}>
                        ดูคำขอ
                      </button>
                    </li>
                  )}
                  {gameNotice?.message && (
                    <li>
                      <span>{gameNotice.message}</span>
                    </li>
                  )}
                </ul>
              )}
              {!social?.authenticated && (
                <button
                  type="button"
                  className="soft-button notif-login-btn"
                  onClick={() => { setNotifOpen(false); onOpenAuth('login'); }}
                >
                  เข้าสู่ระบบ Estra Account
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="header-icon-btn friends-toggle-btn"
          aria-label="เปิดแถบเพื่อน"
          title="รายชื่อเพื่อน"
          onClick={onToggleFriendsMobile}
        >
          <Users size={16} />
          {incomingCount > 0 && <span className="notif-badge">{incomingCount}</span>}
        </button>

        <WindowMenu />
      </div>
    </header>
  );
}

function Account({ type, value }) {
  const user = value.running ? value.user : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user?.id, user?.avatarUrl]);
  const platform = type === 'discord' ? 'Discord' : 'Steam';
  return (
    <div
      className="account-pill"
      data-account={type}
      title={user ? `${platform} · ${user.displayName}` : value.profileError || value.error || platform}
    >
      {user && (
        <span className="account-avatar">
          {user.avatarUrl && !broken ? (
            <img
              src={user.avatarUrl}
              alt={`รูปโปรไฟล์ ${platform}`}
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
            />
          ) : (
            user.displayName.slice(0, 2)
          )}
        </span>
      )}
      <span className={`system-status-dot ${value.running ? 'active' : 'offline'}`} />
      <span className="account-copy">
        {platform}
        <small>
          {user?.displayName ||
            (value.running == null
              ? 'ยังตรวจสอบไม่ได้'
              : value.running
                ? 'เปิดอยู่ · อ่านบัญชีไม่ได้'
                : 'ไม่ได้เปิด')}
        </small>
      </span>
    </div>
  );
}
