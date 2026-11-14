import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Gamepad2,
  Globe,
  Headphones,
  History,
  Home,
  PackageCheck,
  Plus,
  Search,
  Settings2,
  Star,
  Trash2,
  UserCircle2
} from 'lucide-react';
import ServerAvatar from './ServerAvatar';
import { UserAvatar } from './UserAvatar';
import { APP_VERSION } from '../shared/patcherConfig';
import { COMMUNITY_CHANNELS } from '../shared/communityLinks';

function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.62 1.26a18.27 18.27 0 0 0-5.4 0c-.17-.4-.41-.88-.63-1.26a.08.08 0 0 0-.08-.04c-1.7.3-3.34.81-4.93 1.52a.07.07 0 0 0-.03.03C.53 9.04-.32 13.57.1 18.05a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 6.02 3.04.08.08 0 0 0 .09-.03c.46-.63.88-1.3 1.23-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.13c.13-.09.25-.19.37-.29a.08.08 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.08.08 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.11c.36.7.78 1.37 1.23 2a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6.03-3.04.08.08 0 0 0 .03-.05c.5-5.17-.84-9.66-3.55-13.65a.06.06 0 0 0-.03-.03ZM8.02 15.3c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-8.2h2.76l.41-3.2H13.5V7.56c0-.93.26-1.56 1.59-1.56h1.7V3.14A22.7 22.7 0 0 0 14.32 3c-2.45 0-4.12 1.5-4.12 4.24V9.6H7.45v3.2h2.75V21h3.3Z" />
    </svg>
  );
}

