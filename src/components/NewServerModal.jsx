import React, { useState, useEffect, useMemo } from 'react';
import { DatabaseZap, Info } from 'lucide-react';
import { parseTarget } from '../shared/target';
import { lookupDirectoryServer } from '../shared/serverDirectory';

export default function NewServerModal({ isOpen, onClose, onAddServer, directory = [] }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [tag, setTag] = useState('Roleplay');
  const [manualNameEdited, setManualNameEdited] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
      setIp('');
      setTag('Roleplay');
      setManualNameEdited(false);
      setError('');
    }
  }, [isOpen]);

  const matchedEntry = useMemo(() => lookupDirectoryServer(ip, directory), [ip, directory]);
  const connectPreview = useMemo(() => {
    const trimmed = ip.trim();
    if (!/^(?:[+/]?connect\s+)/i.test(trimmed)) return '';
    try {
      return parseTarget(trimmed).address;
    } catch {
      return '';
    }
  }, [ip]);

  if (!isOpen) return null;

  const handleIpChange = nextIp => {
    setIp(nextIp);
    setError('');
    const matched = lookupDirectoryServer(nextIp, directory);
    if (matched) {
      setName(matched.name);
      setTag(matched.tag || 'Roleplay');
      setManualNameEdited(false);
    } else if (!manualNameEdited && matchedEntry) {
      setName('');
    }
  };

  const submit = e => {
    e.preventDefault();
    try {
      const parsed = parseTarget(ip);
      const directoryMatch = lookupDirectoryServer(parsed.address, directory);
      const resolvedName = directoryMatch ? directoryMatch.name : name.trim();
      if (!resolvedName) throw new Error('กรุณากรอกชื่อเซิร์ฟเวอร์');
      onAddServer({
        id: crypto.randomUUID(),
        name: resolvedName,
        ip: parsed.address,
        tag: directoryMatch?.tag || tag,
        patchManifestUrl: directoryMatch?.patchManifestUrl || '',
        customBannerUrl: directoryMatch?.customBannerUrl || '',
        directorySlug: directoryMatch?.slug || '',
        inGameName: '',
        cl2: false,
        status: 'Unknown',
        onlinePlayers: null,
        maxPlayers: null,
        gameBuild: null,
        lockPure: null,
        ping: null
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label="เพิ่มเซิร์ฟเวอร์" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">เพิ่มเซิร์ฟเวอร์ใหม่</div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="ปิด">✕</button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          <label htmlFor="new-ip">IP:port / โดเมน / Cfx.re / คำสั่ง connect</label>
          <div className="input-container">
            <input
              autoFocus
              id="new-ip"
              required
              maxLength={300}
              placeholder="127.0.0.1:30120, cfx.re/join/xxxxx หรือ connect 127.0.0.1"
              value={ip}
              onChange={e => handleIpChange(e.target.value)}
            />
          </div>

          {connectPreview && (
            <div className="directory-hint-pill info" role="status">
              <Info size={14} />
              <span>ตรวจพบคำสั่ง <code>connect</code> — จะบันทึกเป็น <b>{connectPreview}</b></span>
            </div>
          )}

          {matchedEntry && (
            <div className="directory-hint-pill matched" role="status">
              <DatabaseZap size={14} />
              <span>พบในสารบัญเซิร์ฟเวอร์กลาง — ใช้ชื่อกลางอัตโนมัติ: <b>{matchedEntry.name}</b></span>
            </div>
          )}

          <label htmlFor="new-name">
            ชื่อเซิร์ฟเวอร์ {matchedEntry ? '(ชื่อกลางจากสารบัญ)' : ''}
          </label>
          <div className="input-container">
            <input
              id="new-name"
              required
              maxLength={100}
              readOnly={Boolean(matchedEntry)}
              placeholder={matchedEntry ? matchedEntry.name : 'กรอกชื่อเมืองหรือวาง IP เพื่อดึงชื่อกลางอัตโนมัติ'}
              value={matchedEntry ? matchedEntry.name : name}
              onChange={e => {
                if (matchedEntry) return;
                setName(e.target.value);
                setManualNameEdited(true);
              }}
            />
          </div>

          <label htmlFor="new-tag">หมวดหมู่</label>
          <div className="input-container">
            <select
              id="new-tag"
              value={matchedEntry?.tag || tag}
              disabled={Boolean(matchedEntry)}
              onChange={e => setTag(e.target.value)}
            >
              {['Roleplay', 'Training', 'ไม่มี'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {error && <p role="alert" className="error-message">{error}</p>}
          <button className="btn-action-play" type="submit">เพิ่มเซิร์ฟเวอร์</button>
        </form>
      </div>
    </div>
  );
}
