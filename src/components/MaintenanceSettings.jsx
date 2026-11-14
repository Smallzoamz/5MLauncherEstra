import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/apiService';
const labels = { logs: 'Log ของ FiveM', crashes: 'Crash reports ของ FiveM', shaders: 'Shader / GPU cache ของ FiveM' };
const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
export default function MaintenanceSettings({ fivemPath, onBusyChange, onRequestConfirm }) {
  const [preview, setPreview] = useState(null), [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  useEffect(() => { setPreview(null); setResult(null); }, [fivemPath]);
  const run = async remove => {
    setBusy(true); onBusyChange(true); setResult(null);
    try {
      if (remove) { setResult(await apiPost('/api/clean-maintenance', { fivemPath, categories: selected })); setPreview(null); }
      else setPreview(await apiGet(`/api/maintenance-preview?path=${encodeURIComponent(fivemPath)}`));
    } catch (error) { setResult(error.details || { success: false, error: error.message }); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <section className="maintenance-settings" aria-label="ล้างไฟล์ FiveM">
    <h3>จัดการไฟล์ FiveM</h3>
    <p className="help-text">ปิด FiveM ทุกหน้าต่างก่อนล้างไฟล์ เลือกเฉพาะประเภทที่ต้องการ • Shader จะถูกสร้างใหม่เมื่อเล่นเกม</p>
    {Object.entries(labels).map(([key, label]) => {
      const group = preview?.groups.find(g => g.category === key);
      return <label className="setting-row" key={key}><span>{label}<small className="help-text">{group ? `${group.files} ไฟล์ · ${size(group.bytes)}` : 'ยังไม่ได้ตรวจขนาด'}</small></span><input type="checkbox" checked={selected.includes(key)} disabled={busy} onChange={e => setSelected(list => e.target.checked ? [...list, key] : list.filter(item => item !== key))} /></label>;
    })}
    <div className="settings-actions"><button type="button" className="btn-action-refresh" disabled={busy} onClick={() => run(false)}>ตรวจไฟล์และขนาด</button><button type="button" className="btn-action-cache" disabled={busy || !preview || !selected.length} onClick={() => {
      if (onRequestConfirm) {
        onRequestConfirm({
          title: 'ยืนยันการล้างไฟล์ FiveM',
          message: `ต้องการลบไฟล์ประเภทที่เลือก (${selected.length} หมวดหมู่) ใช่หรือไม่?`,
          detail: 'ปิด FiveM ทุกหน้าต่างก่อนล้างไฟล์ • ระบบจะเก็บ game-storage และไฟล์ตัวเกมไว้',
          confirmLabel: 'ยืนยันล้างไฟล์',
          tone: 'danger',
          onConfirm: () => run(true)
        });
      } else {
        void run(true);
      }
    }}>{busy ? 'กำลังทำงาน…' : 'ล้างประเภทที่เลือก'}</button></div>
    {result && <div role="status" className={result.success ? 'notice' : 'error-message'}>{result.success ? `ล้างแล้ว ${result.deletedFiles} ไฟล์ · ${size(result.deletedBytes)}` : result.error}{result.steps?.map(step => <small className="help-text" key={step}>{step}</small>)}</div>}
  </section>;
}
