import React, { useState, useEffect } from 'react';
import { apiGet } from '../services/apiService';
import { generateCitizenFXIni } from '../services/fivemService';
import { LOCAL_SOCIAL_SENTINEL, SUPABASE_SOCIAL_GATEWAY_URL } from '../shared/supabaseConfig';
import MaintenanceSettings from './MaintenanceSettings';
export default function SettingsModal({ isOpen, onClose, settings, onSaveSettings, activeServer, onMaintenanceBusy }) {
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  useEffect(() => { if (isOpen) { setForm({ ...settings }); setMessage(''); } }, [isOpen, settings]);
  if (!isOpen) return null;
  const checkPath = async () => {
    setChecking(true);
    try { const data = await apiGet(`/api/installation?path=${encodeURIComponent(form.fivemPath)}`); setMessage(`พบ FiveM: ${data.exe}`); }
    catch (err) { setMessage(err.message); } finally { setChecking(false); }
  };
  const exportIni = () => {
    try {
      const url = URL.createObjectURL(new Blob([generateCitizenFXIni(activeServer)], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = 'CitizenFX-build-reference.ini'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('ดาวน์โหลดตัวอย่างแล้ว ใช้เทียบค่าเท่านั้น อย่าแทนที่ config เดิมทั้งไฟล์');
    } catch (err) { setMessage(err.message); }
  };
  return <div className="modal-backdrop" onClick={() => !maintenanceBusy && onClose()}><div className="modal-dialog" role="dialog" aria-modal="true" aria-label="การตั้งค่า Launcher" onClick={e => e.stopPropagation()}>
    <div className="modal-header"><div className="modal-title">การตั้งค่า Launcher</div><button className="modal-close-btn" disabled={maintenanceBusy} onClick={onClose} aria-label="ปิด">✕</button></div>
    <form className="modal-body" onSubmit={e => { e.preventDefault(); if (!maintenanceBusy) { onSaveSettings(form); onClose(); } }}>
      <label htmlFor="fivem-path">ตำแหน่ง FiveM.exe หรือโฟลเดอร์ติดตั้ง</label>
      <div className="input-container"><input id="fivem-path" disabled={maintenanceBusy} value={form.fivemPath} onChange={e => setForm({ ...form, fivemPath: e.target.value })} placeholder="เว้นว่างเพื่อตรวจหาอัตโนมัติ" /></div>
      <button type="button" className="btn-action-refresh" disabled={checking} onClick={checkPath}>{checking ? 'กำลังตรวจ…' : 'ตรวจสอบพาธ'}</button>
      <label htmlFor="github-repo-setting">GitHub Repository สำหรับ Auto-Update (owner/repo)</label>
      <div className="input-container"><input id="github-repo-setting" disabled={maintenanceBusy} value={form.githubRepo || ''} onChange={e => setForm({ ...form, githubRepo: e.target.value })} placeholder="Smallzoamz/5MLauncherEstra" /></div>
      <label htmlFor="social-server-setting">Social Server URL (ออนไลน์ 100% ผ่าน Supabase Cloud หรือพิมพ์ local)</label>
      <div className="input-container"><input id="social-server-setting" type="text" disabled={maintenanceBusy} value={form.socialServerUrl || ''} onChange={e => setForm({ ...form, socialServerUrl: e.target.value })} placeholder="พิมพ์ local เพื่อใช้ในเครื่อง หรือวาง URL ของ Social Server" /></div>
      <div className="settings-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn-action-refresh" disabled={maintenanceBusy} onClick={() => setForm(prev => ({ ...prev, socialServerUrl: SUPABASE_SOCIAL_GATEWAY_URL }))}>คืนค่า Estra Online (Supabase)</button>
        <button type="button" className="btn-action-refresh" disabled={maintenanceBusy} onClick={() => setForm(prev => ({ ...prev, socialServerUrl: LOCAL_SOCIAL_SENTINEL }))}>สลับเป็น Local Mode</button>
      </div>
      {[
        ['checkMicBeforeLaunch', 'ตรวจสิทธิ์และเปิดไมโครโฟนก่อนเล่น', 'ตรวจว่าเปิดอุปกรณ์ได้ ส่วนคุณภาพเสียงให้ทดสอบในหน้าเช็คไมค์'],
        ['autoClearCacheBeforeLaunch', 'ล้างแคชก่อนเปิดเกม', 'ลบแคชเซิร์ฟเวอร์ทุกครั้งที่กดเล่น ต้องปิด FiveM ก่อน'],
        ['requireSteamDiscordBeforeLaunch', 'กำหนดให้เปิด Steam และ Discord ก่อนเล่น', 'เปิดตัวเลือกนี้เมื่อเซิร์ฟเวอร์ของคุณกำหนดให้ใช้']
      ].map(([key, title, help]) => <label className="setting-row" key={key}><span>{title}<small className="help-text">{help}</small></span><input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} /></label>)}
      <button type="button" className="btn-action-refresh" disabled={!activeServer?.gameBuild} onClick={exportIni}>ดาวน์โหลดตัวอย่าง Game Build (.ini)</button>
      {message && <p role="status" className="notice">{message}</p>}
      <MaintenanceSettings fivemPath={form.fivemPath} onBusyChange={value => { setMaintenanceBusy(value); onMaintenanceBusy?.(value); }} />
      <div className="settings-actions"><button type="button" className="btn-action-refresh" disabled={maintenanceBusy} onClick={onClose}>ยกเลิก</button><button className="btn-action-play" disabled={maintenanceBusy} type="submit">บันทึกการตั้งค่า</button></div>
    </form>
  </div></div>;
}

