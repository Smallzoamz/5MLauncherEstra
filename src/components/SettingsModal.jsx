import React, { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../services/apiService';
import { generateCitizenFXIni } from '../services/fivemService';
import { APP_VERSION } from '../shared/patcherConfig';
import MaintenanceSettings from './MaintenanceSettings';

export default function SettingsModal({ isOpen, onClose, settings, onSaveSettings, activeServer, onMaintenanceBusy, gameEnv, onGameEnvUpdate, onRequestConfirm }) {
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [installingFiveM, setInstallingFiveM] = useState(false);
  const [installDir, setInstallDir] = useState('');
  const [envInfo, setEnvInfo] = useState(gameEnv || null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...settings });
    setMessage('');
    setEnvInfo(gameEnv || null);
    setInstallDir(settings.fivemPath || gameEnv?.suggestedInstallDir || 'D:\\EstraFiveM\\FiveM');
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

  const busy = maintenanceBusy || installingFiveM;
  const exportIni = () => {
    try {
      const url = URL.createObjectURL(new Blob([generateCitizenFXIni(activeServer)], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = 'CitizenFX-build-reference.ini'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('ดาวน์โหลดตัวอย่างแล้ว ใช้เทียบค่าเท่านั้น อย่าแทนที่ config เดิมทั้งไฟล์');
    } catch (err) { setMessage(err.message); }
  };
  return <div className="modal-backdrop" onClick={() => !busy && onClose()}><div className="modal-dialog" role="dialog" aria-modal="true" aria-label="การตั้งค่า Launcher" onClick={e => e.stopPropagation()}>
    <div className="modal-header"><div className="modal-title">การตั้งค่า Launcher</div><button className="modal-close-btn" disabled={busy} onClick={onClose} aria-label="ปิด">✕</button></div>
    <form className="modal-body" onSubmit={e => { e.preventDefault(); if (!busy) { onSaveSettings(form); onClose(); } }}>
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
            ดาวน์โหลด FiveM.exe ทางการจาก Cfx.re ลงในโฟลเดอร์ที่เลือก (เลือกนอก Drive C: ได้) และบันทึกพาธให้อัตโนมัติ
          </small>
        </div>
      </details>

      {[
        ['checkMicBeforeLaunch', 'ตรวจสิทธิ์และเปิดไมโครโฟนก่อนเล่น', 'ตรวจว่าเปิดอุปกรณ์ได้ ส่วนคุณภาพเสียงให้ทดสอบในหน้าเช็คไมค์'],
        ['autoClearCacheBeforeLaunch', 'ล้างแคชก่อนเปิดเกม', 'ลบแคชเซิร์ฟเวอร์ทุกครั้งที่กดเล่น ต้องปิด FiveM ก่อน'],
        ['requireSteamDiscordBeforeLaunch', 'กำหนดให้เปิด Steam และ Discord ก่อนเล่น', 'เปิดตัวเลือกนี้เมื่อเซิร์ฟเวอร์ของคุณกำหนดให้ใช้']
      ].map(([key, title, help]) => <label className="setting-row" key={key}><span>{title}<small className="help-text">{help}</small></span><input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} /></label>)}
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

