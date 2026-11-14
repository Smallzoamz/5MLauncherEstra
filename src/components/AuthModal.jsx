import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Copy,
  ImageOff,
  KeyRound,
  Link2,
  LogOut,
  Save,
  X
} from 'lucide-react';
import {
  isSupabaseGatewayUrl,
  resolveSocialServerUrl
} from '../shared/supabaseConfig';
import {
  AVATAR_PALETTE,
  resizeAvatarImageFileToDataUrl,
  validateAvatarUrl
} from '../shared/profileAvatar';
import { UserAvatar } from './UserAvatar';

const STATUS_OPTIONS = [
  { value: 'online', label: 'ออนไลน์ (Online)', dotClass: 'online', hint: 'แสดงสถานะออนไลน์และเมืองที่กำลังเล่นให้เพื่อนเห็น' },
  { value: 'away', label: 'ไม่อยู่ชั่วคราว (Away)', dotClass: 'away', hint: 'แจ้งเพื่อนว่าเปิดลันเชอร์ไว้แต่ไม่อยู่หน้าจอ' },
  { value: 'invisible', label: 'ซ่อนตัว (Invisible)', dotClass: 'offline', hint: 'ใช้งานได้ตามปกติ แต่เพื่อนจะเห็นคุณเป็นออฟไลน์' },
  { value: 'offline', label: 'ออฟไลน์ (Offline)', dotClass: 'offline', hint: 'ตัดสถานะออนไลน์ชั่วคราว' }
];

