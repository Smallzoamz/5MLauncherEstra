import React, { useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  Layers,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import {
  CLEAN_PURE_PRESET_ID,
  evaluatePureModeCompatibility
} from '../services/modPresetService';
import { formatBytesCompact } from '../services/crashAnalyzerService';

export default function ModPresetPanel({
  server,
  settings,
  modState,
  busy = false,
  fivemRunning = false,
  onRefresh,
  onCreatePreset,
  onSwitchPreset,
  onDeletePreset,
  onOpenFolder,
  onBindServerPreset,
  onToggleAutoCleanPure,
  onRequestConfirm
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloneFromLive, setCloneFromLive] = useState(false);
  const [formError, setFormError] = useState('');

  const compat = evaluatePureModeCompatibility(server, modState);
  const presets = modState?.presets || [];

  const handleCreate = async e => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('กรุณาตั้งชื่อโปรไฟล์ม็อด เช่น RP ภาพสวย หรือ FPS Boost');
      return;
    }
    setFormError('');
    const ok = await onCreatePreset?.({
      name: cleanName,
      description: description.trim(),
      cloneFromLive
    });
    if (ok) {
      setName('');
      setDescription('');
      setCloneFromLive(false);
      setShowCreate(false);
    }
  };

  return (
    <section className="diag-panel" aria-label="ตัวสลับม็อดและโปรไฟล์ Pure Mode">
      <div className="diag-panel-header">
        <div>
          <span className="eyebrow">MOD &amp; GRAPHICS PRESET SWITCHER</span>
          <h3>สลับม็อดภาพ / เสียง / FPS ตามเมือง &amp; Pure Mode</h3>
          <p className="help-text">
            จัดการโฟลเดอร์ <code>mods/</code> และ <code>plugins/</code> แบบปลอดภัยไม่ลบไฟล์เดิม (สลับทันทีบนไดรฟ์เดียวกัน)
            ไม่แตะไฟล์ระบบหลักของ <code>citizen/</code>
          </p>
        </div>
        <div className="diag-header-actions">
          <button type="button" className="soft-button" disabled={busy} onClick={() => onRefresh?.()}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> รีเฟรช
          </button>
          <button
            type="button"
            className="btn-action-play"
            disabled={busy || fivemRunning}
            onClick={() => setShowCreate(v => !v)}
          >
            <Plus size={14} /> สร้างโปรไฟล์ใหม่
          </button>
        </div>
      </div>

      {fivemRunning && (
        <div className="diag-banner tone-amber" role="status">
          <ShieldAlert size={16} />
          <span>FiveM กำลังทำงานอยู่ — กรุณาปิดเกมก่อนสลับหรือแก้ไขโปรไฟล์ม็อดเพื่อความปลอดภัยของไฟล์</span>
        </div>
      )}

      {server && (
        <div
          className={`diag-banner ${
            compat.mismatch
              ? 'tone-danger'
              : compat.status === 'safe'
                ? 'tone-emerald'
                : 'tone-cobalt'
          }`}
        >
          {compat.mismatch ? <ShieldAlert size={17} /> : <ShieldCheck size={17} />}
          <div className="diag-banner-copy">
            <strong>
              เมืองปัจจุบัน: {server.name}{' '}
              {server.lockPure != null ? `(Pure Mode ${server.lockPure})` : '(ยังไม่ทราบ Pure Mode)'}
            </strong>
            <span>{compat.label}</span>
          </div>
          {compat.mismatch && !fivemRunning && (
            <button
              type="button"
              className="btn-action-play"
              disabled={busy}
              onClick={() => onSwitchPreset?.(CLEAN_PURE_PRESET_ID)}
            >
              สลับเป็น Clean Pure Mode
            </button>
          )}
        </div>
      )}

      <label className="checkbox-row diag-toggle-row">
        <input
          type="checkbox"
          checked={Boolean(settings?.autoCleanModsForPureMode)}
          onChange={e => onToggleAutoCleanPure?.(e.target.checked)}
        />
        <span>
          สลับเป็น <strong>Clean Pure Mode</strong> อัตโนมัติก่อนเข้าเมืองที่บังคับ Pure Mode 1 หรือ 2 (เก็บม็อดเดิมเข้าคลังให้ปลอดภัย)
        </span>
      </label>

      {showCreate && (
        <form className="diag-create-form" onSubmit={handleCreate}>
          <div className="form-row-2col">
            <div>
              <label className="field-label" htmlFor="mod-preset-name">
                ชื่อโปรไฟล์ม็อด
              </label>
              <div className="input-container">
                <input
                  id="mod-preset-name"
                  maxLength={60}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="เช่น RP ภาพสวย NVE / FPS Boost ไฟต์"
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="mod-preset-desc">
                คำอธิบายสั้นๆ (ไม่บังคับ)
              </label>
              <div className="input-container">
                <input
                  id="mod-preset-desc"
                  maxLength={180}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="เช่น ลงถนน + เสียงปืน สำหรับเมือง Pure 0"
                />
              </div>
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={cloneFromLive}
              onChange={e => setCloneFromLive(e.target.checked)}
            />
            <span>คัดลอกไฟล์ม็อดที่กำลังใช้งานอยู่ตอนนี้เข้าโปรไฟล์ใหม่ด้วย</span>
          </label>

          {formError && <p className="error-message" role="alert">{formError}</p>}

          <div className="diag-form-actions">
            <button type="button" className="soft-button" onClick={() => setShowCreate(false)}>
              ยกเลิก
            </button>
            <button type="submit" className="btn-action-play" disabled={busy || fivemRunning}>
              บันทึกโปรไฟล์
            </button>
          </div>
        </form>
      )}

      {!modState ? (
        <div className="diag-empty-box">
          <Layers size={20} />
          <div>
            <strong>ยังไม่โหลดคลังโปรไฟล์ม็อด</strong>
            <p className="help-text">
              ตรวจสอบพาธ FiveM ในการตั้งค่า หรือกดรีเฟรชเพื่อสแกนโฟลเดอร์ mods/ และ plugins/ (รองรับบน Estra Desktop)
            </p>
          </div>
        </div>
      ) : (
        <div className="mod-preset-grid">
          {presets.map(preset => {
            const isBoundToCity = server && server.modPresetId === preset.id;
            return (
              <article
                key={preset.id}
                className={`mod-preset-card${preset.active ? ' is-active' : ''}`}
              >
                <div className="mod-preset-top">
                  <div>
                    <div className="crash-badge-row">
                      <strong>{preset.name}</strong>
                      {preset.active && (
                        <span className="diag-pill tone-emerald">
                          <CheckCircle2 size={11} /> กำลังใช้งาน
                        </span>
                      )}
                      {preset.pureSafe ? (
                        <span className="diag-pill tone-cobalt">Pure 1/2 Safe</span>
                      ) : (
                        <span className="diag-pill tone-amber">Pure 0 Only</span>
                      )}
                      {isBoundToCity && (
                        <span className="diag-pill tone-emerald">ผูกกับเมืองนี้</span>
                      )}
                    </div>
                    {preset.description && <p className="help-text">{preset.description}</p>}
                  </div>
                </div>

                <div className="mod-preset-stats">
                  <span>mods: {preset.modsFiles} ไฟล์</span>
                  <span>plugins: {preset.pluginsFiles} ไฟล์</span>
                  <span>ขนาด: {formatBytesCompact(preset.totalBytes)}</span>
                </div>

                <div className="mod-preset-actions">
                  {!preset.active && (
                    <button
                      type="button"
                      className="btn-action-play"
                      disabled={busy || fivemRunning}
                      onClick={() => onSwitchPreset?.(preset.id)}
                    >
                      สลับมาใช้ชุดนี้
                    </button>
                  )}

                  {server && (
                    <button
                      type="button"
                      className={`soft-button${isBoundToCity ? ' is-bound' : ''}`}
                      disabled={busy}
                      onClick={() =>
                        onBindServerPreset?.(server.id, isBoundToCity ? '' : preset.id)
                      }
                    >
                      <Link2 size={13} />
                      {isBoundToCity ? 'เลิกผูกกับเมืองนี้' : 'ผูกกับเมืองนี้'}
                    </button>
                  )}

                  <button
                    type="button"
                    className="soft-button"
                    disabled={busy}
                    title="เปิดโฟลเดอร์เพื่อนำเข้า/วางไฟล์ .rpf หรือปลั๊กอิน"
                    onClick={() => onOpenFolder?.(preset.id)}
                  >
                    <FolderOpen size={13} /> โฟลเดอร์
                  </button>

                  {!preset.builtIn && !preset.active && (
                    <button
                      type="button"
                      className="soft-button danger-ghost"
                      disabled={busy || fivemRunning}
                      aria-label={`ลบโปรไฟล์ ${preset.name}`}
                      onClick={() => {
                        const doDelete = () => onDeletePreset?.(preset.id);
                        if (onRequestConfirm) {
                          onRequestConfirm({
                            title: `ลบโปรไฟล์ "${preset.name}"?`,
                            message: `ไฟล์ทั้งหมดในโปรไฟล์นี้ (${preset.totalFiles} ไฟล์ / ${formatBytesCompact(preset.totalBytes)}) จะถูกลบออกจากคลังม็อด`,
                            confirmLabel: 'ลบโปรไฟล์',
                            tone: 'danger',
                            onConfirm: doDelete
                          });
                        } else {
                          doDelete();
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
