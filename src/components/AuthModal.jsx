import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  LogIn,
  LogOut,
  UserPlus,
  X
} from 'lucide-react';
import {
  isSupabaseGatewayUrl,
  resolveSocialServerUrl
} from '../shared/supabaseConfig';

const STATUS_OPTIONS = [
  { value: 'online', label: 'ออนไลน์ (Online)', dotClass: 'online', hint: 'แสดงสถานะออนไลน์และเมืองที่กำลังเล่นให้เพื่อนเห็น' },
  { value: 'away', label: 'ไม่อยู่ชั่วคราว (Away)', dotClass: 'away', hint: 'แจ้งเพื่อนว่าเปิดลันเชอร์ไว้แต่ไม่อยู่หน้าจอ' },
  { value: 'invisible', label: 'ซ่อนตัว (Invisible)', dotClass: 'offline', hint: 'ใช้งานได้ตามปกติ แต่เพื่อนจะเห็นคุณเป็นออฟไลน์' },
  { value: 'offline', label: 'ออฟไลน์ (Offline)', dotClass: 'offline', hint: 'ตัดสถานะออนไลน์ชั่วคราว' }
];

export default function AuthModal({
  isOpen,
  initialMode = 'login',
  onClose,
  social,
  settings,
  onLogin,
  onRegister,
  onLogout,
  onChangeStatus,
  onRequestConfirm
}) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setError('');
    setPassword('');
    setConfirmPassword('');
    setCopiedCode(false);
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const user = social?.authenticated ? social.user : null;

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'register') {
        await onRegister({ username, displayName, password });
      } else {
        await onLogin({ username, password });
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyFriendCode = async () => {
    if (!user?.friendCode) return;
    try {
      await navigator.clipboard.writeText(user.friendCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setError('คัดลอกรหัสเพื่อนไม่สำเร็จ');
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="modal-dialog auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={user ? 'บัญชี Estra และสถานะออนไลน์' : 'เข้าสู่ระบบหรือสมัครสมาชิก Estra'}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">ESTRA ACCOUNT &amp; SOCIAL</span>
            <h2>{user ? 'บัญชีและความเป็นส่วนตัว' : mode === 'register' ? 'สมัครบัญชี Estra' : 'เข้าสู่ระบบ Estra'}</h2>
          </div>
          <button className="modal-close-btn" disabled={busy} onClick={onClose} aria-label="ปิด">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {user ? (
            <>
              <div className="account-profile-card">
                <div className="account-profile-avatar" style={{ background: user.avatarColor || '#2b6bf3' }}>
                  {user.displayName.slice(0, 2).toUpperCase()}
                  <span className={`presence-dot ${user.presence}`} />
                </div>
                <div className="account-profile-meta">
                  <strong>{user.displayName}</strong>
                  <small>
                    @{user.username} · {social.mode === 'supabase' ? 'Estra Online (Supabase Realtime)' : social.mode === 'remote-social' ? 'Remote Social Server' : 'Local Social Engine'}
                  </small>
                </div>
                <button type="button" className="friend-code-chip" onClick={copyFriendCode} title="คัดลอกรหัสเพื่อน">
                  <span>{user.friendCode}</span>
                  {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>

              <div>
                <span className="field-label">สถานะออนไลน์แบบ Steam</span>
                <div className="status-choice-list">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={busy}
                      className={`status-choice-btn${user.statusPref === opt.value ? ' active' : ''}`}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          await onChangeStatus(opt.value);
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <span className={`presence-dot ${opt.dotClass}`} />
                      <span>
                        <strong>{opt.label}</strong>
                        <small>{opt.hint}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p role="alert" className="error-message">{error}</p>}

              <div className="settings-actions">
                <span className="help-text" style={{ marginRight: 'auto' }}>
                  สถานะระบบ: {isSupabaseGatewayUrl(resolveSocialServerUrl(settings?.socialServerUrl)) ? 'Estra Online Cloud' : 'โหมดในเครื่อง'}
                </span>
                <button
                  type="button"
                  className="btn-action-cache"
                  disabled={busy}
                  onClick={() => {
                    const doLogout = async () => {
                      setBusy(true);
                      try {
                        await onLogout();
                        onClose();
                      } finally {
                        setBusy(false);
                      }
                    };
                    if (onRequestConfirm) {
                      onRequestConfirm({
                        title: 'ออกจากระบบ Estra Account',
                        message: `ต้องการออกจากระบบบัญชี @${user.username} ใช่หรือไม่?`,
                        confirmLabel: 'ออกจากระบบ',
                        tone: 'danger',
                        onConfirm: doLogout
                      });
                    } else {
                      void doLogout();
                    }
                  }}
                >
                  <LogOut size={15} /> ออกจากระบบ
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-mode-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  className={`filter-tab${mode === 'login' ? ' active' : ''}`}
                  onClick={() => { setMode('login'); setError(''); }}
                >
                  <LogIn size={14} /> เข้าสู่ระบบ
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  className={`filter-tab${mode === 'register' ? ' active' : ''}`}
                  onClick={() => { setMode('register'); setError(''); }}
                >
                  <UserPlus size={14} /> สมัครสมาชิก
                </button>
              </div>

              <form className="auth-form" onSubmit={handleSubmit}>
                <div>
                  <label className="field-label" htmlFor="auth-username">ชื่อผู้ใช้ (Username)</label>
                  <div className="input-container">
                    <input
                      id="auth-username"
                      autoFocus
                      required
                      minLength={3}
                      maxLength={24}
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="เช่น sora_rp (a-z, 0-9, _)"
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="field-label" htmlFor="auth-displayname">ชื่อที่แสดงให้เพื่อนเห็น</label>
                    <div className="input-container">
                      <input
                        id="auth-displayname"
                        maxLength={40}
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="เช่น Sora Kitagawa"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="field-label" htmlFor="auth-password">รหัสผ่าน</label>
                  <div className="input-container">
                    <input
                      id="auth-password"
                      type="password"
                      required
                      minLength={6}
                      maxLength={128}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="อย่างน้อย 6 ตัวอักษร"
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="field-label" htmlFor="auth-confirm-password">ยืนยันรหัสผ่าน</label>
                    <div className="input-container">
                      <input
                        id="auth-confirm-password"
                        type="password"
                        required
                        minLength={6}
                        maxLength={128}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="กรอกรหัสผ่านอีกครั้ง"
                      />
                    </div>
                  </div>
                )}

                {error && <p role="alert" className="error-message">{error}</p>}

                <button type="submit" className="btn-action-play auth-submit-btn" disabled={busy}>
                  {busy ? 'กำลังดำเนินการ…' : mode === 'register' ? 'สร้างบัญชี Estra' : 'เข้าสู่ระบบ'}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
