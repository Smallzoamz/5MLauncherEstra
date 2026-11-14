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
  onToggleFriendsMobile
}) {
  const [presence, setPresence] = useState(presenceService.getPresence());
  const [notifOpen, setNotifOpen] = useState(false);
  const [seenIds, setSeenIds] = useState(() => new Set());
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
  const incomingInvitesCount = social?.incomingInvites?.length || 0;
  const notifItems = [];
  if (hasLauncherUpdate && launcherUpdate?.version) {
    notifItems.push({
      id: `update:${launcherUpdate.version}`,
      label: `มีอัปเดต Estra Launcher v${launcherUpdate.version}`,
      actionLabel: 'เปิด Patcher',
      onAction: () => { setNotifOpen(false); onOpenPatcher(); }
    });
  }
  if (incomingCount > 0) {
    const reqKey = (social?.incomingRequests || []).map(r => r.id).sort().join(',');
    notifItems.push({
      id: `requests:${reqKey}`,
      label: `มีคำขอเป็นเพื่อนใหม่ ${incomingCount} รายการ`,
      actionLabel: 'ดูคำขอ',
      onAction: () => { setNotifOpen(false); onToggleFriendsMobile(); }
    });
  }
  if (incomingInvitesCount > 0) {
    const invKey = (social?.incomingInvites || []).map(inv => inv.id).sort().join(',');
    notifItems.push({
      id: `invites:${invKey}`,
      label: `มีคำชวนเข้าเล่นเมืองด้วยกัน ${incomingInvitesCount} รายการ`,
      actionLabel: 'ดูคำชวน',
      onAction: () => { setNotifOpen(false); onToggleFriendsMobile(); }
    });
  }
  if (gameNotice?.message) {
    notifItems.push({
      id: `game:${gameNotice._seq || 0}:${gameNotice.state || 'info'}:${gameNotice.message}`,
      label: gameNotice.message
    });
  }

  const activeIdKey = notifItems.map(item => item.id).join('|');
  useEffect(() => {
    const activeSet = new Set(notifItems.map(item => item.id));
    setSeenIds(prev => {
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (activeSet.has(id)) next.add(id);
        else changed = true;
      }
      if (notifOpen) {
        for (const id of activeSet) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [notifOpen, activeIdKey]);

  const unreadCount = notifItems.filter(item => !seenIds.has(item.id)).length;

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
            onClick={() => {
              const nextOpen = !notifOpen;
              if (nextOpen && notifItems.length > 0) {
                setSeenIds(prev => {
                  const next = new Set(prev);
                  for (const item of notifItems) next.add(item.id);
                  return next;
                });
              }
              setNotifOpen(nextOpen);
            }}
          >
            <Bell size={16} />
            {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
          </button>
          {notifOpen && (
            <div className="notif-popover" role="region" aria-label="รายการแจ้งเตือน">
              <div className="notif-popover-head">
                <strong>การแจ้งเตือน</strong>
                <span>{notifItems.length} รายการ</span>
              </div>
              {notifItems.length === 0 ? (
                <p className="notif-empty">ไม่มีการแจ้งเตือนในขณะนี้</p>
              ) : (
                <ul className="notif-list">
                  {notifItems.map(item => (
                    <li key={item.id}>
                      <span>{item.label}</span>
                      {item.actionLabel && (
                        <button type="button" className="btn-inline-cobalt" onClick={item.onAction}>
                          {item.actionLabel}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
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
