import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  MessageCircle,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Search,
  X
} from 'lucide-react';
import FriendChatPanel from './FriendChatPanel';
import { UserAvatar } from './UserAvatar';
import { getSettings } from '../services/storageService';
import {
  fetchChatHistory,
  fetchRealtimeToken,
  fetchSocialState,
  markChatRead,
  sendChatMessage,
  sendGameInvite
} from '../services/socialService';
import { subscribeSocialRealtime } from '../services/socialRealtime';
import { resolveSocialServerUrl } from '../shared/supabaseConfig';
import { formatOfflineDurationLabel } from '../shared/durationFormat';

function friendStatusText(friend, nowMs) {
  if (friend.presence === 'in-game' && friend.currentServer?.name) {
    return `เล่น ${friend.currentServer.name}`;
  }
  if (friend.presence === 'online') return 'ออนไลน์';
  if (friend.presence === 'away') return 'ไม่อยู่ชั่วคราว';
  return formatOfflineDurationLabel(friend.lastSeenAt, nowMs);
}

export default function FriendChatWindowApp() {
  const [settings] = useState(() => getSettings());
  const [socialServerUrlOverride, setSocialServerUrlOverride] = useState('');
  const effectiveSocialUrl = socialServerUrlOverride || settings.socialServerUrl;

  const [social, setSocial] = useState({
    loading: true,
    authenticated: false,
    user: null,
    friends: [],
    unreadMessages: {}
  });
  const [activeServer, setActiveServer] = useState(null);
  const [openTabIds, setOpenTabIds] = useState([]);
  const [activeFriendId, setActiveFriendId] = useState('');
  const [realtimeAccessToken, setRealtimeAccessToken] = useState('');
  const [chatRealtimeTick, setChatRealtimeTick] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const activeFriendIdRef = useRef(activeFriendId);
  activeFriendIdRef.current = activeFriendId;

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshSocial = useCallback(async (urlOverride = null) => {
    const targetUrl = urlOverride || effectiveSocialUrl;
    try {
      const state = await fetchSocialState(targetUrl);
      setSocial({
        loading: false,
        authenticated: Boolean(state?.authenticated),
        user: state?.user || null,
        friends: Array.isArray(state?.friends) ? state.friends : [],
        unreadMessages: state?.unreadMessages || {}
      });
    } catch {
      setSocial(prev => ({ ...prev, loading: false }));
    }
  }, [effectiveSocialUrl]);

  const openFriendTab = useCallback(payload => {
    const fid = String(payload?.friendId || '').trim();
    if (payload?.activeServer) {
      setActiveServer(payload.activeServer);
    }
    if (payload?.socialServerUrl) {
      setSocialServerUrlOverride(payload.socialServerUrl);
    }
    if (fid) {
      setOpenTabIds(prev => (prev.includes(fid) ? prev : [...prev, fid]));
      setActiveFriendId(fid);
    }
    void refreshSocial(payload?.socialServerUrl || null);
  }, [refreshSocial]);

  // Initial load + drain pending friend open request + subscribe to future open requests
  useEffect(() => {
    let active = true;
    void refreshSocial();

    if (window.estraWindow?.drainFriendChatOpen) {
      void window.estraWindow
        .drainFriendChatOpen()
        .then(pending => {
          if (active && pending) openFriendTab(pending);
        })
        .catch(() => {});
    }

    const off = window.estraWindow?.onFriendChatOpen?.(payload => {
      if (active && payload) openFriendTab(payload);
    });

    return () => {
      active = false;
      off?.();
    };
  }, [openFriendTab, refreshSocial]);

  // Fetch Realtime JWT for live DMs & typing indicators
  useEffect(() => {
    if (!social.authenticated || !social.user?.id) {
      setRealtimeAccessToken('');
      return undefined;
    }
    let active = true;
    const loadToken = () => {
      void fetchRealtimeToken(effectiveSocialUrl)
        .then(res => {
          if (active && res?.accessToken) setRealtimeAccessToken(res.accessToken);
        })
        .catch(() => {});
    };
    loadToken();
    const timer = window.setInterval(loadToken, 25 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [social.authenticated, social.user?.id, effectiveSocialUrl]);

  // Subscribe to Supabase Realtime for instant messages & presence updates
  useEffect(() => {
    if (!social.authenticated || !social.user?.id || !realtimeAccessToken) return undefined;
    return subscribeSocialRealtime({
      accessToken: realtimeAccessToken,
      userId: social.user.id,
      socialServerUrl: resolveSocialServerUrl(effectiveSocialUrl),
      onChange: () => {
        void refreshSocial();
      },
      onDirectMessage: () => {
        setChatRealtimeTick(t => t + 1);
        void refreshSocial();
      }
    });
  }, [social.authenticated, social.user?.id, realtimeAccessToken, effectiveSocialUrl, refreshSocial]);

  // Periodic fallback refresh every 20s in case Realtime drops
  useEffect(() => {
    if (!social.authenticated) return undefined;
    const timer = window.setInterval(() => {
      void refreshSocial();
      if (activeFriendIdRef.current) setChatRealtimeTick(t => t + 1);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [social.authenticated, refreshSocial]);

  const friendsById = useMemo(() => {
    const map = new Map();
    for (const f of social.friends || []) {
      if (f?.id) map.set(f.id, f);
    }
    return map;
  }, [social.friends]);

  // Keep open tabs synced with existing friends
  const validTabFriends = useMemo(
    () => openTabIds.map(id => friendsById.get(id)).filter(Boolean),
    [openTabIds, friendsById]
  );

  const activeFriend = friendsById.get(activeFriendId) || validTabFriends[0] || null;

  useEffect(() => {
    if (activeFriend && activeFriend.id !== activeFriendId) {
      setActiveFriendId(activeFriend.id);
    }
  }, [activeFriend, activeFriendId]);

  const handleCloseTab = (friendId, e) => {
    e?.stopPropagation?.();
    setOpenTabIds(prev => {
      const next = prev.filter(id => id !== friendId);
      if (activeFriendId === friendId) {
        setActiveFriendId(next[next.length - 1] || '');
      }
      return next;
    });
  };

  const handleSelectFriend = friendId => {
    if (!friendId) return;
    setOpenTabIds(prev => (prev.includes(friendId) ? prev : [...prev, friendId]));
    setActiveFriendId(friendId);
    setInviteStatus(null);
  };

  const handleFetchHistory = useCallback(async friendId => {
    const res = await fetchChatHistory(friendId, effectiveSocialUrl);
    if (res?.unreadMessages) {
      setSocial(prev => ({ ...prev, unreadMessages: res.unreadMessages }));
      void window.estraWindow?.notifyFriendChatSync?.().catch(() => {});
    }
    return res;
  }, [effectiveSocialUrl]);

  const handleSendMessage = useCallback(async (friendId, body) => {
    const res = await sendChatMessage(friendId, body, effectiveSocialUrl);
    if (res?.unreadMessages) {
      setSocial(prev => ({ ...prev, unreadMessages: res.unreadMessages }));
    }
    void markChatRead(friendId, effectiveSocialUrl).catch(() => {});
    void window.estraWindow?.notifyFriendChatSync?.().catch(() => {});
    return res;
  }, [effectiveSocialUrl]);

  const handleInviteActiveFriend = async () => {
    if (!activeFriend || !activeServer?.ip) return;
    setInviteStatus(null);
    try {
      const res = await sendGameInvite(
        activeFriend.id,
        { id: activeServer.id, name: activeServer.name, ip: activeServer.ip },
        effectiveSocialUrl
      );
      setInviteStatus({ ok: res?.message || `ส่งคำชวนเข้าเมือง ${activeServer.name} แล้ว` });
      window.setTimeout(() => setInviteStatus(null), 3500);
    } catch (err) {
      setInviteStatus({ error: err?.message || 'ส่งคำชวนไม่สำเร็จ' });
    }
  };

  const handleTogglePin = async () => {
    const next = !pinned;
    try {
      const applied = await window.estraWindow?.setFriendChatAlwaysOnTop?.(next);
      setPinned(Boolean(applied));
    } catch {}
  };

  const query = search.trim().toLowerCase();
  const filteredFriends = (social.friends || [])
    .filter(f => !f.isDemo)
    .filter(
      f =>
        !query ||
        (f.displayName || '').toLowerCase().includes(query) ||
        (f.username || '').toLowerCase().includes(query)
    )
    .sort((a, b) => {
      const score = p => (p === 'in-game' ? 0 : p === 'online' ? 1 : p === 'away' ? 2 : 3);
      const unreadDiff = Number(social.unreadMessages?.[b.id] || 0) - Number(social.unreadMessages?.[a.id] || 0);
      if (unreadDiff !== 0) return unreadDiff;
      const favDiff = Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite));
      if (favDiff !== 0) return favDiff;
      return score(a.presence) - score(b.presence);
    });

  return (
    <div className="steam-chat-window">
      <header className="steam-chat-titlebar" data-tauri-drag-region>
        <div className="steam-chat-brand" data-tauri-drag-region>
          <button
            type="button"
            className="steam-chat-ctrl-btn"
            title={sidebarOpen ? 'ซ่อนรายชื่อเพื่อน' : 'แสดงรายชื่อเพื่อน'}
            aria-label={sidebarOpen ? 'ซ่อนรายชื่อเพื่อน' : 'แสดงรายชื่อเพื่อน'}
            onClick={() => setSidebarOpen(v => !v)}
          >
            {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
          <span className="steam-chat-brand-label" data-tauri-drag-region>
            <MessageCircle size={13} /> ESTRA CHAT
          </span>
        </div>

        <div className="steam-chat-tabs" role="tablist" aria-label="แท็บแชทเพื่อน">
          {validTabFriends.map(friend => {
            const isActive = activeFriend?.id === friend.id;
            const unread = Number(social.unreadMessages?.[friend.id] || 0);
            return (
              <div
                key={friend.id}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                className={`steam-chat-tab${isActive ? ' active' : ''}${unread > 0 && !isActive ? ' has-unread' : ''}`}
                onClick={() => handleSelectFriend(friend.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectFriend(friend.id);
                  }
                }}
              >
                <UserAvatar user={friend} className="steam-tab-avatar" showPresence />
                <span className="steam-chat-tab-name">{friend.displayName}</span>
                {unread > 0 && !isActive && (
                  <span className="steam-chat-tab-badge">{unread > 9 ? '9+' : unread}</span>
                )}
                <button
                  type="button"
                  className="steam-chat-tab-close"
                  aria-label={`ปิดแท็บ ${friend.displayName}`}
                  onClick={e => handleCloseTab(friend.id, e)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="steam-chat-win-controls">
          <button
            type="button"
            className={`steam-chat-ctrl-btn${pinned ? ' is-pinned' : ''}`}
            title={pinned ? 'เลิกปักหมุดหน้าต่างไว้บนสุด' : 'ปักหมุดหน้าต่างแชทไว้บนสุด (Always on Top)'}
            aria-label="ปักหมุดหน้าต่างแชทไว้บนสุด"
            aria-pressed={pinned}
            onClick={() => void handleTogglePin()}
          >
            {pinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button
            type="button"
            className="steam-chat-ctrl-btn"
            title="ย่อหน้าต่าง"
            aria-label="ย่อหน้าต่างแชท"
            onClick={() => void window.estraWindow?.minimizeFriendChatWindow?.()}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="steam-chat-ctrl-btn"
            title="ขยาย/ย่อขนาด"
            aria-label="ขยายหรือย่อขนาดหน้าต่างแชท"
            onClick={() => void window.estraWindow?.toggleMaximizeFriendChatWindow?.()}
          >
            <Maximize2 size={13} />
          </button>
          <button
            type="button"
            className="steam-chat-ctrl-btn is-close"
            title="ปิดหน้าต่างแชท"
            aria-label="ปิดหน้าต่างแชท"
            onClick={() => void window.estraWindow?.closeFriendChatWindow?.()}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="steam-chat-body">
        {sidebarOpen && (
          <aside className="steam-chat-rail" aria-label="รายชื่อเพื่อนสำหรับแชท">
            <div className="steam-chat-search">
              <Search size={13} />
              <input
                type="text"
                placeholder="ค้นหาเพื่อน..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="steam-chat-rail-list">
              {filteredFriends.length === 0 ? (
                <p className="friends-empty-note">ไม่พบรายชื่อเพื่อน</p>
              ) : (
                filteredFriends.map(friend => {
                  const isActive = activeFriend?.id === friend.id;
                  const unread = Number(social.unreadMessages?.[friend.id] || 0);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className={`steam-chat-friend-item${isActive ? ' active' : ''}`}
                      onClick={() => handleSelectFriend(friend.id)}
                    >
                      <UserAvatar user={friend} showPresence />
                      <div className="steam-chat-friend-meta">
                        <strong>{friend.displayName}</strong>
                        <small>{friendStatusText(friend, nowTick)}</small>
                      </div>
                      {unread > 0 && !isActive && (
                        <span className="steam-chat-tab-badge">{unread > 9 ? '9+' : unread}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        )}

        <main className="steam-chat-stage">
          {inviteStatus && (
            <div className={`steam-chat-inline-notice${inviteStatus.error ? ' error' : ''}`}>
              {inviteStatus.error || inviteStatus.ok}
            </div>
          )}

          {social.loading ? (
            <div className="steam-chat-empty">
              <MessageCircle size={28} />
              <p>กำลังเชื่อมต่อระบบแชท...</p>
            </div>
          ) : !social.authenticated || !social.user ? (
            <div className="steam-chat-empty">
              <MessageCircle size={28} />
              <strong>กรุณาเข้าสู่ระบบในหน้าหลัก Estra Launcher ก่อนใช้งานแชท</strong>
            </div>
          ) : !activeFriend ? (
            <div className="steam-chat-empty">
              <MessageCircle size={30} />
              <strong>เลือกเพื่อนเพื่อเริ่มแชท</strong>
              <p>คลิกชื่อเพื่อนจากแถบด้านซ้าย หรือกดไอคอนแชทจากหน้าหลักเพื่อเปิดแท็บใหม่</p>
            </div>
          ) : (
            <FriendChatPanel
              key={activeFriend.id}
              user={social.user}
              friend={activeFriend}
              hideBackButton
              canInvite={Boolean(activeServer?.ip) && activeFriend.presence !== 'offline'}
              unreadHint={Number(social.unreadMessages?.[activeFriend.id] || 0)}
              onInvite={handleInviteActiveFriend}
              onFetchHistory={handleFetchHistory}
              onSendMessage={handleSendMessage}
              realtimeAccessToken={realtimeAccessToken}
              socialServerUrl={resolveSocialServerUrl(effectiveSocialUrl)}
              realtimeTick={chatRealtimeTick}
            />
          )}
        </main>
      </div>
    </div>
  );
}
