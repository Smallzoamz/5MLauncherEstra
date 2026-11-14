import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Info,
  LogIn,
  Play,
  Search,
  Send,
  Sparkles,
  Star,
  UserMinus,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { UserAvatar } from './UserAvatar';

function presenceLabel(friend) {
  if (friend.presence === 'in-game' && friend.currentServer?.name) {
    return `เล่น ${friend.currentServer.name}`;
  }
  if (friend.presence === 'online') return 'ออนไลน์บน Estra';
  if (friend.presence === 'away') return 'ไม่อยู่ชั่วคราว';
  return 'ออฟไลน์';
}

export default function FriendsSidebar({
  openOnMobile,
  onCloseMobile,
  social,
  activeServer,
  onOpenAuth,
  onSendFriendRequest,
  onRespondRequest,
  onToggleFavoriteFriend,
  onRemoveFriend,
  onSearchUsers,
  onSeedDemoFriends,
  onInviteFriend,
  onRespondInvite,
  onJoinFriendServer,
  onRequestConfirm
}) {
  const [tab, setTab] = useState('friends');
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [inviteNotice, setInviteNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [favOpen, setFavOpen] = useState(true);
  const [friendsOpen, setFriendsOpen] = useState(true);

  const user = social?.authenticated ? social.user : null;
  const friends = social?.friends || [];
  const incoming = social?.incomingRequests || [];
  const outgoing = social?.outgoingRequests || [];
  const incomingInvites = social?.incomingInvites || [];

  useEffect(() => {
    if (!showAddForm || !user || targetInput.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await onSearchUsers(targetInput.trim());
        if (active) setSearchResults(res.users || []);
      } catch {
        if (active) setSearchResults([]);
      }
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [showAddForm, targetInput, user, onSearchUsers]);

  const query = search.trim().toLowerCase();
  const filteredFriends = friends.filter(f =>
    !query ||
    f.displayName.toLowerCase().includes(query) ||
    f.username.toLowerCase().includes(query) ||
    (f.currentServer?.name || '').toLowerCase().includes(query)
  );
  const favoriteFriends = filteredFriends.filter(f => f.isFavorite);
  const regularFriends = filteredFriends.filter(f => !f.isFavorite);

  const handleAddSubmit = async e => {
    e.preventDefault();
    if (!targetInput.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await onSendFriendRequest(targetInput.trim());
      setFeedback({ ok: res.message || 'ส่งคำขอเป็นเพื่อนแล้ว' });
      setTargetInput('');
      setSearchResults([]);
    } catch (err) {
      setFeedback({ error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className={`friends-rail${openOnMobile ? ' mobile-open' : ''}`}
      aria-label="รายชื่อเพื่อนและสถานะออนไลน์"
    >
      <div className="friends-rail-head">
        <div className="friends-tabs" role="tablist" aria-label="หมวดหมู่เพื่อน">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'friends'}
            className={`friends-tab${tab === 'friends' ? ' active' : ''}`}
            onClick={() => setTab('friends')}
          >
            Friends
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'requests'}
            className={`friends-tab${tab === 'requests' ? ' active' : ''}`}
            onClick={() => setTab('requests')}
          >
            Requests
            {incoming.length > 0 && <span className="friends-badge-count">{incoming.length}</span>}
          </button>
        </div>

        <div className="friends-head-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => onOpenAuth('login')}
            aria-label="ข้อมูลบัญชีและสถานะออนไลน์"
            title={user ? `สถานะ: ${user.presence} · ${user.friendCode}` : 'เข้าสู่ระบบบัญชี Estra'}
          >
            <Info size={16} />
          </button>
          <button
            type="button"
            className="icon-button friends-mobile-close"
            onClick={onCloseMobile}
            aria-label="ปิดแถบเพื่อน"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!user ? (
        <div className="friends-guest-panel">
          <div className="friends-guest-icon">
            <Users size={22} />
          </div>
          <h3>เชื่อมต่อระบบเพื่อนแบบ Steam</h3>
          <p>เข้าสู่ระบบหรือสมัครบัญชี Estra เพื่อดูสถานะ Online / Offline, ปักหมุดเพื่อนโปรด และซิงก์เมืองโปรดข้ามเครื่อง</p>
          <div className="friends-guest-actions">
            <button type="button" className="btn-action-play friends-cta" onClick={() => onOpenAuth('login')}>
              <LogIn size={15} /> เข้าสู่ระบบ
            </button>
            <button type="button" className="soft-button friends-cta" onClick={() => onOpenAuth('register')}>
              <UserPlus size={15} /> สมัครสมาชิก
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="friends-search-bar">
            <label className="friends-search-input">
              <Search size={14} />
              <input
                aria-label="ค้นหาเพื่อน"
                placeholder="Search for a friend"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={`friends-add-btn${showAddForm ? ' active' : ''}`}
              onClick={() => { setShowAddForm(v => !v); setFeedback(null); }}
              aria-label="เพิ่มเพื่อน"
              title="เพิ่มเพื่อนด้วย Username หรือ Friend Code"
            >
              <UserPlus size={15} />
            </button>
          </div>

          {showAddForm && (
            <form className="friends-add-drawer" onSubmit={handleAddSubmit}>
              <div className="friends-add-row">
                <input
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  placeholder="Username หรือ ESTRA-XXXX"
                  aria-label="ชื่อผู้ใช้หรือรหัสเพื่อน"
                />
                <button type="submit" className="btn-inline-cobalt" disabled={busy || !targetInput.trim()}>
                  เพิ่ม
                </button>
              </div>
              {searchResults.length > 0 && (
                <ul className="friends-search-results">
                  {searchResults.map(candidate => (
                    <li key={candidate.id}>
                      <span className="candidate-name">
                        <strong>{candidate.displayName}</strong>
                        <small>@{candidate.username} · {candidate.friendCode}</small>
                      </span>
                      {candidate.relation === 'friend' ? (
                        <span className="candidate-pill">เพื่อนแล้ว</span>
                      ) : candidate.relation === 'pending_out' ? (
                        <span className="candidate-pill">รอตอบรับ</span>
                      ) : candidate.relation === 'pending_in' ? (
                        <button
                          type="button"
                          className="btn-inline-cobalt"
                          onClick={() => onRespondRequest(candidate.incomingRequestId, 'accept')}
                        >
                          รับเพื่อน
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-inline-cobalt"
                          onClick={async () => {
                            try {
                              const r = await onSendFriendRequest(candidate.username);
                              setFeedback({ ok: r.message || 'ส่งคำขอแล้ว' });
                            } catch (err) {
                              setFeedback({ error: err.message });
                            }
                          }}
                        >
                          ส่งคำขอ
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {feedback?.error && <p className="friends-mini-msg error">{feedback.error}</p>}
              {feedback?.ok && <p className="friends-mini-msg ok">{feedback.ok}</p>}
            </form>
          )}

          {tab === 'friends' ? (
            <div className="friends-scroll-body">
              {inviteNotice?.error && <p className="friends-mini-msg error">{inviteNotice.error}</p>}
              {inviteNotice?.ok && <p className="friends-mini-msg ok">{inviteNotice.ok}</p>}

              {incomingInvites.length > 0 && (
                <div className="friends-group">
                  <div className="friends-group-static">
                    <span>คำชวนเล่นด้วยกัน</span>
                    <span className="friends-count-pill">{incomingInvites.length}</span>
                  </div>
                  <ul className="friends-list">
                    {incomingInvites.map(inv => (
                      <li key={inv.id} className="friend-request-row friend-invite-row">
                        <UserAvatar user={inv.fromUser} fallbackInitials="FR" />
                        <div className="friend-meta">
                          <strong>{inv.fromUser?.displayName || 'เพื่อน'}</strong>
                          <small title={inv.server?.name}>ชวนเล่น {inv.server?.name}</small>
                        </div>
                        <div className="request-actions">
                          <button
                            type="button"
                            className="req-accept"
                            title={`เข้าร่วมเมือง ${inv.server?.name}`}
                            aria-label={`รับคำชวนเข้าเมือง ${inv.server?.name}`}
                            onClick={() => onRespondInvite?.(inv.id, 'accept', inv.server)}
                          >
                            <Play size={13} fill="currentColor" />
                          </button>
                          <button
                            type="button"
                            className="req-decline"
                            title="ปฏิเสธคำชวน"
                            aria-label={`ปฏิเสธคำชวนจาก ${inv.fromUser?.displayName || 'เพื่อน'}`}
                            onClick={() => onRespondInvite?.(inv.id, 'decline')}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="friends-group">
                <button
                  type="button"
                  className="friends-group-toggle"
                  onClick={() => setFavOpen(v => !v)}
                  aria-expanded={favOpen}
                >
                  <span>Favorites</span>
                  <span className="friends-group-right">
                    <span className="friends-count-pill">{favoriteFriends.length}</span>
                    <ChevronDown size={14} className={favOpen ? 'rotated' : ''} />
                  </span>
                </button>
                {favOpen && (
                  favoriteFriends.length > 0 ? (
                    <ul className="friends-list">
                      {favoriteFriends.map(friend => (
                        <FriendRow
                          key={friend.id}
                          friend={friend}
                          canInvite={!!activeServer?.ip && !friend.isDemo && friend.presence !== 'offline' && typeof onInviteFriend === 'function'}
                          activeServerName={activeServer?.name}
                          onToggleFavorite={() => onToggleFavoriteFriend(friend.id, !friend.isFavorite)}
                          onRemove={() => {
                            if (onRequestConfirm) {
                              onRequestConfirm({
                                title: 'ลบออกจากรายชื่อเพื่อน',
                                message: `ต้องการลบ "${friend.displayName}" ออกจากรายชื่อเพื่อนใช่หรือไม่?`,
                                detail: 'สามารถค้นหาหรือส่งคำขอเป็นเพื่อนใหม่ได้ในภายหลัง',
                                confirmLabel: 'ลบเพื่อน',
                                tone: 'danger',
                                onConfirm: () => onRemoveFriend(friend.id)
                              });
                            } else {
                              void onRemoveFriend(friend.id);
                            }
                          }}
                          onJoin={() => friend.currentServer && onJoinFriendServer(friend.currentServer)}
                          onInvite={async () => {
                            setInviteNotice(null);
                            try {
                              const r = await onInviteFriend(friend.id, activeServer);
                              setInviteNotice({ ok: r?.message || `ส่งคำชวนไปยัง ${friend.displayName} แล้ว` });
                            } catch (err) {
                              setInviteNotice({ error: err.message });
                            }
                          }}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="friends-empty-note">กด ★ ที่ชื่อเพื่อนเพื่อปักหมุดไว้ด้านบน</p>
                  )
                )}
              </div>

              <div className="friends-group">
                <button
                  type="button"
                  className="friends-group-toggle"
                  onClick={() => setFriendsOpen(v => !v)}
                  aria-expanded={friendsOpen}
                >
                  <span>Friends</span>
                  <span className="friends-group-right">
                    <span className="friends-count-pill">{regularFriends.length}</span>
                    <ChevronDown size={14} className={friendsOpen ? 'rotated' : ''} />
                  </span>
                </button>
                {friendsOpen && (
                  regularFriends.length > 0 ? (
                    <ul className="friends-list">
                      {regularFriends.map(friend => (
                        <FriendRow
                          key={friend.id}
                          friend={friend}
                          canInvite={!!activeServer?.ip && !friend.isDemo && friend.presence !== 'offline' && typeof onInviteFriend === 'function'}
                          activeServerName={activeServer?.name}
                          onToggleFavorite={() => onToggleFavoriteFriend(friend.id, !friend.isFavorite)}
                          onRemove={() => {
                            if (onRequestConfirm) {
                              onRequestConfirm({
                                title: 'ลบออกจากรายชื่อเพื่อน',
                                message: `ต้องการลบ "${friend.displayName}" ออกจากรายชื่อเพื่อนใช่หรือไม่?`,
                                detail: 'สามารถค้นหาหรือส่งคำขอเป็นเพื่อนใหม่ได้ในภายหลัง',
                                confirmLabel: 'ลบเพื่อน',
                                tone: 'danger',
                                onConfirm: () => onRemoveFriend(friend.id)
                              });
                            } else {
                              void onRemoveFriend(friend.id);
                            }
                          }}
                          onJoin={() => friend.currentServer && onJoinFriendServer(friend.currentServer)}
                          onInvite={async () => {
                            setInviteNotice(null);
                            try {
                              const r = await onInviteFriend(friend.id, activeServer);
                              setInviteNotice({ ok: r?.message || `ส่งคำชวนไปยัง ${friend.displayName} แล้ว` });
                            } catch (err) {
                              setInviteNotice({ error: err.message });
                            }
                          }}
                        />
                      ))}
                    </ul>
                  ) : friends.length === 0 ? (
                    <div className="friends-empty-cta">
                      <p className="friends-empty-note">ยังไม่มีเพื่อนในรายการ กด + ด้านบนเพื่อค้นหาด้วย Username หรือ Friend Code ({user.friendCode})</p>
                      <button
                        type="button"
                        className="soft-button friends-demo-btn"
                        onClick={onSeedDemoFriends}
                        title="เพิ่มรายชื่อตัวอย่างไว้ทดสอบ UI เพื่อนโปรดและสถานะ Online/Offline"
                      >
                        <Sparkles size={13} /> เพิ่มเพื่อนตัวอย่าง (Demo)
                      </button>
                    </div>
                  ) : (
                    <p className="friends-empty-note">ไม่พบเพื่อนที่ตรงกับการค้นหา</p>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="friends-scroll-body">
              <div className="friends-group">
                <div className="friends-group-static">
                  <span>คำขอที่เข้ามา</span>
                  <span className="friends-count-pill">{incoming.length}</span>
                </div>
                {incoming.length === 0 ? (
                  <p className="friends-empty-note">ไม่มีคำขอเป็นเพื่อนใหม่</p>
                ) : (
                  <ul className="friends-list">
                    {incoming.map(req => (
                      <li key={req.id} className="friend-request-row">
                        <UserAvatar user={req.user} />
                        <div className="friend-meta">
                          <strong>{req.user.displayName}</strong>
                          <small>@{req.user.username} · {req.user.friendCode}</small>
                        </div>
                        <div className="request-actions">
                          <button
                            type="button"
                            className="req-accept"
                            aria-label={`รับ ${req.user.displayName} เป็นเพื่อน`}
                            onClick={() => onRespondRequest(req.id, 'accept')}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className="req-decline"
                            aria-label={`ปฏิเสธ ${req.user.displayName}`}
                            onClick={() => onRespondRequest(req.id, 'decline')}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {outgoing.length > 0 && (
                <div className="friends-group">
                  <div className="friends-group-static">
                    <span>คำขอที่ส่งออก</span>
                    <span className="friends-count-pill">{outgoing.length}</span>
                  </div>
                  <ul className="friends-list">
                    {outgoing.map(req => (
                      <li key={req.id} className="friend-request-row">
                        <UserAvatar user={req.user} fallbackColor="#334155" />
                        <div className="friend-meta">
                          <strong>{req.user.displayName}</strong>
                          <small>รอตอบรับ…</small>
                        </div>
                        <button
                          type="button"
                          className="req-decline"
                          aria-label={`ยกเลิกคำขอ ${req.user.displayName}`}
                          onClick={() => onRespondRequest(req.id, 'cancel')}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="friends-rail-footer">
            <button type="button" className="friends-self-strip" onClick={() => onOpenAuth('login')}>
              <UserAvatar user={user} className="friend-avatar self" showPresence />
              <span className="friend-meta">
                <strong>{user.displayName}</strong>
                <small>{user.friendCode} · {user.presence}</small>
              </span>
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function FriendRow({ friend, canInvite, activeServerName, onToggleFavorite, onRemove, onJoin, onInvite }) {
  return (
    <li className={`friend-row ${friend.presence}`}>
      <UserAvatar user={friend} showPresence />
      <div className="friend-meta">
        <strong>
          <span>{friend.displayName}</span>
          {friend.isDemo && <span className="demo-tag">DEMO</span>}
        </strong>
        <small title={presenceLabel(friend)}>{presenceLabel(friend)}</small>
      </div>
      <div className="friend-row-actions">
        {friend.presence === 'in-game' && friend.currentServer?.ip && (
          <button
            type="button"
            className="friend-game-badge"
            title={`ตามเพื่อนไปยัง ${friend.currentServer.name}`}
            aria-label={`ตามเพื่อนไปยัง ${friend.currentServer.name}`}
            onClick={onJoin}
          >
            <Play size={11} fill="currentColor" />
          </button>
        )}
        {canInvite && (
          <button
            type="button"
            className="friend-invite-btn"
            title={`ชวน ${friend.displayName} เข้าเล่น ${activeServerName || 'เมืองนี้'}`}
            aria-label={`ชวน ${friend.displayName} เล่นด้วยกัน`}
            onClick={onInvite}
          >
            <Send size={12} />
          </button>
        )}
        <button
          type="button"
          className={`friend-star-btn${friend.isFavorite ? ' active' : ''}`}
          aria-label={friend.isFavorite ? `เลิกปักหมุด ${friend.displayName}` : `ปักหมุด ${friend.displayName} เป็นเพื่อนโปรด`}
          aria-pressed={!!friend.isFavorite}
          onClick={onToggleFavorite}
        >
          <Star size={13} fill={friend.isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="friend-remove-btn"
          aria-label={`ลบเพื่อน ${friend.displayName}`}
          title="ลบเพื่อน"
          onClick={onRemove}
        >
          <UserMinus size={13} />
        </button>
      </div>
    </li>
  );
}
