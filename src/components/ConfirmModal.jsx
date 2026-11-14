import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';

export default function ConfirmModal({
  isOpen,
  title = 'ยืนยันการทำรายการ',
  message = '',
  detail = '',
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  tone = 'danger',
  onConfirm,
  onCancel
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setBusy(false);
      setError('');
      return;
    }
    setError('');
    cancelBtnRef.current?.focus();
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onCancel?.();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm?.();
      onCancel?.();
    } catch (err) {
      setError(err?.message || 'ดำเนินการไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onClick={() => {
        if (!busy) onCancel?.();
      }}
    >
      <section
        className="modal-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="confirm-modal-title">
            <span className={`confirm-modal-icon ${tone === 'danger' ? 'danger' : 'primary'}`}>
              {tone === 'danger' ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
            </span>
            <span>{title}</span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            disabled={busy}
            onClick={() => !busy && onCancel?.()}
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body confirm-modal-body">
          <p id="confirm-modal-message" className="confirm-modal-message">{message}</p>
          {detail && <small className="help-text">{detail}</small>}
          {error && <p role="alert" className="error-message">{error}</p>}
          <div className="settings-actions confirm-modal-actions">
            <button
              ref={cancelBtnRef}
              type="button"
              className="btn-action-refresh"
              disabled={busy}
              onClick={() => !busy && onCancel?.()}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={tone === 'danger' ? 'btn-danger-solid' : 'btn-action-play'}
              disabled={busy}
              onClick={handleConfirm}
            >
              {busy ? 'กำลังดำเนินการ…' : confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
