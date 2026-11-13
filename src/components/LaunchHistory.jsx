import React, { useState } from 'react';
import { History, Play, Trash2, X } from 'lucide-react';
import { findHistoryCity, latestHistoryCity, HISTORY_LIMIT } from '../services/launchHistory';
const labels = { preparing: 'กำลังเตรียมเกม', sent: 'ส่งคำสั่งเปิดแล้ว', failed: 'เปิดไม่สำเร็จ', interrupted: 'ไม่ทราบผล — ลันเชอร์หยุดระหว่างทำงาน' };
const date = value => new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
export default function LaunchHistory({ history, servers, busy, onLaunch, onClear, onClose }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const latest = latestHistoryCity(history.entries, servers);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal-dialog library-dialog history-dialog" role="dialog" aria-modal="true" aria-label="ประวัติการเปิดเกม" onClick={event => event.stopPropagation()}>
    <div className="modal-header"><div><span className="eyebrow">RECENT LAUNCHES</span><h2>ประวัติการเปิดเกม</h2></div><button className="modal-close-btn" onClick={onClose} aria-label="ปิด"><X size={20} /></button></div>
    <div className="modal-body">
      <p className="help-text">เก็บล่าสุด {HISTORY_LIMIT} ครั้งในเครื่องนี้ • “ส่งคำสั่งเปิดแล้ว” ยังไม่ยืนยันว่าเข้าเมืองสำเร็จ</p>
      {history.error && <p role="alert" className="error-message">{history.error}</p>}
      {latest && <div className="history-latest"><div><span className="eyebrow">เมืองล่าสุด</span><strong>{latest.name}</strong></div><button className="soft-button" disabled={busy} onClick={() => onLaunch(latest)}><Play size={16} />เข้าเมืองล่าสุด</button></div>}
      {!history.entries.length ? <div className="history-empty"><History size={32} /><h3>ยังไม่มีประวัติการเปิดเกม</h3><p>เมื่อกดเข้าเมือง ผลการเปิดเกมจะแสดงที่นี่</p></div> : <ol className="launch-history-list">{history.entries.map(entry => {
        const current = findHistoryCity(entry, servers);
        return <li className="launch-history-entry" key={entry.id}>
          <div className="history-entry-top"><strong>{entry.city.name}</strong><time dateTime={entry.startedAt}>{date(entry.startedAt)}</time></div>
          <small className="history-endpoint">{entry.city.ip} · {entry.city.cl2 ? 'CL2' : 'PLAY'}</small>
          <div className="history-entry-bottom"><span className={`history-result ${entry.status}`}>{labels[entry.status]}</span><button className="quiet-button" disabled={busy || !current} aria-label={`เปิด ${entry.city.name} อีกครั้ง`} onClick={() => current && onLaunch(current)}><Play size={13} />เปิดอีกครั้ง</button></div>
          {entry.error && <p className="history-error">{entry.error}</p>}
          {!current && <small className="help-text">เมืองถูกลบหรือเปลี่ยนที่อยู่แล้ว กรุณาเลือกจากเมืองของฉัน</small>}
        </li>;
      })}</ol>}
      {!!history.entries.length && <div className="history-clear">{confirmClear ? <><span>ล้างประวัติทั้งหมด? รายชื่อเมืองยังอยู่ครบ</span><button className="quiet-button" disabled={busy} onClick={() => setConfirmClear(false)}>ยกเลิก</button><button className="btn-action-cache" disabled={busy} onClick={() => { onClear(); setConfirmClear(false); }}>ยืนยันล้างประวัติ</button></> : <button className="quiet-button" disabled={busy} onClick={() => setConfirmClear(true)}><Trash2 size={14} />ล้างประวัติ</button>}</div>}
    </div>
  </section></div>;
}
