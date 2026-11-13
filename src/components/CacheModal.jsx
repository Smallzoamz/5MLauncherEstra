import React, { useState, useEffect } from 'react';
import { cleanRealCache } from '../services/fivemService';
export default function CacheModal({ isOpen, onClose, settings }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (isOpen) setResult(null); }, [isOpen]);
  if (!isOpen) return null;
  const clean = async () => {
    setBusy(true); setResult(null);
    setResult(await cleanRealCache(settings)); setBusy(false);
  };
  return <div className="modal-backdrop" onClick={() => !busy && onClose()}>
    <div className="modal-dialog" role="dialog" aria-modal="true" aria-label="ล้างแคช FiveM" onClick={e => e.stopPropagation()}>
      <div className="modal-header"><div className="modal-title">ล้างแคช FiveM</div><button className="modal-close-btn" disabled={busy} onClick={onClose} aria-label="ปิด">✕</button></div>
      <div className="modal-body" aria-busy={busy}>
        <p>กรุณาปิด FiveM ทุกหน้าต่างก่อน ระบบจะลบเฉพาะ server-cache, server-cache-priv และ cache/subprocess จากพาธในการตั้งค่า โดยเก็บ game-storage ไว้</p>
        <p className="help-text">พาธ: {settings.fivemPath || '%LOCALAPPDATA%\\FiveM (ตรวจหาอัตโนมัติ)'}</p>
        {busy && <p role="status">กำลังตรวจสอบและล้างแคช กรุณารอผล…</p>}
        {result && <div role="status" className={result.success ? 'notice' : 'error-message'}>
          <p>{result.success ? 'ล้างแคชเสร็จแล้ว' : result.error}</p>
          {result.steps?.map(step => <p key={step}>{step}</p>)}
        </div>}
        <button className="btn-action-cache" onClick={clean} disabled={busy}>{busy ? 'กำลังทำงาน…' : 'ยืนยันล้างแคช'}</button>
      </div>
    </div>
  </div>;
}

