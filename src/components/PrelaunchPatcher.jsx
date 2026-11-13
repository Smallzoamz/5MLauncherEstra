import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react';
import ServerAvatar from './ServerAvatar';
import WindowMenu from './WindowMenu';
import {
  applyCityPatch,
  cancelCityPatch,
  checkCityPatch,
  checkLauncherUpdate,
  installLauncherUpdate,
  subscribePatchProgress,
  subscribeUpdaterProgress
} from '../services/patcherService';
import { isTauriDesktop } from '../services/desktopBridge';
import { APP_VERSION, formatBytes, isConfiguredGithubRepo } from '../shared/patcherConfig';

const AUTO_ENTER_MS = 1100;

export default function PrelaunchPatcher({
  activeServer,
  settings,
  launcherUpdate,
  onLauncherUpdateChange,
  onOpenPatcherSettings,
  onEnterLauncher,
  paused
}) {
  const [phase, setPhase] = useState('checking-app');
  const [percent, setPercent] = useState(12);
  const [headline, setHeadline] = useState('กำลังเตรียมระบบ Estra Launcher…');
  const [detail, setDetail] = useState('ตรวจสอบเวอร์ชันและสถานะไฟล์แพตช์ก่อนเข้าสู่ลันเชอร์');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [cityCheck, setCityCheck] = useState(null);
  const [cityProgress, setCityProgress] = useState(null);
  const [appProgress, setAppProgress] = useState(null);
  const [runId, setRunId] = useState(0);
  const [autoEnterCancelled, setAutoEnterCancelled] = useState(false);

  const runToken = useRef(0);
  const timerRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    const unsubPatch = subscribePatchProgress(payload => {
      setCityProgress(payload);
      if (typeof payload?.percent === 'number') {
        const mapped = Math.min(98, Math.max(58, Math.round(58 + payload.percent * 0.4)));
        setPercent(mapped);
      }
      if (payload?.currentFile) {
        setDetail(`กำลังโหลด ${payload.currentFile} (${payload.completedFiles}/${payload.totalFiles})`);
      }
    });
    const unsubUpdater = subscribeUpdaterProgress(payload => {
      setAppProgress(payload);
      if (typeof payload?.percent === 'number') {
        setPercent(Math.min(100, Math.max(10, payload.percent)));
      }
      setDetail(payload?.phase === 'installing' ? 'กำลังติดตั้งตัวอัปเดตและรีสตาร์ท…' : 'กำลังดาวน์โหลดอัปเดต Estra Launcher…');
    });
    return () => {
      unsubPatch();
      unsubUpdater();
    };
  }, []);

  useEffect(() => {
    if (paused) {
      clearTimeout(timerRef.current);
      setAutoEnterCancelled(true);
    }
  }, [paused]);

  useEffect(() => {
    const token = ++runToken.current;
    clearTimeout(timerRef.current);
    setError('');
    setWarning('');
    setCityProgress(null);
    setAppProgress(null);
    setCityCheck(null);
    setAutoEnterCancelled(false);

    const alive = () => runToken.current === token;

    const scheduleAutoEnter = () => {
      if (!alive() || pausedRef.current) return;
      timerRef.current = setTimeout(() => {
        if (alive() && !pausedRef.current) onEnterLauncher();
      }, AUTO_ENTER_MS);
    };

    const runChecks = async () => {
      setPhase('checking-app');
      setPercent(22);
      setHeadline('กำลังตรวจสอบอัปเดต Estra Launcher…');
      setDetail(`เชื่อมต่อ GitHub Releases (${settings.githubRepo})`);

      if (isConfiguredGithubRepo(settings.githubRepo)) {
        try {
          const info = await checkLauncherUpdate(settings.githubRepo);
          if (!alive()) return;
          onLauncherUpdateChange?.(info);
          if (info?.available) {
            setPhase('app-update-ready');
            setPercent(50);
            setHeadline(`พบเวอร์ชันใหม่ v${info.version}`);
            setDetail(`พร้อมอัปเดตจาก v${info.currentVersion || APP_VERSION} เป็น v${info.version}`);
            return;
          }
        } catch (err) {
          if (!alive()) return;
          setWarning(`ตรวจเช็กอัปเดตตัวลันเชอร์ไม่สำเร็จ: ${err.message}`);
        }
      }

      if (!alive()) return;
      setPhase('checking-city');
      setPercent(56);

      const manifestUrl = activeServer?.patchManifestUrl?.trim();
      if (manifestUrl && isTauriDesktop()) {
        setHeadline(`กำลังตรวจสอบแพตช์ ${activeServer.name}…`);
        setDetail('ตรวจเช็ก SHA-256 และเปรียบเทียบรายการไฟล์จาก GitHub');
        try {
          const check = await checkCityPatch({
            manifestUrl,
            fivemPath: settings.fivemPath,
            serverId: activeServer.id
          });
          if (!alive()) return;
          setCityCheck(check);

          if (check.pendingFiles > 0) {
            setPhase('patching-city');
            setPercent(60);
            setHeadline(`กำลังดาวน์โหลดแพตช์ v${check.version} (${check.pendingFiles} ไฟล์)…`);
            setDetail(`ขนาดที่ต้องโหลดทั้งหมด ${formatBytes(check.totalDownloadBytes)}`);

            await applyCityPatch({
              manifestUrl,
              fivemPath: settings.fivemPath,
              serverId: activeServer.id
            });
            if (!alive()) return;

            const verified = await checkCityPatch({
              manifestUrl,
              fivemPath: settings.fivemPath,
              serverId: activeServer.id
            });
            if (!alive()) return;
            setCityCheck(verified);
            setPhase('ready');
            setPercent(100);
            setHeadline(`อัปเดตแพตช์ ${activeServer.name} สำเร็จ`);
            setDetail(`ครบ ${verified.totalFiles} ไฟล์ (v${verified.version}) · พร้อมเข้าสู่ลันเชอร์`);
            scheduleAutoEnter();
            return;
          }

          setPhase('ready');
          setPercent(100);
          setHeadline('ไฟล์แพตช์เป็นเวอร์ชันล่าสุดแล้ว');
          setDetail(`ตรวจครบ ${check.totalFiles} ไฟล์ (v${check.version}) · พร้อมเข้าสู่ลันเชอร์`);
          scheduleAutoEnter();
          return;
        } catch (err) {
          if (!alive()) return;
          setPhase('error');
          setError(err.message);
          setHeadline('ไม่สามารถอัปเดตแพตช์เมืองอัตโนมัติได้');
          setDetail('ตรวจสอบการเชื่อมต่อ, URL ของ Manifest หรือปิด FiveM แล้วลองใหม่');
          return;
        }
      }

      setHeadline('กำลังตรวจสอบความพร้อมของลันเชอร์…');
      setDetail(activeServer ? `เตรียมข้อมูลเมือง ${activeServer.name}` : 'เตรียมรายการเมืองและสภาพแวดล้อม');
      setPercent(78);

      await new Promise(resolve => {
        timerRef.current = setTimeout(resolve, 420);
      });
      if (!alive()) return;

      setPhase('ready');
      setPercent(100);
      setHeadline('พร้อมเข้าสู่ Estra Launcher');
      setDetail(
        manifestUrl && !isTauriDesktop()
          ? 'โหมดพรีวิวเบราว์เซอร์ — การโหลดไฟล์แพตช์จริงทำงานในแอปเดสก์ท็อป'
          : `Estra Launcher v${APP_VERSION} · ${settings.githubRepo}`
      );
      scheduleAutoEnter();
    };

    void runChecks();
    return () => {
      clearTimeout(timerRef.current);
    };
  }, [runId, activeServer?.id, activeServer?.patchManifestUrl, settings.githubRepo, settings.fivemPath]);

  const handleRetry = () => {
    clearTimeout(timerRef.current);
    setRunId(r => r + 1);
  };

  const handleInstallAppUpdate = async () => {
    clearTimeout(timerRef.current);
    setPhase('updating-app');
    setError('');
    setPercent(10);
    setHeadline(`กำลังอัปเดต Estra Launcher เป็น v${launcherUpdate?.version || ''}…`);
    setDetail('กำลังดาวน์โหลดและตรวจสอบลายเซ็น Minisign จาก GitHub Releases');
    try {
      await installLauncherUpdate(settings.githubRepo);
    } catch (err) {
      setPhase('app-update-ready');
      setError(err.message);
      setHeadline('ดาวน์โหลดอัปเดตไม่สำเร็จ');
    }
  };

  const handleCancelPatch = async () => {
    clearTimeout(timerRef.current);
    try {
      await cancelCityPatch();
    } catch {}
    setPhase('error');
    setError('ยกเลิกการโหลดแพตช์แล้ว');
    setHeadline('หยุดการดาวน์โหลดแพตช์ชั่วคราว');
  };

  const handleOpenSettings = () => {
    clearTimeout(timerRef.current);
    setAutoEnterCancelled(true);
    onOpenPatcherSettings();
  };

  const isBusy = phase === 'checking-app' || phase === 'checking-city' || phase === 'patching-city' || phase === 'updating-app';
  const showNotes = (phase === 'app-update-ready' && launcherUpdate?.notes) || cityCheck?.notes;

  return (
    <section className="prelaunch-patcher" aria-label="ตัวตรวจอัปเดตและแพตช์ก่อนเข้าลันเชอร์">
      <div className="prelaunch-topbar header-wrap" data-tauri-drag-region>
        <div className="prelaunch-brand" data-tauri-drag-region>
          <img src="/brand/estra-wordmark.svg" alt="Estra" />
          <span className="prelaunch-badge">PATCHER · v{APP_VERSION}</span>
        </div>
        <div className="prelaunch-top-actions">
          <button type="button" className="prelaunch-link-btn" disabled={isBusy} onClick={handleOpenSettings}>
            <Settings2 size={14} /> ตั้งค่า Patcher
          </button>
          <WindowMenu />
        </div>
      </div>

      <div className="prelaunch-stage">
        <div className="prelaunch-hero">
          <div className="prelaunch-target-row">
            {activeServer && <ServerAvatar server={activeServer} className="prelaunch-avatar" />}
            <div>
              <span className="eyebrow">
                {activeServer ? `${activeServer.tag || 'FiveM'} · ${activeServer.ip}` : 'ESTRA DESKTOP'}
              </span>
              <strong className="prelaunch-city-label">{activeServer ? activeServer.name : 'Estra FiveM Launcher'}</strong>
            </div>
            <span className="prelaunch-repo-chip">{settings.githubRepo}</span>
          </div>

          <h1 className="prelaunch-title">
            <span>{headline}</span>
          </h1>
          <p className="prelaunch-subtitle">{detail}</p>

          <div className="prelaunch-steps" aria-label="สถานะขั้นตอนแพตช์">
            <span className={`prelaunch-step ${phase === 'checking-app' ? 'active' : 'done'}`}>
              <ShieldCheck size={13} /> 1. ตรวจเวอร์ชัน Launcher
            </span>
            <span className={`prelaunch-step ${phase === 'checking-city' || phase === 'patching-city' ? 'active' : phase === 'ready' ? 'done' : ''}`}>
              <Download size={13} /> 2. ตรวจและซิงก์แพตช์เมือง
            </span>
            <span className={`prelaunch-step ${phase === 'ready' ? 'done active' : ''}`}>
              <CheckCircle2 size={13} /> 3. พร้อมเปิดหน้าลันเชอร์
            </span>
          </div>

          {showNotes && (
            <div className="prelaunch-notes-card">
              <span className="eyebrow">
                {phase === 'app-update-ready'
                  ? `RELEASE NOTES · v${launcherUpdate.version}`
                  : `PATCH NOTES · v${cityCheck.version}`}
              </span>
              <pre>{phase === 'app-update-ready' ? launcherUpdate.notes : cityCheck.notes}</pre>
            </div>
          )}

          {warning && !error && <p className="notice prelaunch-alert" role="status">{warning}</p>}
          {error && <p className="error-message prelaunch-alert" role="alert">{error}</p>}
        </div>

        <div className="prelaunch-dock">
          <div className="prelaunch-meter-head">
            <div className="prelaunch-meter-meta">
              <span className="prelaunch-status-label">
                {phase === 'patching-city' && cityProgress
                  ? `ไฟล์ ${cityProgress.completedFiles}/${cityProgress.totalFiles} · ${formatBytes(cityProgress.downloadedBytes)}${cityProgress.totalBytes > 0 ? ` / ${formatBytes(cityProgress.totalBytes)}` : ''}`
                  : phase === 'updating-app' && appProgress
                    ? `${formatBytes(appProgress.downloaded || 0)}${appProgress.total ? ` / ${formatBytes(appProgress.total)}` : ''}`
                    : phase === 'ready'
                      ? (autoEnterCancelled || paused ? 'พร้อมใช้งานแล้ว — กดเข้าสู่หน้าลันเชอร์ได้เลย' : 'อัปเดตครบถ้วน กำลังเข้าสู่หน้าลันเชอร์…')
                      : phase === 'app-update-ready'
                        ? `เวอร์ชันใหม่ v${launcherUpdate?.version} พร้อมติดตั้ง`
                        : phase === 'error'
                          ? 'หยุดชั่วคราวเนื่องจากพบข้อผิดพลาด'
                          : 'กำลังทำงาน…'}
              </span>
            </div>
            <strong className="prelaunch-percent" aria-live="polite">{percent}%</strong>
          </div>

          <div
            className="prelaunch-bar-track"
            role="progressbar"
            aria-label="ความคืบหน้าการตรวจและโหลดแพตช์"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className={`prelaunch-bar-fill${isBusy ? ' active' : ''}${phase === 'error' ? ' error' : ''}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="prelaunch-dock-actions">
            <div className="prelaunch-dock-left">
              {phase === 'patching-city' ? (
                <button type="button" className="btn-action-cache" onClick={handleCancelPatch}>
                  <XCircle size={15} /> ยกเลิกการโหลด
                </button>
              ) : (
                <button type="button" className="btn-action-refresh" disabled={isBusy} onClick={handleRetry}>
                  <RefreshCw size={15} className={isBusy ? 'spinning' : ''} /> ตรวจสอบซ้ำ
                </button>
              )}
              <button type="button" className="soft-button" disabled={isBusy} onClick={handleOpenSettings}>
                <Settings2 size={15} /> จัดการ URL / ไฟล์แพตช์
              </button>
            </div>

            <div className="prelaunch-dock-right">
              {phase === 'app-update-ready' && (
                <button type="button" className="btn-action-play" onClick={handleInstallAppUpdate}>
                  <Sparkles size={16} /> อัปเดตเป็น v{launcherUpdate?.version} และรีสตาร์ท
                </button>
              )}
              <button
                type="button"
                className={phase === 'app-update-ready' ? 'btn-action-refresh' : 'btn-action-play'}
                disabled={phase === 'updating-app' || phase === 'patching-city'}
                onClick={() => {
                  clearTimeout(timerRef.current);
                  onEnterLauncher();
                }}
              >
                <span>{phase === 'app-update-ready' ? 'ข้ามไปหน้าลันเชอร์' : 'เข้าสู่หน้าลันเชอร์'}</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
