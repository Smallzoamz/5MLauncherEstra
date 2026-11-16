import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DatabaseZap, Globe, Info, Loader2, AlertTriangle } from 'lucide-react';
import { parseTarget } from '../shared/target';
import { lookupDirectoryServer, pickFetchedServerName } from '../shared/serverDirectory';
import { CATEGORY_TAGS, DEFAULT_SERVER_TAG, normalizeServerTag } from '../shared/serverTags';
import { queryServerInfo } from '../services/fivemService';

function parseTargetSafe(raw) {
  try {
    return parseTarget(raw);
  } catch {
    return null;
  }
}

function canAutoLookupTarget(parsed) {
  if (!parsed) return false;
  if (parsed.kind === 'join') return true;
  return parsed.host === 'localhost' || parsed.host.includes('.');
}

export default function NewServerModal({ isOpen, onClose, onAddServer, directory = [] }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [tag, setTag] = useState(DEFAULT_SERVER_TAG);
  const [manualNameEdited, setManualNameEdited] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupHint, setLookupHint] = useState(null); // { tone: 'matched'|'info'|'warn', address: string, text: string }
  const [error, setError] = useState('');

  const manualNameEditedRef = useRef(false);
  const currentAddressRef = useRef('');
  const fetchedCacheRef = useRef(new Map());
  const inFlightRef = useRef(new Map());
  const abortControllersRef = useRef(new Map());
  const nameInputRef = useRef(null);

  const abortAllLookups = useCallback(() => {
    for (const ctrl of abortControllersRef.current.values()) ctrl.abort();
    abortControllersRef.current.clear();
    inFlightRef.current.clear();
  }, []);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setIp('');
      setTag(DEFAULT_SERVER_TAG);
      setManualNameEdited(false);
      manualNameEditedRef.current = false;
      currentAddressRef.current = '';
      setLookingUp(false);
      setLookupHint(null);
      setError('');
      fetchedCacheRef.current.clear();
      abortAllLookups();
    } else {
      abortAllLookups();
    }
  }, [isOpen, abortAllLookups]);

  const parsedTarget = useMemo(() => parseTargetSafe(ip), [ip]);
  const parsedAddress = parsedTarget?.address || '';
  const matchedEntry = useMemo(() => lookupDirectoryServer(ip, directory), [ip, directory]);
  const connectPreview = useMemo(() => {
    const trimmed = ip.trim();
    if (!/^(?:[+/]?connect\s+)/i.test(trimmed)) return '';
    return parsedAddress;
  }, [ip, parsedAddress]);

  const lookupServerNameOnce = useCallback(async targetAddress => {
    if (!targetAddress) return { name: '', error: '' };
    if (fetchedCacheRef.current.has(targetAddress)) {
      return fetchedCacheRef.current.get(targetAddress);
    }
    if (inFlightRef.current.has(targetAddress)) {
      return inFlightRef.current.get(targetAddress);
    }

    const controller = new AbortController();
    abortControllersRef.current.set(targetAddress, controller);

    const promise = (async () => {
      try {
        const result = await queryServerInfo({ ip: targetAddress }, controller.signal);
        if (controller.signal.aborted) return { name: '', error: '', aborted: true };
        const pickedName = result?.online ? pickFetchedServerName(result, targetAddress) : '';
        const entry = {
          name: pickedName,
          error: pickedName ? '' : (result?.error || 'เซิร์ฟเวอร์ไม่ตอบกลับหรือไม่ได้ระบุชื่อเซิร์ฟเวอร์')
        };
        fetchedCacheRef.current.set(targetAddress, entry);
        return entry;
      } catch (err) {
        if (controller.signal.aborted) return { name: '', error: '', aborted: true };
        const entry = { name: '', error: err?.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' };
        fetchedCacheRef.current.set(targetAddress, entry);
        return entry;
      } finally {
        abortControllersRef.current.delete(targetAddress);
        inFlightRef.current.delete(targetAddress);
      }
    })();

    inFlightRef.current.set(targetAddress, promise);
    return promise;
  }, []);

  useEffect(() => {
    currentAddressRef.current = parsedAddress;
    if (!isOpen || matchedEntry || !canAutoLookupTarget(parsedTarget)) {
      setLookingUp(false);
      setLookupHint(null);
      return;
    }

    const cached = fetchedCacheRef.current.get(parsedAddress);
    if (cached) {
      setLookingUp(false);
      if (cached.name) {
        if (!manualNameEditedRef.current) setName(cached.name);
        setLookupHint({
          tone: 'matched',
          address: parsedAddress,
          text: `ดึงชื่อเซิร์ฟเวอร์ครั้งแรกสำเร็จ: ${cached.name} (แก้ไขได้ — อัปเดตตามเมื่อเซิร์ฟเปลี่ยนชื่อ)`
        });
      } else {
        setLookupHint({
          tone: 'warn',
          address: parsedAddress,
          text: 'ดึงชื่อจาก IP ไม่สำเร็จอัตโนมัติ (เซิร์ฟอาจปิดอยู่) — กรอกชื่อเซิร์ฟเวอร์เองได้เลย'
        });
      }
      return;
    }

    let cancelled = false;
    setLookingUp(true);
    setLookupHint({
      tone: 'info',
      address: parsedAddress,
      text: `กำลังดึงชื่อเซิร์ฟเวอร์ครั้งแรกจาก ${parsedAddress}...`
    });

    const timer = setTimeout(async () => {
      const outcome = await lookupServerNameOnce(parsedAddress);
      if (cancelled || outcome.aborted || currentAddressRef.current !== parsedAddress) return;
      setLookingUp(false);
      if (outcome.name) {
        if (!manualNameEditedRef.current) setName(outcome.name);
        setLookupHint({
          tone: 'matched',
          address: parsedAddress,
          text: `ดึงชื่อเซิร์ฟเวอร์ครั้งแรกสำเร็จ: ${outcome.name} (แก้ไขได้ — อัปเดตตามเมื่อเซิร์ฟเปลี่ยนชื่อ)`
        });
      } else {
        setLookupHint({
          tone: 'warn',
          address: parsedAddress,
          text: 'ดึงชื่อจาก IP ไม่สำเร็จอัตโนมัติ (เซิร์ฟอาจปิดอยู่) — กรอกชื่อเซิร์ฟเวอร์เองได้เลย'
        });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, matchedEntry, parsedTarget, parsedAddress, lookupServerNameOnce]);

  if (!isOpen) return null;

  const handleIpChange = nextIp => {
    setIp(nextIp);
    setError('');
    const matched = lookupDirectoryServer(nextIp, directory);
    if (matched) {
      setName(matched.name);
      setTag(normalizeServerTag(matched.tag, DEFAULT_SERVER_TAG));
      setManualNameEdited(false);
      manualNameEditedRef.current = false;
    } else if (!manualNameEditedRef.current) {
      const nextParsed = parseTargetSafe(nextIp);
      const nextCached = nextParsed ? fetchedCacheRef.current.get(nextParsed.address) : null;
      setName(nextCached?.name || '');
    }
  };

  const submit = async e => {
    e.preventDefault();
    try {
      const parsed = parseTarget(ip);
      const directoryMatch = lookupDirectoryServer(parsed.address, directory);
      let resolvedName = directoryMatch ? directoryMatch.name : name.trim();

      if (!directoryMatch && !resolvedName && !manualNameEditedRef.current) {
        setLookingUp(true);
        setLookupHint({
          tone: 'info',
          address: parsed.address,
          text: `กำลังดึงชื่อเซิร์ฟเวอร์ครั้งแรกจาก ${parsed.address}...`
        });
        const outcome = await lookupServerNameOnce(parsed.address);
        setLookingUp(false);
        if (outcome.name) {
          resolvedName = outcome.name;
          setName(outcome.name);
        } else {
          setLookupHint({
            tone: 'warn',
            address: parsed.address,
            text: 'ดึงชื่อจาก IP ไม่สำเร็จอัตโนมัติ — กรุณากรอกชื่อเซิร์ฟเวอร์เอง'
          });
          nameInputRef.current?.focus();
        }
      }

      if (!resolvedName) throw new Error('กรุณากรอกชื่อเซิร์ฟเวอร์');
      const cachedFetchedName = directoryMatch
        ? ''
        : (fetchedCacheRef.current.get(parsed.address)?.name || '');
      onAddServer({
        id: crypto.randomUUID(),
        name: resolvedName,
        lastFetchedName: cachedFetchedName,
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

          {!matchedEntry && lookupHint && lookupHint.address === parsedAddress && (
            <div className={`directory-hint-pill ${lookupHint.tone}`} role="status">
              {lookingUp ? (
                <Loader2 size={14} className="spin" />
              ) : lookupHint.tone === 'warn' ? (
                <AlertTriangle size={14} />
              ) : (
                <Globe size={14} />
              )}
              <span>{lookupHint.text}</span>
            </div>
          )}

          <label htmlFor="new-name">
            ชื่อเซิร์ฟเวอร์ {matchedEntry ? '(ชื่อกลางจากสารบัญ)' : '(ดึงให้อัตโนมัติเมื่อใส่ IP และอัปเดตตามเมื่อเซิร์ฟเปลี่ยนชื่อ)'}
          </label>
          <div className="input-container">
            <input
              ref={nameInputRef}
              id="new-name"
              maxLength={100}
              readOnly={Boolean(matchedEntry)}
              placeholder={matchedEntry ? matchedEntry.name : lookingUp ? 'กำลังดึงชื่อจากเซิร์ฟเวอร์...' : 'วาง IP เพื่อดึงชื่อเซิร์ฟอัตโนมัติ หรือพิมพ์ชื่อเอง'}
              value={matchedEntry ? matchedEntry.name : name}
              onChange={e => {
                if (matchedEntry) return;
                setName(e.target.value);
                setManualNameEdited(true);
                manualNameEditedRef.current = true;
              }}
            />
          </div>

          <label htmlFor="new-tag">หมวดหมู่</label>
          <div className="input-container">
            <select
              id="new-tag"
              value={normalizeServerTag(matchedEntry?.tag || tag, DEFAULT_SERVER_TAG)}
              disabled={Boolean(matchedEntry)}
              onChange={e => setTag(e.target.value)}
            >
              {[...CATEGORY_TAGS, 'ไม่มี'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {error && <p role="alert" className="error-message">{error}</p>}
          <button className="btn-action-play" type="submit" disabled={lookingUp && !name.trim()}>
            {lookingUp && !name.trim() ? 'กำลังดึงชื่อเซิร์ฟเวอร์...' : 'เพิ่มเซิร์ฟเวอร์'}
          </button>
        </form>
      </div>
    </div>
  );
}