export default function AuthModal({
  isOpen,
  onClose,
  social,
  settings,
  onLogout,
  onChangeStatus,
  onUpdateProfile,
  onChangePassword,
  onRequestConfirm
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const [editDisplayName, setEditDisplayName] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editAvatarColor, setEditAvatarColor] = useState('#2b6bf3');
  const [showAvatarUrlInput, setShowAvatarUrlInput] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const fileInputRef = useRef(null);

  const user = social?.authenticated ? social.user : null;

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setCopiedCode(false);
    setProfileMessage('');
    setPasswordMessage('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowAvatarUrlInput(false);
    setShowPasswordForm(Boolean(user?.mustChangePassword));
  }, [isOpen, user?.mustChangePassword]);

  useEffect(() => {
    if (!isOpen || !user) return;
    setEditDisplayName(user.displayName || '');
    setEditAvatarUrl(user.avatarUrl || '');
    setEditAvatarColor(user.avatarColor || '#2b6bf3');
  }, [isOpen, user?.id, user?.displayName, user?.avatarUrl, user?.avatarColor]);

  if (!isOpen || !user) return null;

  const handleAvatarFileChange = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setProfileMessage('');
    setBusy(true);
    try {
      const dataUrl = await resizeAvatarImageFileToDataUrl(file);
      setEditAvatarUrl(dataUrl);
      setProfileMessage('เตรียมรูปโปรไฟล์ใหม่แล้ว กด "บันทึกโปรไฟล์" เพื่อยืนยัน');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async e => {
    e.preventDefault();
    if (!onUpdateProfile) return;
    setError('');
    setProfileMessage('');
    const cleanName = editDisplayName.trim();
    if (!cleanName || cleanName.length > 40) {
      setError('ชื่อที่แสดงต้องยาว 1-40 ตัวอักษร');
      return;
    }
    const checkedAvatar = validateAvatarUrl(editAvatarUrl);
    if (!checkedAvatar.valid) {
      setError(checkedAvatar.error);
      return;
    }
    setBusy(true);
    try {
      const res = await onUpdateProfile({
        displayName: cleanName,
        avatarUrl: checkedAvatar.value,
        avatarColor: editAvatarColor
      });
      setProfileMessage(res?.message || 'บันทึกข้อมูลโปรไฟล์แล้ว');
      setShowAvatarUrlInput(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSavePassword = async e => {
    e.preventDefault();
    if (!onChangePassword) return;
    setError('');
    setPasswordMessage('');
    if (!currentPassword) {
      setError('กรุณากรอกรหัสผ่านปัจจุบัน (หรือรหัสผ่านชั่วคราวจาก Discord)');
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 128) {
      setError('รหัสผ่านใหม่ต้องมี 6-128 ตัวอักษร');
      return;
    }
    if (newPassword === currentPassword) {
      setError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      const res = await onChangePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(res?.message || 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
      setShowPasswordForm(false);
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
        aria-label="บัญชี Estra และสถานะออนไลน์"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">ESTRA ACCOUNT &amp; PROFILE</span>
            <h2>บัญชีและความเป็นส่วนตัว</h2>
          </div>
          <button className="modal-close-btn" disabled={busy} onClick={onClose} aria-label="ปิด">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {user.mustChangePassword && (
            <div role="alert" className="password-warning-banner">
              <AlertTriangle size={18} />
              <div>
                <strong>กรุณาเปลี่ยนรหัสผ่านหลัง Login ครั้งแรก</strong>
                <p>บัญชีนี้ถูกสร้างด้วยรหัสผ่านชั่วคราวจาก Discord เพื่อความปลอดภัย โปรดตั้งรหัสผ่านใหม่ของคุณทันที</p>
              </div>
            </div>
          )}

          <div className="account-profile-card">
            <UserAvatar
              user={{
                ...user,
                displayName: editDisplayName || user.displayName,
                avatarUrl: editAvatarUrl,
                avatarColor: editAvatarColor
              }}
              className="account-profile-avatar"
              showPresence
            />
            <div className="account-profile-meta">
              <strong>{editDisplayName.trim() || user.displayName}</strong>
              <small>
                @{user.username} · {social.mode === 'supabase' ? 'Estra Online (Supabase Realtime)' : social.mode === 'remote-social' ? 'Remote Social Server' : 'Local Social Engine'}
              </small>
            </div>
            <button type="button" className="friend-code-chip" onClick={copyFriendCode} title="คัดลอกรหัสเพื่อน">
              <span>{user.friendCode}</span>
              {copiedCode ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>

          <form className="profile-editor-card" onSubmit={handleSaveProfile}>
            <div className="profile-avatar-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={handleAvatarFileChange}
              />
              <button
                type="button"
                className="soft-button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={14} /> เลือกรูปโปรไฟล์
              </button>
              <button
                type="button"
                className="soft-button"
                disabled={busy}
                onClick={() => setShowAvatarUrlInput(v => !v)}
              >
                <Link2 size={14} /> ใส่ลิงก์ HTTPS
              </button>
              {editAvatarUrl && (
                <button
                  type="button"
                  className="soft-button danger-text-btn"
                  disabled={busy}
                  onClick={() => {
                    setEditAvatarUrl('');
                    setProfileMessage('นำรูปออกแล้ว กด "บันทึกโปรไฟล์" เพื่ออัปเดต');
                  }}
                >
                  <ImageOff size={14} /> ลบรูป
                </button>
              )}
            </div>

            {showAvatarUrlInput && (
              <div className="profile-url-field">
                <label htmlFor="profile-avatar-url" className="field-label">ลิงก์รูปภาพ (https://)</label>
                <div className="input-container">
                  <input
                    id="profile-avatar-url"
                    type="url"
                    disabled={busy}
                    value={editAvatarUrl.startsWith('data:') ? '' : editAvatarUrl}
                    onChange={e => setEditAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.png"
                  />
                </div>
              </div>
            )}

            <div className="profile-editor-row">
              <div className="profile-name-field">
                <label htmlFor="profile-display-name" className="field-label">ชื่อที่แสดง</label>
                <div className="input-container">
                  <input
                    id="profile-display-name"
                    maxLength={40}
                    disabled={busy}
                    value={editDisplayName}
                    onChange={e => setEditDisplayName(e.target.value)}
                    placeholder="Display Name"
                  />
                </div>
              </div>
              <div className="profile-palette-field">
                <span className="field-label">สีพื้นหลังโปรไฟล์</span>
                <div className="avatar-palette-swatches" role="radiogroup" aria-label="สีโปรไฟล์">
                  {AVATAR_PALETTE.map(hex => (
                    <button
                      key={hex}
                      type="button"
                      disabled={busy}
                      className={`avatar-swatch-btn${editAvatarColor === hex ? ' active' : ''}`}
                      style={{ background: hex }}
                      aria-label={`เลือกสี ${hex}`}
                      aria-checked={editAvatarColor === hex}
                      role="radio"
                      onClick={() => setEditAvatarColor(hex)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="profile-save-bar">
              <small className="help-text">รองรับ PNG, JPG, WebP (ปรับขนาดเป็น 128×128 อัตโนมัติ)</small>
              <button type="submit" className="btn-inline-cobalt profile-save-btn" disabled={busy}>
                <Save size={13} /> บันทึกโปรไฟล์
              </button>
            </div>
            {profileMessage && <p role="status" className="notice">{profileMessage}</p>}
          </form>

          <form className="profile-editor-card" onSubmit={handleSavePassword}>
            <div className="password-toggle-bar">
              <div>
                <span className="field-label" style={{ marginBottom: 2 }}>ความปลอดภัยบัญชี &amp; รหัสผ่าน</span>
                <small className="help-text">
                  {user.mustChangePassword ? 'ต้องเปลี่ยนรหัสผ่านชั่วคราวเป็นรหัสผ่านส่วนตัวของคุณ' : 'เปลี่ยนรหัสผ่านเข้าสู่ระบบ Estra Launcher'}
                </small>
              </div>
              {!user.mustChangePassword && (
                <button
                  type="button"
                  className="soft-button"
                  disabled={busy}
                  onClick={() => setShowPasswordForm(v => !v)}
                >
                  <KeyRound size={13} /> {showPasswordForm ? 'ซ่อนฟอร์ม' : 'เปลี่ยนรหัสผ่าน'}
                </button>
              )}
            </div>

            {(showPasswordForm || user.mustChangePassword) && (
              <div className="auth-form">
                <div className="field-group">
                  <label htmlFor="auth-current-password" className="field-label">
                    {user.mustChangePassword ? 'รหัสผ่านชั่วคราวจาก Discord' : 'รหัสผ่านปัจจุบัน'}
                  </label>
                  <input
                    id="auth-current-password"
                    type="password"
                    value={currentPassword}
                    disabled={busy}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="กรอกรหัสผ่านเดิม..."
                    autoComplete="current-password"
                  />
                </div>
                <div className="profile-password-grid">
                  <div className="field-group profile-name-field">
                    <label htmlFor="auth-new-password" className="field-label">รหัสผ่านใหม่ (6+ ตัวอักษร)</label>
                    <input
                      id="auth-new-password"
                      type="password"
                      value={newPassword}
                      disabled={busy}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="ตั้งรหัสผ่านใหม่..."
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="field-group profile-name-field">
                    <label htmlFor="auth-confirm-password" className="field-label">ยืนยันรหัสผ่านใหม่</label>
                    <input
                      id="auth-confirm-password"
                      type="password"
                      value={confirmPassword}
                      disabled={busy}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง..."
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <div className="profile-save-bar">
                  <small className="help-text">ระบบจะอัปเดตฐานข้อมูลและคงสถานะ Login ให้ทันที</small>
                  <button type="submit" className="btn-inline-cobalt profile-save-btn" disabled={busy}>
                    <KeyRound size={13} /> บันทึกรหัสผ่านใหม่
                  </button>
                </div>
              </div>
            )}
            {passwordMessage && <p role="status" className="notice">{passwordMessage}</p>}
          </form>

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
                  } finally {
                    setBusy(false);
                  }
                };
                if (onRequestConfirm) {
                  onRequestConfirm({
                    title: 'ออกจากระบบ Estra Account',
                    message: `ต้องการออกจากระบบบัญชี @${user.username} และกลับไปหน้าเข้าสู่ระบบใช่หรือไม่?`,
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
        </div>
      </section>
    </div>
  );
}
