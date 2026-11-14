import React, { useEffect, useState } from 'react';
import {
  PackageCheck,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Copy,
  XCircle,
  FolderCheck
} from 'lucide-react';
import {
  checkLauncherUpdate,
  installLauncherUpdate,
  checkCityPatch,
  applyCityPatch,
  cancelCityPatch,
  subscribePatchProgress,
  subscribeUpdaterProgress
} from '../services/patcherService';
import {
  APP_VERSION,
  DEFAULT_GITHUB_REPO,
  PATCH_MANIFEST_TEMPLATE,
  formatBytes,
  normalizePatchManifestUrl
} from '../shared/patcherConfig';

export default function PatcherModal({
  isOpen,
  onClose,
  activeServer,
  settings,
  onUpdateServer,
  launcherUpdate,
  onLauncherUpdateChange,
  onBusyChange,
  onOpenFullPatcher,
  onRequestConfirm
}) {
  const [tab, setTab] = useState('city');
  const [manifestDraft, setManifestDraft] = useState('');
  const [cityCheck, setCityCheck] = useState(null);
  const [cityBusy, setCityBusy] = useState(false);
  const [cityProgress, setCityProgress] = useState(null);
  const [cityMessage, setCityMessage] = useState(null);
  const [appBusy, setAppBusy] = useState(false);
  const [appProgress, setAppProgress] = useState(null);
  const [appMessage, setAppMessage] = useState(null);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  const busy = cityBusy || appBusy;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!isOpen) return;
    setManifestDraft(activeServer?.patchManifestUrl || '');
    setCityMessage(null);
    setAppMessage(null);
    setCopiedTemplate(false);
  }, [isOpen, activeServer?.id, activeServer?.patchManifestUrl]);

  useEffect(() => {
    const unsubPatch = subscribePatchProgress(payload => setCityProgress(payload));
    const unsubUpdater = subscribeUpdaterProgress(payload => setAppProgress(payload));
    return () => {
      unsubPatch();
      unsubUpdater();
    };
  }, []);

  if (!isOpen) return null;

  const saveManifestUrl = () => {
    if (!activeServer) return null;
    const raw = manifestDraft.trim();
    const safe = normalizePatchManifestUrl(raw);
    if (raw && !safe) {
      setCityMessage({ error: 'URL ของ Patch Manifest ต้องเป็น HTTPS และไม่มีข้อมูลล็อกอินใน URL' });
      return null;
    }
    onUpdateServer({ id: activeServer.id, patchManifestUrl: safe || '' });
    setManifestDraft(safe || '');
    setCityMessage({ notice: safe ? 'บันทึก Patch Manifest URL แล้ว' : 'ล้าง Patch Manifest URL แล้ว' });
    return safe || '';
  };

  const handleCheckCityPatch = async () => {
    if (!activeServer) return;
    const url = manifestDraft.trim() === (activeServer.patchManifestUrl || '')
      ? (activeServer.patchManifestUrl || '')
      : saveManifestUrl();
    if (url === null) return;
    if (!url) {
      setCityMessage({ error: 'กรุณาระบุ Patch Manifest URL (HTTPS) ของเมืองนี้ก่อนตรวจสอบ' });
      return;
    }
    setCityBusy(true);
    setCityMessage(null);
    setCityProgress(null);
    try {
      const result = await checkCityPatch({
        manifestUrl: url,
        fivemPath: settings.fivemPath,
        serverId: activeServer.id
      });
      setCityCheck(result);
      setCityMessage({
        notice: result.pendingFiles === 0
          ? `ตรวจสอบครบ ${result.totalFiles} ไฟล์ — แพตช์เป็นเวอร์ชันล่าสุด (v${result.version})`
          : `พบ ${result.pendingFiles}/${result.totalFiles} ไฟล์ที่ต้องอัปเดต (${formatBytes(result.totalDownloadBytes)})`
      });
    } catch (err) {
      setCityMessage({ error: err.message });
    } finally {
      setCityBusy(false);
    }
  };

  const handleApplyCityPatch = async () => {
    if (!activeServer) return;
    const url = manifestDraft.trim() === (activeServer.patchManifestUrl || '')
      ? (activeServer.patchManifestUrl || '')
      : saveManifestUrl();
    if (!url) {
      setCityMessage({ error: 'กรุณาระบุ Patch Manifest URL (HTTPS) ของเมืองนี้ก่อนอัปเดต' });
      return;
    }
    setCityBusy(true);
    setCityMessage(null);
    setCityProgress({ phase: 'downloading', currentFile: null, completedFiles: 0, totalFiles: cityCheck?.pendingFiles || 0, downloadedBytes: 0, totalBytes: cityCheck?.totalDownloadBytes || 0, percent: 0 });
    try {
      const result = await applyCityPatch({
        manifestUrl: url,
        fivemPath: settings.fivemPath,
        serverId: activeServer.id
      });
      setCityMessage({ notice: result.message });
      const refreshed = await checkCityPatch({
        manifestUrl: url,
        fivemPath: settings.fivemPath,
        serverId: activeServer.id
      });
      setCityCheck(refreshed);
    } catch (err) {
      setCityMessage({ error: err.message });
    } finally {
      setCityBusy(false);
    }
  };

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

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(PATCH_MANIFEST_TEMPLATE);
      setCopiedTemplate(true);
      setTimeout(() => setCopiedTemplate(false), 2000);
    } catch {
      setCityMessage({ error: 'คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง' });
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-dialog patcher-dialog" role="dialog" aria-modal="true" aria-label="ศูนย์แพตช์และอัปเดต" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <PackageCheck size={19} />
            <span>Patcher &amp; GitHub Updates</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onOpenFullPatcher && (
              <button type="button" className="btn-inline-orange" disabled={busy} onClick={() => { onClose(); onOpenFullPatcher(); }}>
                เปิดหน้า Patcher เต็มจอ
              </button>
            )}
            <button className="modal-close-btn" disabled={busy} onClick={onClose} aria-label="ปิด">✕</button>
          </div>
        </div>

        <div className="patcher-tabs" role="tablist" aria-label="โหมด Patcher">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'city'}
            className={`filter-tab${tab === 'city' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setTab('city')}
          >
            แพตช์ไฟล์เมือง
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'app'}
            className={`filter-tab${tab === 'app' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setTab('app')}
          >
            อัปเดต Estra Launcher {launcherUpdate?.available ? '• ใหม่' : ''}
          </button>
        </div>

        {tab === 'city' ? (
          <div className="modal-body">
            {!activeServer ? (
              <p className="help-text">กรุณาเลือกหรือเพิ่มเซิร์ฟเวอร์ก่อนใช้งาน City Patcher</p>
            ) : (
              <>
                <div className="patcher-summary-card">
                  <div>
                    <span className="eyebrow">CITY PATCH TARGET</span>
                    <strong>{activeServer.name}</strong>
                    <small className="help-text">
                      โฟลเดอร์แพตช์: {cityCheck?.targetDir || `FiveM.app\\estra-patches\\${activeServer.id}`}
                    </small>
                  </div>
                  <span className={`patch-status-pill ${cityCheck ? (cityCheck.pendingFiles === 0 ? 'ok' : 'pending') : ''}`}>
                    {cityCheck
                      ? (cityCheck.pendingFiles === 0 ? `v${cityCheck.version} · ครบถ้วน` : `${cityCheck.pendingFiles} ไฟล์ต้องอัปเดต`)
                      : 'ยังไม่ได้ตรวจ'}
                  </span>
                </div>

                <div>
                  <label className="field-label" htmlFor="city-manifest-url">Patch Manifest URL (GitHub Raw / Releases HTTPS)</label>
                  <div className="input-container">
                    <input
                      id="city-manifest-url"
                      type="url"
                      disabled={cityBusy}
                      value={manifestDraft}
                      onChange={e => setManifestDraft(e.target.value)}
                      placeholder="https://raw.githubusercontent.com/owner/repo/main/patch-manifest.json"
                    />
                    <button type="button" className="btn-inline-orange" disabled={cityBusy} onClick={saveManifestUrl}>บันทึก</button>
                  </div>
                  <small className="help-text">ตรวจสอบ SHA-256 ทุกไฟล์ก่อนแทนที่ • ต้องปิด FiveM ก่อนดาวน์โหลดแพตช์</small>
                </div>

                <div className="patcher-actions-row">
                  <button type="button" className="btn-action-refresh" disabled={cityBusy} onClick={handleCheckCityPatch}>
                    <RefreshCw size={15} className={cityBusy ? 'spinning' : ''} /> ตรวจไฟล์ (Verify)
                  </button>
                  <button type="button" className="btn-action-play" disabled={cityBusy} onClick={handleApplyCityPatch}>
                    <Download size={15} /> {cityBusy ? 'กำลังโหลดแพตช์…' : 'อัปเดตแพตช์'}
                  </button>
                  {cityBusy && (
                    <button type="button" className="btn-action-cache" onClick={() => cancelCityPatch()}>
                      <XCircle size={15} /> ยกเลิก
                    </button>
                  )}
                </div>

                {cityProgress && (
                  <div className="patch-progress-box" aria-live="polite">
                    <div className="patch-progress-head">
                      <span>{cityProgress.currentFile ? `กำลังโหลด: ${cityProgress.currentFile}` : 'กำลังเตรียมดาวน์โหลด…'}</span>
                      <strong>{cityProgress.percent}%</strong>
                    </div>
                    <div className="patch-progress-track">
                      <div className="patch-progress-fill" style={{ width: `${cityProgress.percent}%` }} />
                    </div>
                    <small className="help-text">
                      ไฟล์ {cityProgress.completedFiles}/{cityProgress.totalFiles} · {formatBytes(cityProgress.downloadedBytes)}
                      {cityProgress.totalBytes > 0 ? ` / ${formatBytes(cityProgress.totalBytes)}` : ''}
                    </small>
                  </div>
                )}

                {cityMessage?.error && <p role="alert" className="error-message">{cityMessage.error}</p>}
                {cityMessage?.notice && <p role="status" className="notice">{cityMessage.notice}</p>}

                {cityCheck?.notes && (
                  <div className="patch-notes-box">
                    <span className="eyebrow">PATCH NOTES · v{cityCheck.version}</span>
                    <pre>{cityCheck.notes}</pre>
                  </div>
                )}

                {cityCheck?.files?.length > 0 && (
                  <div className="patch-file-list" aria-label="รายการไฟล์แพตช์">
                    {cityCheck.files.map(file => (
                      <div className="patch-file-row" key={file.path}>
                        <span className="patch-file-icon">
                          {file.status === 'up_to_date' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                        </span>
                        <span className="patch-file-meta">
                          <strong>{file.path}</strong>
                          <small>{file.expectedSize != null ? formatBytes(file.expectedSize) : 'ไม่ระบุขนาด'} · {file.sha256.slice(0, 12)}…</small>
                        </span>
                        <span className={`patch-file-badge ${file.status}`}>
                          {file.status === 'up_to_date' ? 'ตรงกัน' : file.status === 'outdated' ? 'อัปเดต' : 'ยังไม่มี'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <details className="configuration-panel patch-template-panel">
                  <summary>
                    <FolderCheck size={15} />
                    <span>ตัวอย่างไฟล์ patch-manifest.json สำหรับอัปขึ้น GitHub</span>
                  </summary>
                  <div className="patch-template-body">
                    <pre>{PATCH_MANIFEST_TEMPLATE}</pre>
                    <button type="button" className="btn-action-refresh" onClick={copyTemplate}>
                      <Copy size={14} /> {copiedTemplate ? 'คัดลอกแล้ว' : 'คัดลอกตัวอย่าง Manifest'}
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
