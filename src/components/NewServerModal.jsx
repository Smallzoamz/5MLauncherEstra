import React, { useState, useEffect } from 'react';
import { parseTarget } from '../shared/target';
export default function NewServerModal({ isOpen, onClose, onAddServer }) {
  const [name, setName] = useState(''), [ip, setIp] = useState(''), [tag, setTag] = useState('Roleplay'), [error, setError] = useState('');
  useEffect(() => { if (isOpen) { setName(''); setIp(''); setTag('Roleplay'); setError(''); } }, [isOpen]);
  if (!isOpen) return null;
  const submit = e => {
    e.preventDefault();
    try {
      if (!name.trim()) throw new Error('กรุณากรอกชื่อเซิร์ฟเวอร์');
      const address = parseTarget(ip).address;
      onAddServer({ id: crypto.randomUUID(), name: name.trim(), ip: address, tag, inGameName: '', cl2: false, status: 'Unknown', onlinePlayers: null, maxPlayers: null, gameBuild: null, lockPure: null, ping: null });
      onClose();
    } catch (err) { setError(err.message); }
  };
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-dialog" role="dialog" aria-modal="true" aria-label="เพิ่มเซิร์ฟเวอร์" onClick={e => e.stopPropagation()}>
    <div className="modal-header"><div className="modal-title">เพิ่มเซิร์ฟเวอร์ใหม่</div><button className="modal-close-btn" onClick={onClose} aria-label="ปิด">✕</button></div>
    <form className="modal-body" onSubmit={submit}>
      <label htmlFor="new-name">ชื่อเซิร์ฟเวอร์</label><div className="input-container"><input autoFocus id="new-name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></div>
      <label htmlFor="new-ip">IP:port / โดเมน / Cfx.re join link</label><div className="input-container"><input id="new-ip" required maxLength={253} placeholder="127.0.0.1:30120 หรือ cfx.re/join/xxxxx" value={ip} onChange={e => setIp(e.target.value)} /></div>
      <label htmlFor="new-tag">หมวดหมู่</label><div className="input-container"><select id="new-tag" value={tag} onChange={e => setTag(e.target.value)}>{['Roleplay', 'Training', 'ไม่มี'].map(t => <option key={t}>{t}</option>)}</select></div>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button className="btn-action-play" type="submit">เพิ่มเซิร์ฟเวอร์</button>
    </form>
  </div></div>;
}

