import React, { useEffect, useState } from 'react';
import { PackageCheck, RefreshCw, Download } from 'lucide-react';
import {
  checkLauncherUpdate,
  installLauncherUpdate,
  subscribeUpdaterProgress
} from '../services/patcherService';
import { APP_VERSION, DEFAULT_GITHUB_REPO } from '../shared/patcherConfig';

export default function PatcherModal({
  isOpen,
  onClose,
  launcherUpdate,
  onLauncherUpdateChange,
  onBusyChange,
  onOpenFullPatcher,
  onRequestConfirm
}) {
  const [appBusy, setAppBusy] = useState(false);
  const [appProgress, setAppProgress] = useState(null);
  const [appMessage, setAppMessage] = useState(null);

  useEffect(() => {
    onBusyChange?.(appBusy);
  }, [appBusy, onBusyChange]);

  useEffect(() => {
    if (!isOpen) return;
    setAppMessage(null);
  }, [isOpen]);

  useEffect(() => {
    const unsubUpdater = subscribeUpdaterProgress(payload => setAppProgress(payload));
    return () => unsubUpdater();
  }, []);

  if (!isOpen) return null;

  const handleCheckLauncherUpdate = async () => {
    setAppBusy(true);
    setAppMessage(null);
    try {
      const info = await checkLauncherUpdate(DEFAULT_GITHUB_REPO);
      onLauncherUpdateChange?.(info);
      setAppMessage({ notice: info.message });
    } catch (err) {
      setAppMessage({ error: err.message });
    } finally {
      setAppBusy(false);
    }
  };

  const handleInstallLauncherUpdate = async () => {
    setAppBusy(true);
    setAppMessage(null);
    setAppProgress({ phase: 'downloading', downloaded: 0, total: null, percent: 0 });
    try {
      await installLauncherUpdate(DEFAULT_GITHUB_REPO);
    } catch (err) {
      setAppMessage({ error: err.message });
      setAppBusy(false);
    }
  };

  const confirmInstallLauncherUpdate = () => {
    if (!onRequestConfirm) {
      void handleInstallLauncherUpdate();
      return;
    }
    onRequestConfirm({
      title: 'อัปเดต Estra Launcher',
      message: `ต้องการดาวน์โหลดและติดตั้งเวอร์ชัน v${launcherUpdate?.version || ''} และรีสตาร์ทโปรแกรมใช่หรือไม่?`,
      detail: 'ระบบจะตรวจสอบลายเซ็นความปลอดภัยก่อนติดตั้งอัตโนมัติ',
      confirmLabel: 'อัปเดตและรีสตาร์ท',
      tone: 'primary',
      onConfirm: handleInstallLauncherUpdate
    });
  };

  return (
    <div className="modal-backdrop" onClick={() => !appBusy && onClose()}>
      <div className="modal-dialog patcher-dialog" role="dialog" aria-modal="true" aria-label="ศูนย์อัปเดต Estra Launcher" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <PackageCheck size={19} />
            <span>Estra Launcher Updates</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onOpenFullPatcher && (
              <button type="button" className="btn-inline-orange" disabled={appBusy} onClick={() => { onClose(); onOpenFullPatcher(); }}>
                เปิดหน้า Patcher เต็มจอ
              </button>
            )}
            <button className="modal-close-btn" disabled={appBusy} onClick={onClose} aria-label="ปิด">✕</button>
          </div>
        </div>

        <div className="modal-body">
          <div className="patcher-summary-card">
            <div>
              <span className="eyebrow">ESTRA FIVEM LAUNCHER</span>
              <strong>เวอร์ชันปัจจุบัน v{launcherUpdate?.currentVersion || APP_VERSION}</strong>
              <small className="help-text">
                ตรวจสอบอัปเดตอัตโนมัติพร้อมยืนยันลายเซ็นความปลอดภัยก่อนติดตั้งทุกครั้ง
              </small>
            </div>
            <span className={`patch-status-pill ${launcherUpdate?.available ? 'pending' : 'ok'}`}>
              {launcherUpdate?.available ? `มีเวอร์ชัน v${launcherUpdate.version}` : 'พร้อมใช้งาน'}
            </span>
          </div>

          <div className="patcher-actions-row">
            <button type="button" className="btn-action-refresh" disabled={appBusy} onClick={handleCheckLauncherUpdate}>
              <RefreshCw size={15} className={appBusy ? 'spinning' : ''} /> ตรวจหาอัปเดต
            </button>
            <button
              type="button"
              className="btn-action-play"
              disabled={appBusy || !launcherUpdate?.available}
              onClick={confirmInstallLauncherUpdate}
            >
              <Download size={15} /> {appBusy ? 'กำลังอัปเดต…' : 'อัปเดตและรีสตาร์ท'}
            </button>
          </div>

          {appProgress && (
            <div className="patch-progress-box" aria-live="polite">
              <div className="patch-progress-head">
                <span>{appProgress.phase === 'installing' ? 'กำลังติดตั้งและรีสตาร์ท…' : 'กำลังดาวน์โหลดตัวอัปเดต…'}</span>
                <strong>{appProgress.percent}%</strong>
              </div>
              <div className="patch-progress-track">
                <div className="patch-progress-fill" style={{ width: `${appProgress.percent}%` }} />
              </div>
            </div>
          )}

          {appMessage?.error && <p role="alert" className="error-message">{appMessage.error}</p>}
          {appMessage?.notice && <p role="status" className="notice">{appMessage.notice}</p>}

          {launcherUpdate?.notes && (
            <div className="patch-notes-box">
              <span className="eyebrow">RELEASE NOTES · v{launcherUpdate.version}</span>
              <pre>{launcherUpdate.notes}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
