import React, { useEffect, useState } from 'react';
import { ArrowRight, Download, ShieldCheck, Sparkles } from 'lucide-react';
import { installLauncherUpdate, subscribeUpdaterProgress } from '../services/patcherService';
import { APP_VERSION, DEFAULT_GITHUB_REPO, formatBytes } from '../shared/patcherConfig';

export default function UpdatePromptModal({ isOpen, launcherUpdate, onClose, onBusyChange }) {
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setUpdating(false);
      setProgress(null);
      setError('');
      return undefined;
    }
    return subscribeUpdaterProgress(payload => {
      setProgress(payload);
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = e => {
      if (e.key === 'Escape' && !updating) onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, updating, onClose]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  if (!isOpen || !launcherUpdate?.available) return null;

  const currentVersion = launcherUpdate.currentVersion || APP_VERSION;
  const targetVersion = launcherUpdate.version || '';
  const percent = typeof progress?.percent === 'number'
    ? Math.min(100, Math.max(0, Math.round(progress.percent)))
    : null;

  const handleClose = () => {
    if (!updating) onClose?.();
  };

  const handleInstall = async () => {
    if (updating) return;
    setUpdating(true);
    setError('');
    setProgress(null);
    onBusyChange?.(true);
    try {
      await installLauncherUpdate(DEFAULT_GITHUB_REPO);
    } catch (err) {
      setError(err?.message || 'ไม่สามารถดาวน์โหลดหรือติดตั้งอัปเดตได้');
      setUpdating(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="modal-backdrop update-prompt-backdrop" onClick={handleClose}>
      <div
        className="modal-dialog update-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`มีการอัปเดต Estra Launcher เวอร์ชัน v${targetVersion}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} />
            <div>
              <div>มีการอัปเดตเวอร์ชั่นใหม่</div>
              <small className="guide-subtitle">
                Estra FiveM Launcher พร้อมอัปเดตแล้ว เพื่อความเสถียรและฟีเจอร์ล่าสุด
              </small>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            disabled={updating}
            onClick={handleClose}
            aria-label="ปิด"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="update-version-pills" aria-label="ข้อมูลเวอร์ชั่น">
            <span className="update-version-chip current">เวอร์ชันปัจจุบัน v{currentVersion}</span>
            <ArrowRight size={14} className="update-version-arrow" aria-hidden="true" />
            <span className="update-version-chip next">เวอร์ชันใหม่ v{targetVersion}</span>
          </div>

          {launcherUpdate.notes ? (
            <div className="update-notes-box">
              <span className="eyebrow">RELEASE NOTES · v{targetVersion}</span>
              <pre className="update-modal-notes">{launcherUpdate.notes}</pre>
            </div>
          ) : (
            <p className="help-text">
              กดปุ่มอัปเดตด้านล่างเพื่อให้โปรแกรมดาวน์โหลด ตรวจสอบลายเซ็นความปลอดภัย และรีสตาร์ทเป็นเวอร์ชันใหม่โดยอัตโนมัติ
            </p>
          )}

          {updating && (
            <div className="update-modal-progress" role="status" aria-live="polite">
              <div className="update-modal-progress-head">
                <span>
                  {progress?.phase === 'installing'
                    ? 'กำลังติดตั้งตัวอัปเดตและเตรียมรีสตาร์ท…'
                    : 'กำลังดาวน์โหลดไฟล์อัปเดต…'}
                </span>
                <strong>
                  {percent !== null ? `${percent}%` : ''}
                  {progress?.downloaded
                    ? ` (${formatBytes(progress.downloaded)}${progress.total ? ` / ${formatBytes(progress.total)}` : ''})`
                    : ''}
                </strong>
              </div>
              <div className="prelaunch-bar-track">
                <div
                  className="prelaunch-bar-fill active"
                  style={{ width: `${percent ?? 20}%` }}
                />
              </div>
            </div>
          )}

          <div className="directory-hint-pill info">
            <ShieldCheck size={14} />
            <span>ตรวจสอบความถูกต้องด้วยลายเซ็น Minisign จาก GitHub Releases อัตโนมัติ</span>
          </div>

          {error && <p role="alert" className="error-message">{error}</p>}

          <div className="guide-footer-actions">
            <button
              type="button"
              className="btn-action-refresh"
              disabled={updating}
              onClick={handleClose}
            >
              อัปเดตภายหลัง
            </button>
            <button
              type="button"
              className="btn-action-play"
              disabled={updating}
              onClick={handleInstall}
            >
              <Download size={15} />
              {updating ? 'กำลังอัปเดต…' : `อัปเดตเป็น v${targetVersion} และรีสตาร์ท`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
