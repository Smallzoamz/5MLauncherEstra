import React, { useState } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  LogIn,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  Users
} from 'lucide-react';
import WindowMenu from './WindowMenu';
import { APP_VERSION } from '../shared/patcherConfig';
import { COMMUNITY_CHANNELS } from '../shared/communityLinks';
import { isSupabaseGatewayUrl, resolveSocialServerUrl } from '../shared/supabaseConfig';

function DiscordGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0Z" />
    </svg>
  );
}

export default function AuthScreen({
  social,
  settings,
  communityLinks,
  onOpenCommunityLink,
  onOpenSplash,
  onLogin,
  onRegister
}) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isCloud = isSupabaseGatewayUrl(resolveSocialServerUrl(settings?.socialServerUrl));

  const switchMode = nextMode => {
    if (busy || mode === nextMode) return;
    setMode(nextMode);
    setError('');
    setConfirmPassword('');
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (busy) return;
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
    } catch (err) {
      setError(err?.message || 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-gate-screen" aria-label="หน้าเข้าสู่ระบบหรือสมัครสมาชิก Estra">
      <div className="auth-gate-backdrop" aria-hidden="true" />

      <div className="prelaunch-topbar header-wrap" data-tauri-drag-region>
        <div className="prelaunch-brand" data-tauri-drag-region>
          <span className="prelaunch-badge">ESTRA · v{APP_VERSION}</span>
          <span className="auth-gate-flow-crumb" aria-label="ขั้นตอนการใช้งาน">
            Splash <span>›</span> <strong>เข้าสู่ระบบ / สมัครสมาชิก</strong> <span>›</span> Launcher
          </span>
        </div>
        <div className="prelaunch-top-actions">
          <button type="button" className="prelaunch-link-btn" disabled={busy} onClick={onOpenSplash}>
            <ArrowLeft size={14} /> หน้า Splash &amp; Patcher
          </button>
          <WindowMenu />
        </div>
      </div>

      <div className="auth-gate-stage">
        <div className="auth-gate-shell">
          <div className="auth-gate-hero">
            <div className="auth-gate-brand-lockup">
              <img src="/brand/estra-mark.png" alt="Estra Launcher" className="auth-gate-mark" />
              <div>
                <span className="eyebrow">ESTRA ACCOUNT ACCESS</span>
                <span className="auth-gate-mode-pill">
                  {isCloud ? 'Estra Online Cloud' : 'Local Social Engine'}
                </span>
              </div>
            </div>

            <h1>{mode === 'register' ? 'สร้างบัญชี Estra ใหม่' : 'เข้าสู่ระบบก่อนเปิด Launcher'}</h1>
            <p className="auth-gate-lead">
              เชื่อมต่อโปรไฟล์ รูปภาพ เมืองโปรด และระบบเพื่อนแบบเรียลไทม์ให้พร้อมใช้งานทันทีเมื่อเข้าสู่หน้าลันเชอร์หลัก
            </p>

            <ul className="auth-gate-highlights">
              <li>
                <span className="auth-gate-highlight-icon"><Users size={15} /></span>
                <span>ดูสถานะเพื่อนออนไลน์ ปักหมุดเพื่อนโปรด และส่งคำชวนเข้าเมืองได้ทันที</span>
              </li>
              <li>
                <span className="auth-gate-highlight-icon"><Sparkles size={15} /></span>
                <span>ตั้งค่ารูปโปรไฟล์ สีประจำตัว และ Friend Code ที่ซิงก์กับทุกการเล่น</span>
              </li>
              <li>
                <span className="auth-gate-highlight-icon"><ShieldCheck size={15} /></span>
                <span>ตรวจ Game Build, Pure Mode, ล้างแคช และทดสอบไมค์ครบจบก่อนเข้า FiveM</span>
              </li>
            </ul>

            <div className="auth-gate-community" aria-label="ช่องทางชุมชน Estra">
              <span className="auth-gate-community-label">ช่องทางทางการ Estra</span>
              <div className="auth-gate-community-pills">
                {COMMUNITY_CHANNELS.map(channel => {
                  const url = communityLinks?.[channel.key] || '';
                  return (
                    <button
                      key={channel.key}
                      type="button"
                      className="auth-gate-community-btn"
                      onClick={() => onOpenCommunityLink?.(channel, url)}
                      title={url ? `${channel.thaiLabel}: ${url}` : channel.thaiLabel}
                    >
                      {channel.id === 'website' ? <Globe size={13} /> : channel.id === 'discord' ? <DiscordGlyph /> : <FacebookGlyph />}
                      <span>{channel.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="auth-gate-card">
            {social?.loading ? (
              <div className="auth-gate-checking" role="status" aria-live="polite">
                <Loader2 size={28} className="spinning" />
                <strong>กำลังตรวจสอบเซสชันบัญชีเดิม…</strong>
                <small>หากเคยเข้าสู่ระบบไว้ ระบบจะพาเข้าสู่หน้า Launcher ให้อัตโนมัติ</small>
              </div>
            ) : (
              <>
                <div className="auth-gate-card-head">
                  <h2>{mode === 'register' ? 'สมัครสมาชิกบัญชี Estra' : 'ลงชื่อเข้าใช้บัญชี Estra'}</h2>
                  <p>
                    {mode === 'register'
                      ? 'ตั้ง Username และรหัสผ่านเพื่อสร้างบัญชีใหม่แล้วเข้าสู่หน้าลันเชอร์'
                      : 'กรอกชื่อผู้ใช้และรหัสผ่านของคุณเพื่อเข้าสู่หน้าลันเชอร์'}
                  </p>
                </div>

                <div className="auth-mode-tabs" role="tablist" aria-label="เลือกโหมดบัญชี">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'login'}
                    className={`filter-tab${mode === 'login' ? ' active' : ''}`}
                    onClick={() => switchMode('login')}
                  >
                    <LogIn size={14} /> เข้าสู่ระบบ
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'register'}
                    className={`filter-tab${mode === 'register' ? ' active' : ''}`}
                    onClick={() => switchMode('register')}
                  >
                    <UserPlus size={14} /> สมัครสมาชิก
                  </button>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                  <div>
                    <label className="field-label" htmlFor="auth-gate-username">ชื่อผู้ใช้ (Username)</label>
                    <div className="input-container">
                      <User size={15} className="auth-input-icon" aria-hidden="true" />
                      <input
                        id="auth-gate-username"
                        autoFocus
                        autoComplete="username"
                        required
                        minLength={3}
                        maxLength={24}
                        disabled={busy}
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="เช่น sora_rp (a-z, 0-9, _)"
                      />
                    </div>
                  </div>

                  {mode === 'register' && (
                    <div>
                      <label className="field-label" htmlFor="auth-gate-displayname">ชื่อที่แสดงให้เพื่อนเห็น</label>
                      <div className="input-container">
                        <Sparkles size={15} className="auth-input-icon" aria-hidden="true" />
                        <input
                          id="auth-gate-displayname"
                          maxLength={40}
                          disabled={busy}
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          placeholder="เช่น Sora Kitagawa"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="field-label" htmlFor="auth-gate-password">รหัสผ่าน</label>
                    <div className="input-container">
                      <Lock size={15} className="auth-input-icon" aria-hidden="true" />
                      <input
                        id="auth-gate-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                        required
                        minLength={6}
                        maxLength={128}
                        disabled={busy}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="อย่างน้อย 6 ตัวอักษร"
                      />
                      <button
                        type="button"
                        className="auth-eye-btn"
                        tabIndex={-1}
                        onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  {mode === 'register' && (
                    <div>
                      <label className="field-label" htmlFor="auth-gate-confirm-password">ยืนยันรหัสผ่าน</label>
                      <div className="input-container">
                        <Lock size={15} className="auth-input-icon" aria-hidden="true" />
                        <input
                          id="auth-gate-confirm-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          minLength={6}
                          maxLength={128}
                          disabled={busy}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          placeholder="กรอกรหัสผ่านอีกครั้ง"
                        />
                      </div>
                    </div>
                  )}

                  {error && <p role="alert" className="error-message">{error}</p>}

                  <button type="submit" className="btn-action-play auth-submit-btn" disabled={busy}>
                    {busy
                      ? 'กำลังดำเนินการ…'
                      : mode === 'register'
                        ? 'สร้างบัญชีและเข้าสู่ Launcher'
                        : 'เข้าสู่ระบบและเปิด Launcher'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
