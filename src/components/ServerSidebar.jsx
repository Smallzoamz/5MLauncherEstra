import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Gamepad2,
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
import { APP_VERSION } from '../shared/patcherConfig';

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
  onOpenAuth
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
          <img src="/brand/estra-mark.svg" alt="Estra" />
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
            <span className="rail-user-avatar" style={{ background: user.avatarColor || '#2b6bf3' }}>
              {user.displayName.slice(0, 2).toUpperCase()}
              <span className={`presence-dot ${user.presence}`} />
            </span>
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

      <div className="rail-bottom-meta">
        <span>ESTRA v{APP_VERSION}</span>
        <span className={`rail-social-pill${user ? ' online' : ''}`}>
          {user ? `@${user.username}` : 'Guest'}
        </span>
      </div>
    </aside>
  );
}
