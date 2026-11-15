import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  Settings2,
  Trash2,
  X
} from 'lucide-react';
import { isTauriDesktop } from '../services/desktopBridge';
import { formatShotBytes, formatShotTimestamp, normalizeScreenshotHotkey } from '../services/screenshotService';

export default function ScreenshotsGallery({
  settings,
  captureVersion = 0,
  onOpenSettings,
  onRequestConfirm,
  onNotify
}) {
  const desktop = isTauriDesktop();
  const hotkey = normalizeScreenshotHotkey(settings?.screenshotHotkey);
  const enabled = settings?.screenshotEnabled !== false;
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const [thumbs, setThumbs] = useState({});
  const [copiedFile, setCopiedFile] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [fullImageUrl, setFullImageUrl] = useState('');
  const [fullLoading, setFullLoading] = useState(false);
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;

  const loadList = useCallback(async () => {
    if (!desktop || !window.estraWindow?.listScreenshots) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await window.estraWindow.listScreenshots(settings?.screenshotDir || null);
      setFolder(res?.folder || '');
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message || 'ไม่สามารถโหลดคลังภาพหน้าจอได้');
    } finally {
      setLoading(false);
    }
  }, [desktop, settings?.screenshotDir]);

  useEffect(() => {
    void loadList();
  }, [loadList, captureVersion]);

  useEffect(() => {
    if (!desktop || !window.estraWindow?.readScreenshotDataUrl || items.length === 0) return;
    let active = true;
    const queue = items.filter(item => {
      const key = `${item.path}:${item.sizeBytes}`;
      return !thumbsRef.current[key];
    });
    if (queue.length === 0) return;

    const run = async () => {
      for (const item of queue) {
        if (!active) return;
        const key = `${item.path}:${item.sizeBytes}`;
        try {
          const url = await window.estraWindow.readScreenshotDataUrl(
            item.filename,
            560,
            settings?.screenshotDir || null
          );
          if (active && url) {
            setThumbs(prev => (prev[key] ? prev : { ...prev, [key]: url }));
          }
        } catch {}
      }
    };
    void run();
    return () => { active = false; };
  }, [desktop, items, settings?.screenshotDir]);

  const activeItem = activeIndex >= 0 && activeIndex < items.length ? items[activeIndex] : null;

  useEffect(() => {
    if (!activeItem || !desktop || !window.estraWindow?.readScreenshotDataUrl) {
      setFullImageUrl('');
      setFullLoading(false);
      return;
    }
    let active = true;
    setFullLoading(true);
    setFullImageUrl('');
    void window.estraWindow
      .readScreenshotDataUrl(activeItem.filename, null, settings?.screenshotDir || null)
      .then(url => {
        if (active) setFullImageUrl(url || '');
      })
      .catch(() => {})
      .finally(() => {
        if (active) setFullLoading(false);
      });
    return () => { active = false; };
  }, [activeItem?.filename, desktop, settings?.screenshotDir]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        setActiveIndex(-1);
      } else if (e.key === 'ArrowLeft') {
        setActiveIndex(i => (i > 0 ? i - 1 : i));
      } else if (e.key === 'ArrowRight') {
        setActiveIndex(i => (i < items.length - 1 ? i + 1 : i));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, items.length]);

  const handleCaptureNow = async () => {
    if (!desktop || !window.estraWindow?.captureScreenshot || capturing) return;
    setCapturing(true);
    setError('');
    try {
      await window.estraWindow.captureScreenshot();
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'จับภาพหน้าจอไม่สำเร็จ';
      setError(msg);
      onNotify?.(msg, 'error');
    } finally {
      setCapturing(false);
    }
  };

  const handleOpenFolder = async () => {
    if (!desktop || !window.estraWindow?.openScreenshotsFolder) return;
    try {
      const opened = await window.estraWindow.openScreenshotsFolder(settings?.screenshotDir || null);
      if (opened) setFolder(opened);
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'ไม่สามารถเปิดโฟลเดอร์เก็บรูปได้';
      setError(msg);
    }
  };

  const handleCopy = async item => {
    if (!desktop || !window.estraWindow?.copyScreenshotToClipboard) return;
    try {
      await window.estraWindow.copyScreenshotToClipboard(item.filename, settings?.screenshotDir || null);
      setCopiedFile(item.filename);
      onNotify?.(`คัดลอก ${item.filename} ลง Clipboard แล้ว (Ctrl+V ส่งใน Discord ได้ทันที)`, 'notice');
      window.setTimeout(() => {
        setCopiedFile(curr => (curr === item.filename ? '' : curr));
      }, 2000);
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'คัดลอกภาพไม่สำเร็จ';
      setError(msg);
      onNotify?.(msg, 'error');
    }
  };

  const handleDelete = item => {
    const performDelete = async () => {
      try {
        await window.estraWindow.deleteScreenshot(item.filename, settings?.screenshotDir || null);
        setItems(prev => prev.filter(x => x.filename !== item.filename));
        setActiveIndex(curr => {
          if (curr < 0) return -1;
          return curr >= items.length - 1 ? items.length - 2 : curr;
        });
        onNotify?.(`ลบภาพ ${item.filename} แล้ว`, 'notice');
      } catch (err) {
        const msg = typeof err === 'string' ? err : err?.message || 'ลบภาพไม่สำเร็จ';
        setError(msg);
      }
    };

    if (onRequestConfirm) {
      onRequestConfirm({
        title: 'ลบภาพหน้าจอ',
        message: `ต้องการลบไฟล์ "${item.filename}" ใช่หรือไม่?`,
        detail: 'ไฟล์รูปภาพนี้จะถูกลบออกจากโฟลเดอร์ในเครื่องถาวร',
        confirmLabel: 'ลบภาพ',
        tone: 'danger',
        onConfirm: performDelete
      });
    } else {
      void performDelete();
    }
  };

  return (
    <section className="subtab-panel screenshots-panel" aria-label="คลังภาพหน้าจอ">
      <div className="subtab-banner screenshots-banner">
        <div className="screenshots-banner-copy">
          <div className="screenshots-eyebrow-row">
            <span className="eyebrow">SCREENSHOTS · STEAM-STYLE CAPTURE</span>
            <span className={`screenshot-hotkey-pill${enabled ? ' active' : ''}`}>
              {enabled ? `กด ${hotkey} เพื่อแคปภาพ` : `คีย์ลัด ${hotkey} ปิดอยู่`}
            </span>
          </div>
          <h2>คลังภาพหน้าจอ ({items.length})</h2>
          <p>
            {folder
              ? `โฟลเดอร์เก็บรูป: ${folder}`
              : settings?.screenshotDir
                ? `โฟลเดอร์เก็บรูป: ${settings.screenshotDir}`
                : 'บันทึกรูปอัตโนมัติลงในโฟลเดอร์ screenshots ของตัวโปรแกรม (เช่นเดียวกับ Steam)'}
          </p>
        </div>

        <div className="screenshots-toolbar">
          <button
            type="button"
            className="btn-action-play"
            disabled={!desktop || capturing}
            onClick={handleCaptureNow}
          >
            <Camera size={15} />
            {capturing ? 'กำลังจับภาพ…' : 'ถ่ายภาพตอนนี้'}
          </button>
          <button
            type="button"
            className="soft-button"
            disabled={!desktop}
            onClick={handleOpenFolder}
          >
            <FolderOpen size={15} />
            เปิดโฟลเดอร์รูป
          </button>
          <button type="button" className="soft-button" onClick={onOpenSettings}>
            <Settings2 size={15} />
            ตั้งค่าคีย์ลัด
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="รีเฟรชคลังภาพ"
            title="รีเฟรชรายการภาพ"
            disabled={!desktop || loading}
            onClick={loadList}
          >
            <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}

      {!desktop ? (
        <div className="screenshots-empty-card">
          <ImageIcon size={32} />
          <h3>คลังภาพหน้าจอรองรับใน Estra Desktop App</h3>
          <p>
            เมื่อใช้งานผ่านโปรแกรม Launcher บน Windows สามารถกด <strong>{hotkey}</strong> ขณะเล่น FiveM หรือบนหน้าจอเพื่อบันทึกภาพลงโฟลเดอร์ของตัวโปรแกรมได้ทันที
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="screenshots-empty-card">
          <Camera size={34} />
          <h3>ยังไม่มีภาพหน้าจอที่บันทึกไว้</h3>
          <p>
            กดปุ่ม <strong>{hotkey}</strong> บนคีย์บอร์ดได้ทุกเมื่อ (ทั้งขณะเล่นเกมใน FiveM หรือใช้งานปกติ) หรือกดปุ่ม "ถ่ายภาพตอนนี้" ด้านบน รูปจะถูกบันทึกไว้ที่นี่อัตโนมัติ
          </p>
          {settings?.screenshotOnlyInGame && (
            <small className="help-text">
              หมายเหตุ: ขณะนี้เปิดโหมด "จับภาพเฉพาะตอนเปิด FiveM อยู่เท่านั้น" ไว้ในการตั้งค่า
            </small>
          )}
        </div>
      ) : (
        <div className="screenshots-grid">
          {items.map((item, idx) => {
            const thumbKey = `${item.path}:${item.sizeBytes}`;
            const thumbSrc = thumbs[thumbKey];
            const isCopied = copiedFile === item.filename;
            return (
              <article key={item.filename} className="screenshot-card">
                <button
                  type="button"
                  className="screenshot-thumb-btn"
                  onClick={() => setActiveIndex(idx)}
                  aria-label={`ดูภาพ ${item.filename}`}
                >
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={item.filename} loading="lazy" />
                  ) : (
                    <div className="screenshot-thumb-placeholder">
                      <ImageIcon size={22} />
                      <span>กำลังโหลดภาพ…</span>
                    </div>
                  )}
                  <span className="screenshot-zoom-hint">
                    <Maximize2 size={13} /> ดูเต็มจอ
                  </span>
                </button>

                <div className="screenshot-card-body">
                  <div className="screenshot-card-meta">
                    <strong title={item.filename}>{item.city_name || item.cityName || 'FiveM Screenshot'}</strong>
                    <small>
                      {formatShotTimestamp(item.createdAt ?? item.created_at)}
                      {' · '}
                      {item.width && item.height ? `${item.width}×${item.height}` : formatShotBytes(item.sizeBytes ?? item.size_bytes)}
                    </small>
                  </div>

                  <div className="screenshot-card-actions">
                    <button
                      type="button"
                      className={`screenshot-action-btn${isCopied ? ' copied' : ''}`}
                      title="คัดลอกรูปเข้า Clipboard เพื่อวางส่งใน Discord"
                      onClick={() => handleCopy(item)}
                    >
                      {isCopied ? <Check size={13} /> : <Copy size={13} />}
                      <span>{isCopied ? 'คัดลอกแล้ว' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      className="screenshot-action-btn danger"
                      title="ลบภาพนี้"
                      aria-label={`ลบภาพ ${item.filename}`}
                      onClick={() => handleDelete(item)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeItem && (
        <div className="modal-backdrop screenshot-lightbox-backdrop" onClick={() => setActiveIndex(-1)}>
          <div
            className="screenshot-lightbox-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={activeItem.filename}
            onClick={e => e.stopPropagation()}
          >
            <div className="screenshot-lightbox-head">
              <div>
                <strong>{activeItem.city_name || activeItem.cityName || 'Estra Screenshot'}</strong>
                <small>
                  {activeItem.filename} · {formatShotTimestamp(activeItem.createdAt ?? activeItem.created_at)} ·{' '}
                  {activeItem.width}×{activeItem.height} ({formatShotBytes(activeItem.sizeBytes ?? activeItem.size_bytes)})
                </small>
              </div>
              <div className="screenshot-lightbox-tools">
                <button type="button" className="btn-inline-cobalt" onClick={() => handleCopy(activeItem)}>
                  {copiedFile === activeItem.filename ? <Check size={14} /> : <Copy size={14} />}
                  {copiedFile === activeItem.filename ? 'คัดลอกแล้ว' : 'คัดลอกรูป (Discord)'}
                </button>
                <button type="button" className="soft-button" onClick={handleOpenFolder}>
                  <FolderOpen size={14} /> เปิดโฟลเดอร์
                </button>
                <button type="button" className="soft-button danger" onClick={() => handleDelete(activeItem)}>
                  <Trash2 size={14} /> ลบ
                </button>
                <button type="button" className="modal-close-btn" onClick={() => setActiveIndex(-1)} aria-label="ปิดภาพตัวอย่าง">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="screenshot-lightbox-stage">
              <button
                type="button"
                className="lightbox-nav-btn prev"
                disabled={activeIndex <= 0}
                onClick={() => setActiveIndex(i => Math.max(0, i - 1))}
                aria-label="ภาพก่อนหน้า"
              >
                <ChevronLeft size={20} />
              </button>

              {fullImageUrl ? (
                <img src={fullImageUrl} alt={activeItem.filename} />
              ) : (
                <div className="screenshot-thumb-placeholder">
                  <RefreshCw size={22} className={fullLoading ? 'spinning' : ''} />
                  <span>กำลังโหลดความละเอียดเต็ม…</span>
                </div>
              )}

              <button
                type="button"
                className="lightbox-nav-btn next"
                disabled={activeIndex >= items.length - 1}
                onClick={() => setActiveIndex(i => Math.min(items.length - 1, i + 1))}
                aria-label="ภาพถัดไป"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
