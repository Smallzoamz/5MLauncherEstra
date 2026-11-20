import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, Clock, Send, SendHorizontal } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { loadCachedChat, saveCachedChat } from '../services/chatCacheService';
import { subscribeChatTyping } from '../services/socialRealtime';
import { formatOfflineDurationLabel } from '../shared/durationFormat';

function formatMessageTime(iso) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    const secs = Number(iso);
    if (Number.isFinite(secs) && secs > 1_000_000_000) {
      return new Date(secs * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }
    return '';
  }
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export default function FriendChatPanel({
  user,
  friend,
  canInvite,
  hideBackButton = false,
  unreadHint = 0,
  onBack,
  onInvite,
  onFetchHistory,
  onSendMessage,
  realtimeAccessToken,
  socialServerUrl,
  realtimeTick = 0
}) {
  const [messages, setMessages] = useState(() => loadCachedChat(user?.id, friend?.id));
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [friendTyping, setFriendTyping] = useState(false);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingApiRef = useRef({ sendTyping: () => {} });
  const typingResetTimerRef = useRef(null);

  useEffect(() => {
    setMessages(loadCachedChat(user?.id, friend?.id));
    setDraft('');
    setError('');
    setFriendTyping(false);
    inputRef.current?.focus();
  }, [user?.id, friend?.id]);

  useEffect(() => {
    if (!user?.id || !friend?.id || typeof onFetchHistory !== 'function') return undefined;
    let active = true;
    setLoading(prev => prev && loadCachedChat(user.id, friend.id).length === 0);

    void onFetchHistory(friend.id)
      .then(res => {
        if (!active) return;
        const next = saveCachedChat(user.id, friend.id, res?.messages || []);
        setMessages(next);
        setError('');
      })
      .catch(err => {
        if (active) setError(err?.message || 'โหลดข้อความไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id, friend?.id, realtimeTick, unreadHint, onFetchHistory]);

  useEffect(() => {
    if (!realtimeAccessToken || !user?.id || !friend?.id) {
      typingApiRef.current = { sendTyping: () => {} };
      return undefined;
    }

    const sub = subscribeChatTyping({
      accessToken: realtimeAccessToken,
      userId: user.id,
      friendId: friend.id,
      socialServerUrl,
      onFriendTyping: () => {
        setFriendTyping(true);
        clearTimeout(typingResetTimerRef.current);
        typingResetTimerRef.current = setTimeout(() => setFriendTyping(false), 2600);
      }
    });
    typingApiRef.current = sub;

    return () => {
      clearTimeout(typingResetTimerRef.current);
      sub.unsubscribe();
      typingApiRef.current = { sendTyping: () => {} };
    };
  }, [realtimeAccessToken, user?.id, friend?.id, socialServerUrl]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, friend?.id]);

  const handleSend = async e => {
    e?.preventDefault?.();
    const cleaned = draft.trim();
    if (!cleaned || sending || !onSendMessage) return;

    setSending(true);
    setError('');
    try {
      const res = await onSendMessage(friend.id, cleaned);
      if (res?.message) {
        setMessages(prev => saveCachedChat(user.id, friend.id, [...prev, res.message]));
      }
      setDraft('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err?.message || 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  const presenceSub = friendTyping
    ? 'กำลังพิมพ์...'
    : friend.presence === 'in-game' && friend.currentServer?.name
      ? `เล่น ${friend.currentServer.name}`
      : friend.presence === 'online'
        ? 'ออนไลน์บน Estra'
        : friend.presence === 'away'
          ? 'ไม่อยู่ชั่วคราว'
          : formatOfflineDurationLabel(friend.lastSeenAt);

  return (
    <div className="friends-chat-view">
      <div className="friends-chat-head">
        {!hideBackButton && (
          <button
            type="button"
            className="icon-button friends-chat-back"
            onClick={onBack}
            aria-label="กลับไปรายชื่อเพื่อน"
            title="กลับไปรายชื่อเพื่อน"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <UserAvatar user={friend} showPresence />
        <div className="friend-meta">
          <strong>{friend.displayName}</strong>
          <small className={friendTyping ? 'typing-label' : ''}>{presenceSub}</small>
        </div>
        {canInvite && (
          <button
            type="button"
            className="friend-invite-btn"
            onClick={onInvite}
            title={`ชวน ${friend.displayName} เล่นด้วยกัน`}
            aria-label={`ชวน ${friend.displayName} เล่นด้วยกัน`}
          >
            <Send size={12} />
          </button>
        )}
      </div>

      <div className="friends-chat-policy">
        <Clock size={12} />
        <span>เก็บเฉพาะแชทล่าสุด 50 ข้อความ (หมดอายุใน 7 วัน)</span>
      </div>

      <div className="friends-chat-messages" ref={listRef}>
        {loading && messages.length === 0 ? (
          <p className="friends-empty-note">กำลังซิงก์ข้อความ...</p>
        ) : messages.length === 0 ? (
          <p className="friends-empty-note">
            ทักทาย {friend.displayName} ได้เลย แม้เพื่อนออฟไลน์ข้อความจะรอส่งต่อให้ภายใน 7 วัน
          </p>
        ) : (
          messages.map(msg => {
            const mine = msg.senderId === user.id;
            return (
              <div key={msg.id} className={`chat-bubble-row${mine ? ' mine' : ''}`}>
                <div className={`chat-bubble${mine ? ' mine' : ''}`}>
                  <p>{msg.body}</p>
                  <div className="chat-bubble-meta">
                    <span>{formatMessageTime(msg.createdAt)}</span>
                    {mine && msg.readAt && (
                      <CheckCheck size={12} className="chat-read-icon" title="อ่านแล้ว" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <p className="friends-mini-msg error">{error}</p>}

      <form className="friends-chat-composer" onSubmit={handleSend}>
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={500}
          placeholder={`ส่งข้อความหา ${friend.displayName}...`}
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            if (e.target.value.trim()) typingApiRef.current.sendTyping();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="submit"
          className="friends-chat-send-btn"
          disabled={sending || !draft.trim()}
          aria-label="ส่งข้อความ"
          title="ส่งข้อความ (Enter)"
        >
          <SendHorizontal size={15} />
        </button>
      </form>
      {draft.length >= 380 && (
        <div className="friends-chat-charcount">{draft.length}/500</div>
      )}
    </div>
  );
}