export default function ServerSidebar({
  servers,
  activeServerId,
  centerTab,
  onChangeTab,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onSelectServer,
  onToggleFavoriteServer,
  onOpenNewServerModal,
  onOpenLibrary,
  onOpenSettings,
  onOpenMicTest,
  onOpenHistory,
  onOpenPatcher,
  onOpenCacheModal,
  hasLauncherUpdate,
  social,
  onOpenAuth,
  communityLinks,
  onOpenCommunityLink
}) {
  const user = social?.authenticated ? social.user : null;
  const favoriteServers = servers.filter(s => s.favorite);
  const shownFavorites = favoriteServers.length > 0 ? favoriteServers : servers;

  return (
    <aside className="nav-rail" aria-label="เมนู Launcher">
      <div className="rail-top-controls" data-tauri-drag-region>
        <div className="rail-window-dots" aria-hidden="true">
          <span className="dot-red" />
          <span className="dot-amber" />
          <span className="dot-green" />
        </div>
        <div className="rail-history-arrows">
          <button
            type="button"
            className="rail-arrow-btn"
            disabled={!canGoBack}
            onClick={onGoBack}
            aria-label="ย้อนกลับ"
            title="ย้อนกลับ"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="rail-arrow-btn"
            disabled={!canGoForward}
            onClick={onGoForward}
            aria-label="ไปข้างหน้า"
            title="ไปข้างหน้า"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="rail-brand-account">
        <button
          type="button"
          className="rail-brand-btn"
          onClick={() => onChangeTab('general')}
          title="Estra FiveM Launcher"
        >
          <img src="/brand/estra-mark.png" alt="Estra" />
          <span>Estra</span>
        </button>

        <button
          type="button"
          className="rail-account-chip"
          onClick={() => onOpenAuth(user ? 'login' : 'login')}
          aria-label={user ? `บัญชี ${user.displayName}` : 'เข้าสู่ระบบบัญชี Estra'}
          title={user ? `${user.displayName} (${user.presence})` : 'เข้าสู่ระบบ / สมัครสมาชิก'}
        >
          {user ? (
            <UserAvatar user={user} className="rail-user-avatar" showPresence />
          ) : (
            <UserCircle2 size={18} />
          )}
          <ChevronDown size={13} />
        </button>
      </div>

      <nav className="rail-primary-nav" aria-label="นำทางหลัก">
        <button
          type="button"
          className={`rail-nav-item${centerTab === 'general' ? ' active' : ''}`}
          onClick={() => onChangeTab('general')}
        >
          <Home size={16} />
          <span>หน้าหลัก</span>
        </button>
        <button
          type="button"
          className="rail-nav-item"
          onClick={onOpenLibrary}
          aria-label="ค้นหาเมือง"
        >
          <Search size={16} />
          <span>ค้นหาเมือง</span>
        </button>
        <button
          type="button"
          className={`rail-nav-item${hasLauncherUpdate ? ' has-update-badge' : ''}`}
          onClick={onOpenPatcher}
          aria-label="ศูนย์แพตช์และอัปเดต"
        >
          <PackageCheck size={16} />
          <span>แพตช์ &amp; อัปเดต</span>
        </button>
        <button
          type="button"
          className="rail-nav-item"
          onClick={onOpenLibrary}
          aria-label="ดูรายการเมืองทั้งหมด"
        >
          <Gamepad2 size={16} />
          <span>เมืองของฉัน</span>
          <span className="rail-nav-count">{servers.length}</span>
        </button>
      </nav>

      <div className="rail-section-divider" />

      <div className="rail-section">
        <span className="rail-section-label">My tools</span>
        <div className="rail-tools-list">
          <button
            type="button"
            className="rail-tool-item"
            onClick={onOpenHistory}
            aria-label="ประวัติการเปิดเกม"
          >
            <History size={15} />
            <span>ประวัติการเปิดเกม</span>
          </button>
          <button
            type="button"
            className="rail-tool-item"
            onClick={onOpenMicTest}
            aria-label="เปิดห้องทดสอบเสียง"
          >
            <Headphones size={15} />
            <span>ทดสอบไมค์ &amp; เสียง</span>
          </button>
          <button
            type="button"
            className="rail-tool-item"
            onClick={onOpenCacheModal}
            aria-label="เปิดหน้าล้างแคช"
          >
            <Trash2 size={15} />
            <span>ล้างแคช FiveM</span>
          </button>
          <button
            type="button"
            className="rail-tool-item"
            onClick={onOpenSettings}
            aria-label="การตั้งค่า"
          >
            <Settings2 size={15} />
            <span>การตั้งค่า</span>
          </button>
        </div>
      </div>

      <div className="rail-section-divider" />

      <div className="rail-section rail-favorites-section">
        <div className="rail-section-head">
          <span className="rail-section-label">
            {favoriteServers.length > 0 ? 'My favorites' : 'เมืองที่บันทึก'}
          </span>
          <button
            type="button"
            className="rail-add-fav-btn"
            onClick={onOpenNewServerModal}
            aria-label="+ NEW"
            title="เพิ่มเมืองใหม่"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="rail-servers">
          {shownFavorites.map(server => (
            <div
              key={server.id}
              className={`rail-fav-row${server.id === activeServerId ? ' selected' : ''}`}
            >
              <button
                type="button"
                className="rail-fav-select"
                aria-label={`เลือกเมือง ${server.name}`}
                aria-pressed={server.id === activeServerId}
                title={`${server.name} · ${server.ip}`}
                onClick={() => onSelectServer(server.id)}
              >
                <ServerAvatar server={server} />
                <span className="rail-fav-copy">
                  <strong>{server.name}</strong>
                  <small>
                    {server.tag || 'FiveM'}
                    {server.status === 'Online' && server.onlinePlayers != null ? ` · ${server.onlinePlayers} คน` : ''}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className={`rail-fav-star${server.favorite ? ' active' : ''}`}
                aria-label={server.favorite ? `เลิกปักหมุด ${server.name}` : `ปักหมุด ${server.name} เป็นเมืองโปรด`}
                aria-pressed={!!server.favorite}
                onClick={() => onToggleFavoriteServer(server)}
              >
                <Star size={12} fill={server.favorite ? 'currentColor' : 'none'} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rail-community-bar" aria-label="ช่องทางชุมชน Estra">
        <span className="rail-section-label">ช่องทางชุมชน</span>
        <div className="rail-community-actions">
          {COMMUNITY_CHANNELS.map(channel => {
            const url = communityLinks?.[channel.key] || '';
            return (
              <button
                key={channel.key}
                type="button"
                className={`rail-community-btn${url ? ' configured' : ''}`}
                title={url ? `${channel.thaiLabel}: ${url}` : channel.thaiLabel}
                aria-label={channel.thaiLabel}
                onClick={() => onOpenCommunityLink?.(channel, url)}
              >
                {channel.id === 'website' ? <Globe size={14} /> : channel.id === 'discord' ? <DiscordGlyph /> : <FacebookGlyph />}
                <span>{channel.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rail-bottom-meta">
        <span>ESTRA v{APP_VERSION}</span>
        <span className={`rail-social-pill${user ? ' online' : ''}`}>
          {user ? `@${user.username}` : 'Guest'}
        </span>
      </div>
    </aside>
  );
}
