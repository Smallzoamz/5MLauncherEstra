import React, { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../services/apiService';
import { generateCitizenFXIni } from '../services/fivemService';
import { APP_VERSION } from '../shared/patcherConfig';
import { SCREENSHOT_HOTKEYS } from '../services/screenshotService';
import { PERF_OVERLAY_POSITIONS } from '../services/perfOverlayService';
import { playOverlayFriendChime, pushOverlayNotification } from '../services/overlayService';
import MaintenanceSettings from './MaintenanceSettings';

export default function SettingsModal({ isOpen, onClose, settings, onSaveSettings, activeServer, onMaintenanceBusy, gameEnv, onGameEnvUpdate, onRequestConfirm }) {
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [installingFiveM, setInstallingFiveM] = useState(false);
  const [installDir, setInstallDir] = useState('');
  const [envInfo, setEnvInfo] = useState(gameEnv || null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [savingStartup, setSavingStartup] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...settings });
    setMessage('');
    setEnvInfo(gameEnv || null);
    setInstallDir(settings.fivemPath || gameEnv?.suggestedInstallDir || 'D:\\EstraFiveM\\FiveM');
    let active = true;
    if (window.estraWindow?.getStartupSettings) {
      void window.estraWindow.getStartupSettings()
        .then(state => {
          if (active && typeof state?.enabled === 'boolean') {
            setForm(prev => ({ ...prev, runOnWindowsStartup: state.enabled }));
          }
        })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [isOpen, settings, gameEnv]);

  if (!isOpen) return null;

  const checkPath = async () => {
    setChecking(true);
    try {
      const data = await apiGet(`/api/installation?path=${encodeURIComponent(form.fivemPath)}`);
      setMessage(`พบ FiveM: ${data.exe}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setChecking(false);
    }
  };

  const detectEnvironment = async () => {
    setChecking(true);
    try {
      const env = await apiGet(`/api/game-environment?path=${encodeURIComponent(form.fivemPath)}`);
      setEnvInfo(env);
      onGameEnvUpdate?.(env);
      if (env?.suggestedInstallDir && !installDir) setInstallDir(env.suggestedInstallDir);
      if (env?.fivem?.found && env.fivem.root) {
        setForm(prev => ({ ...prev, fivemPath: env.fivem.root }));
        setMessage(`ตรวจพบ FiveM (${env.fivem.source}): ${env.fivem.exe}${env.gtav?.found ? ` • GTA V (${env.gtav.source})` : ''}`);
      } else if (env?.gtav?.found) {
        setMessage(`ตรวจพบ GTA V (${env.gtav.source}) ที่ ${env.gtav.root} แต่ยังไม่พบ FiveM — สามารถกดติดตั้ง FiveM ด้านล่างได้`);
      } else {
        setMessage('ยังไม่พบ GTA V หรือ FiveM ในเครื่อง กรุณาระบุพาธหรือติดตั้ง FiveM ด้านล่าง');
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      setChecking(false);
    }
  };

  const installFiveM = async () => {
    setInstallingFiveM(true);
    onMaintenanceBusy?.(true);
    try {
      const res = await apiPost('/api/install-fivem', { targetDir: installDir });
      if (res?.root) {
        const nextForm = { ...form, fivemPath: res.root };
        setForm(nextForm);
        onSaveSettings(nextForm);
      }
      setMessage(res.message || `ติดตั้ง FiveM ที่ ${res.exe} สำเร็จ`);
      void detectEnvironment();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setInstallingFiveM(false);
      onMaintenanceBusy?.(false);
    }
  };

  const busy = maintenanceBusy || installingFiveM || savingStartup;
  const handleSubmit = async e => {
    e.preventDefault();
    if (busy) return;
    setSavingStartup(true);
    setMessage('');
    try {
      if (window.estraWindow?.setStartupSettings) {
        await window.estraWindow.setStartupSettings(Boolean(form.runOnWindowsStartup));
      }
      onSaveSettings(form);
      onClose();
    } catch (err) {
      setMessage(err?.message || 'ไม่สามารถบันทึกการตั้งค่า Run on Windows Start ได้');
    } finally {
      setSavingStartup(false);
    }
  };
  const exportIni = () => {
    try {
      const url = URL.createObjectURL(new Blob([generateCitizenFXIni(activeServer)], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = 'CitizenFX-build-reference.ini'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('ดาวน์โหลดตัวอย่างแล้ว ใช้เทียบค่าเท่านั้น อย่าแทนที่ config เดิมทั้งไฟล์');
    } catch (err) { setMessage(err.message); }
  };
  return <div className="modal-backdrop" onClick={() => !busy && onClose()}><div className="modal-dialog" role="dialog" aria-modal="true" aria-label="การตั้งค่า Launcher" onClick={e => e.stopPropagation()}>
    <div className="modal-header"><div className="modal-title">การตั้งค่า Launcher</div><button className="modal-close-btn" disabled={busy} onClick={onClose} aria-label="ปิด">✕</button></div>
    <form className="modal-body" onSubmit={handleSubmit}>
      <label htmlFor="fivem-path">ตำแหน่ง FiveM.exe หรือโฟลเดอร์ติดตั้ง (รองรับนอก Drive C:)</label>
      <div className="input-container"><input id="fivem-path" disabled={busy} value={form.fivemPath} onChange={e => setForm({ ...form, fivemPath: e.target.value })} placeholder="เว้นว่างเพื่อตรวจหาอัตโนมัติ หรือระบุ D:\EstraFiveM\FiveM" /></div>
      <div className="settings-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn-action-refresh" disabled={checking || busy} onClick={checkPath}>{checking ? 'กำลังตรวจ…' : 'ตรวจสอบพาธ'}</button>
        <button type="button" className="btn-action-refresh" disabled={checking || busy} onClick={detectEnvironment}>ตรวจจับ GTA V &amp; FiveM อัตโนมัติ</button>
      </div>

      {envInfo && (
        <div className="env-detect-summary">
          <div>
            <strong>GTA V:</strong>{' '}
            {envInfo.gtav?.found ? `${envInfo.gtav.root} (${envInfo.gtav.source})` : 'ยังไม่พบในระบบ'}
          </div>
          <div>
            <strong>FiveM:</strong>{' '}
            {envInfo.fivem?.found ? `${envInfo.fivem.root} (${envInfo.fivem.source})` : 'ยังไม่พบ FiveM.exe'}
          </div>
        </div>
      )}

      <details className="configuration-panel patch-template-panel">
        <summary>
          <span>ติดตั้ง FiveM ควบคู่กับ Launcher (เลือกไดรฟ์ปลายทางได้)</span>
        </summary>
        <div className="patch-template-body">
          <div className="input-container">
            <input
              type="text"
              aria-label="โฟลเดอร์ติดตั้ง FiveM"
              disabled={busy}
              value={installDir}
              onChange={e => setInstallDir(e.target.value)}
              placeholder="เช่น D:\EstraFiveM\FiveM"
            />
            <button type="button" className="btn-inline-orange" disabled={busy || !installDir.trim()} onClick={installFiveM}>
              {installingFiveM ? 'กำลังโหลด…' : 'ติดตั้ง FiveM'}
            </button>
          </div>
          <div className="settings-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            <button type="button" className="btn-action-refresh" disabled={busy} onClick={() => setInstallDir('D:\\EstraFiveM\\FiveM')}>D:\EstraFiveM\FiveM</button>
            <button type="button" className="btn-action-refresh" disabled={busy} onClick={() => setInstallDir('E:\\EstraFiveM\\FiveM')}>E:\EstraFiveM\FiveM</button>
            {envInfo?.suggestedInstallDir && (
              <button type="button" className="btn-action-refresh" disabled={busy} onClick={() => setInstallDir(envInfo.suggestedInstallDir)}>ค่าแนะนำ</button>
            )}
          </div>
          <small className="help-text">
            ดาวน์โหลด FiveM.exe ทางการจาก Cfx.re ลงในโฟลเดอร์ที่เลือก (นอก Drive C: ได้) แล้วรันโปรแกรมติดตั้ง FiveM ลงเครื่องให้อัตโนมัติ
          </small>
        </div>
      </details>

      {[
        ['runOnWindowsStartup', 'Run on Windows Start (เปิดอัตโนมัติใน System Tray + Low Priority)', 'เมื่อเปิดเครื่อง โปรแกรมจะรันแบบซ่อนใน System Tray ไม่เด้งขึ้นหน้าจอ และตั้งค่า Process Priority ของตัวเองเป็น Low'],
        ['checkMicBeforeLaunch', 'ตรวจสิทธิ์และเปิดไมโครโฟนก่อนเล่น', 'ตรวจว่าเปิดอุปกรณ์ได้ ส่วนคุณภาพเสียงให้ทดสอบในหน้าเช็คไมค์'],
        ['autoClearCacheBeforeLaunch', 'ล้างแคชก่อนเปิดเกม', 'ลบแคชเซิร์ฟเวอร์ทุกครั้งที่กดเล่น ต้องปิด FiveM ก่อน'],
        ['requireSteamDiscordBeforeLaunch', 'กำหนดให้เปิด Steam และ Discord ก่อนเล่น', 'เปิดตัวเลือกนี้เมื่อเซิร์ฟเวอร์ของคุณกำหนดให้ใช้'],
        ['autoAnalyzeCrashAfterExit', 'วิเคราะห์ Crash Log อัตโนมัติหลัง FiveM ปิด', 'ตรวจหาไฟล์ crash dump และ CitizenFX_log หลังเกมปิด หากพบอาการเด้งจะเปิดหน้าแนะนำวิธีแก้ทันที'],
        ['autoCleanModsForPureMode', 'สลับเป็น Clean Pure Mode อัตโนมัติเมื่อเข้าเมือง Pure Mode 1/2', 'เก็บไฟล์ mods/ และ plugins/ เข้าคลังปลอดภัยก่อนเข้าเมืองที่ห้ามลงม็อดโดยไม่ลบไฟล์เดิม']
      ].map(([key, title, help]) => <label className="setting-row" key={key}><span>{title}<small className="help-text">{help}</small></span><input type="checkbox" disabled={busy} checked={Boolean(form[key])} onChange={e => setForm({ ...form, [key]: e.target.checked })} /></label>)}

      <details className="configuration-panel patch-template-panel">
        <summary>
          <span>จับภาพหน้าจอแบบ Steam (Screen Capture · {form.screenshotHotkey || 'F12'})</span>
        </summary>
        <div className="patch-template-body">
          <label className="setting-row">
            <span>เปิดใช้คีย์ลัดจับภาพหน้าจอ<small className="help-text">กดปุ่มลัดเพื่อบันทึกรูปลงโฟลเดอร์ของโปรแกรมอัตโนมัติ (แนะนำให้เกมใช้ Windowed / Borderless)</small></span>
            <input type="checkbox" disabled={busy} checked={form.screenshotEnabled !== false} onChange={e => setForm({ ...form, screenshotEnabled: e.target.checked })} />
          </label>
          <div style={{ marginTop: 10 }}>
            <label htmlFor="screenshot-hotkey">ปุ่มคีย์ลัดจับภาพ</label>
            <div className="input-container">
              <select
                id="screenshot-hotkey"
                disabled={busy || form.screenshotEnabled === false}
                value={form.screenshotHotkey || 'F12'}
                onChange={e => setForm({ ...form, screenshotHotkey: e.target.value })}
              >
                {SCREENSHOT_HOTKEYS.map(item => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="setting-row" style={{ marginTop: 10 }}>
            <span>จับภาพเฉพาะตอนเปิด FiveM อยู่เท่านั้น<small className="help-text">หากปิดไว้ จะสามารถกด {form.screenshotHotkey || 'F12'} เพื่อแคปภาพหน้าจอได้ตลอดเวลาแม้ยังไม่ได้เข้าเกม</small></span>
            <input type="checkbox" disabled={busy || form.screenshotEnabled === false} checked={Boolean(form.screenshotOnlyInGame)} onChange={e => setForm({ ...form, screenshotOnlyInGame: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>เล่นเสียงชัตเตอร์และแจ้งเตือนเมื่อถ่ายภาพ<small className="help-text">ส่งเสียงคลิกเบาๆ เมื่อบันทึกภาพหน้าจอสำเร็จ</small></span>
            <input type="checkbox" disabled={busy} checked={form.screenshotPlaySound !== false} onChange={e => setForm({ ...form, screenshotPlaySound: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>ให้ติดแถบ Performance (FPS / CPU / GPU) ไปในภาพที่แคปด้วย<small className="help-text">หากเปิด จะบันทึกแถบ FPS / CPU / GPU ลงในรูปเมื่อกด {form.screenshotHotkey || 'F12'} • หากปิด จะซ่อนแถบนี้ชั่วขณะก่อนแคปโดยอัตโนมัติ</small></span>
            <input type="checkbox" disabled={busy || form.screenshotEnabled === false} checked={Boolean(form.perfOverlayIncludeInScreenshots)} onChange={e => setForm({ ...form, perfOverlayIncludeInScreenshots: e.target.checked })} />
          </label>
          <div style={{ marginTop: 10 }}>
            <label htmlFor="screenshot-dir">โฟลเดอร์เก็บรูปภาพ (เว้นว่างเพื่อใช้โฟลเดอร์ของโปรแกรม)</label>
            <div className="input-container">
              <input
                id="screenshot-dir"
                disabled={busy}
                value={form.screenshotDir || ''}
                onChange={e => setForm({ ...form, screenshotDir: e.target.value })}
                placeholder="ค่าเริ่มต้น: โฟลเดอร์ screenshots ภายใน AppData ของ Estra"
              />
              {window.estraWindow?.openScreenshotsFolder && (
                <button
                  type="button"
                  className="btn-action-refresh"
                  disabled={busy}
                  onClick={() => {
                    void window.estraWindow.openScreenshotsFolder(form.screenshotDir || null).catch(err => setMessage(err?.message || 'เปิดโฟลเดอร์ไม่สำเร็จ'));
                  }}
                >
                  เปิดโฟลเดอร์
                </button>
              )}
            </div>
          </div>
        </div>
      </details>

      <details className="configuration-panel patch-template-panel">
        <summary>
          <span>Overlay Notification แบบ Steam (มุมขวาล่างขณะเปิดเกม)</span>
        </summary>
        <div className="patch-template-body">
          <label className="setting-row">
            <span>เปิดใช้หน้าต่าง Overlay แจ้งเตือน<small className="help-text">แสดง popup มุมขวาล่างโดยไม่แย่งโฟกัสหรือคลิกเมาส์ขณะเล่นเกม (รองรับโหมด Windowed / Borderless)</small></span>
            <input type="checkbox" disabled={busy} checked={form.overlayNotificationsEnabled !== false} onChange={e => setForm({ ...form, overlayNotificationsEnabled: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>แจ้งเตือนเมื่อแคปภาพหน้าจอสำเร็จ<small className="help-text">แสดงตัวอย่างภาพที่เพิ่งถ่ายพร้อมชื่อไฟล์ทันทีเมื่อกด {form.screenshotHotkey || 'F12'}</small></span>
            <input type="checkbox" disabled={busy || form.overlayNotificationsEnabled === false} checked={form.overlayNotifyScreenshot !== false} onChange={e => setForm({ ...form, overlayNotifyScreenshot: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>แจ้งเตือนเมื่อเพื่อนออนไลน์<small className="help-text">แจ้งเตือนเมื่อมีเพื่อนล็อกอินเข้าใช้งาน Estra Launcher</small></span>
            <input type="checkbox" disabled={busy || form.overlayNotificationsEnabled === false} checked={form.overlayNotifyFriendOnline !== false} onChange={e => setForm({ ...form, overlayNotifyFriendOnline: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>แจ้งเตือนเมื่อเพื่อนกำลังเข้าเมือง<small className="help-text">แสดงชื่อเพื่อนและชื่อเมือง FiveM ที่เพื่อนกำลังเข้าเล่น</small></span>
            <input type="checkbox" disabled={busy || form.overlayNotificationsEnabled === false} checked={form.overlayNotifyFriendInGame !== false} onChange={e => setForm({ ...form, overlayNotifyFriendInGame: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>แจ้งเตือนเมื่อเมืองที่เฝ้ารีสตาร์ทเสร็จ / มีสล็อตว่าง<small className="help-text">เด้ง Overlay แจ้งเตือนจาก Server Watcher เพื่อกดเข้าเมืองได้ทันที</small></span>
            <input type="checkbox" disabled={busy || form.overlayNotificationsEnabled === false} checked={form.overlayNotifyServerWatcher !== false} onChange={e => setForm({ ...form, overlayNotifyServerWatcher: e.target.checked })} />
          </label>
          <div className="settings-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
            <button
              type="button"
              className="btn-action-refresh"
              disabled={busy}
              onClick={() => {
                if (form.screenshotPlaySound !== false) playOverlayFriendChime();
                void pushOverlayNotification(
                  {
                    id: `test-overlay-${Date.now()}`,
                    kind: 'friend-in-game',
                    badge: 'เพื่อนกำลังเข้าเล่น',
                    title: 'Estra Friend (ทดสอบ)',
                    subtitle: `กำลังเข้าเมือง ${activeServer?.name || 'Estra City RP'}`,
                    detail: activeServer?.ip || 'cfx.re/join/estra',
                    imageUrl: '',
                    initials: 'EF',
                    accentColor: '#2b6bf3',
                    durationMs: 4500
                  },
                  { force: true }
                ).catch(err => setMessage(err?.message || 'ไม่สามารถแสดง Overlay ทดสอบได้'));
              }}
            >
              ทดสอบแจ้งเตือน Overlay
            </button>
          </div>
        </div>
      </details>

      <details className="configuration-panel patch-template-panel" open>
        <summary>
          <span>Performance Overlay (FPS / CPU / GPU)</span>
        </summary>
        <div className="patch-template-body">
          <label className="setting-row">
            <span>เปิดแสดง Performance Overlay (FPS / CPU / GPU)<small className="help-text">แสดงตัวเลข FPS, CPU % และ GPU % บนหน้าจอแบบไม่แย่งโฟกัสเมาส์หรือคีย์บอร์ด (แนะนำให้เกมใช้ Windowed / Borderless)</small></span>
            <input type="checkbox" disabled={busy} checked={Boolean(form.perfOverlayEnabled)} onChange={e => setForm({ ...form, perfOverlayEnabled: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>ให้ติดแถบนี้ไปด้วยเมื่อกด {form.screenshotHotkey || 'F12'} แคปหน้าจอ<small className="help-text">เปิด = แถบ FPS / CPU / GPU ติดไปในภาพแคปด้วย • ปิด = ซ่อนแถบชั่วคราวขณะแคปภาพ</small></span>
            <input type="checkbox" disabled={busy || !form.perfOverlayEnabled} checked={Boolean(form.perfOverlayIncludeInScreenshots)} onChange={e => setForm({ ...form, perfOverlayIncludeInScreenshots: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>แสดงเฉพาะตอนเปิด FiveM อยู่เท่านั้น<small className="help-text">หากเปิด แถบประสิทธิภาพจะซ่อนอัตโนมัติเมื่อยังไม่ได้เปิดเกม FiveM</small></span>
            <input type="checkbox" disabled={busy || !form.perfOverlayEnabled} checked={Boolean(form.perfOverlayOnlyInGame)} onChange={e => setForm({ ...form, perfOverlayOnlyInGame: e.target.checked })} />
          </label>
          <div style={{ marginTop: 10 }}>
            <label htmlFor="perf-overlay-position">ตำแหน่งแสดงผลบนหน้าจอ</label>
            <div className="input-container">
              <select
                id="perf-overlay-position"
                disabled={busy || !form.perfOverlayEnabled}
                value={form.perfOverlayPosition || 'top-left'}
                onChange={e => setForm({ ...form, perfOverlayPosition: e.target.value })}
              >
                {PERF_OVERLAY_POSITIONS.map(pos => (
                  <option key={pos.value} value={pos.value}>{pos.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </details>

      <details className="configuration-panel patch-template-panel" open>
        <summary>
          <span>วันที่ &amp; เวลา Overlay (Date &amp; Time)</span>
        </summary>
        <div className="patch-template-body">
          <label className="setting-row">
            <span>เปิดแสดงวันที่และเวลา (Overlay)<small className="help-text">แสดงวันที่และเวลาปัจจุบันบนหน้าจอแบบคลิกทะลุ (หากเลือกมุมเดียวกับ FPS / CPU / GPU จะแสดงต่อจาก GPU อัตโนมัติ)</small></span>
            <input type="checkbox" disabled={busy} checked={Boolean(form.clockOverlayEnabled)} onChange={e => setForm({ ...form, clockOverlayEnabled: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>ให้ติดแถบวันที่และเวลาไปด้วยเมื่อกด {form.screenshotHotkey || 'F12'} แคปหน้าจอ<small className="help-text">เปิด = เห็นวันที่/เวลาในภาพแคปด้วย • ปิด = ซ่อนชั่วคราวก่อนแคป (หากวางมุมเดียวกับ Performance Overlay จะอ้างอิงสิทธิ์จากแถบ Performance)</small></span>
            <input type="checkbox" disabled={busy || !form.clockOverlayEnabled} checked={Boolean(form.clockOverlayIncludeInScreenshots)} onChange={e => setForm({ ...form, clockOverlayIncludeInScreenshots: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>แสดงเฉพาะตอนเปิด FiveM อยู่เท่านั้น<small className="help-text">หากเปิด แถบวันที่และเวลาจะแสดงเฉพาะระหว่างเปิดเกม FiveM</small></span>
            <input type="checkbox" disabled={busy || !form.clockOverlayEnabled} checked={Boolean(form.clockOverlayOnlyInGame)} onChange={e => setForm({ ...form, clockOverlayOnlyInGame: e.target.checked })} />
          </label>
          <div style={{ marginTop: 10 }}>
            <label htmlFor="clock-overlay-position">ตำแหน่งแสดงผลวันที่และเวลา</label>
            <div className="input-container">
              <select
                id="clock-overlay-position"
                disabled={busy || !form.clockOverlayEnabled}
                value={form.clockOverlayPosition || 'top-right'}
                onChange={e => setForm({ ...form, clockOverlayPosition: e.target.value })}
              >
                {PERF_OVERLAY_POSITIONS.map(pos => (
                  <option key={pos.value} value={pos.value}>{pos.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </details>
      <button type="button" className="btn-action-refresh" disabled={!activeServer?.gameBuild} onClick={exportIni}>ดาวน์โหลดตัวอย่าง Game Build (.ini)</button>
      {message && <p role="status" className="notice">{message}</p>}
      <MaintenanceSettings fivemPath={form.fivemPath} onBusyChange={value => { setMaintenanceBusy(value); onMaintenanceBusy?.(value); }} onRequestConfirm={onRequestConfirm} />
      <div className="settings-actions">
        <small className="help-text" style={{ marginRight: 'auto' }}>Estra Launcher v{APP_VERSION}</small>
        <button type="button" className="btn-action-refresh" disabled={busy} onClick={onClose}>ยกเลิก</button>
        <button className="btn-action-play" disabled={busy} type="submit">บันทึกการตั้งค่า</button>
      </div>
    </form>
  </div></div>;
}

