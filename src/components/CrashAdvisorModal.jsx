import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  FileWarning,
  RefreshCw,
  ShieldAlert,
  Wrench,
  X
} from 'lucide-react';
import {
  CRASH_SEVERITY_META,
  copyCrashTicketReport,
  formatBytesCompact
} from '../services/crashAnalyzerService';

function formatTimeTh(ms) {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString('th-TH', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '-';
  }
}

export function CrashAdvisorContent({
  report,
  scanning = false,
  actionBusyId = '',
  actionFeedback = null,
  onRescan,
  onRunFix,
  onNotify
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyTicket = async () => {
    if (!report?.discordTicketText) return;
    try {
      await copyCrashTicketReport(report.discordTicketText);
      setCopied(true);
      onNotify?.('คัดลอกรายงานสำหรับ Discord Ticket แล้ว', 'notice');
      window.setTimeout(() => setCopied(false), 2200);
    } catch (err) {
      onNotify?.(err?.message || 'คัดลอกรายงานไม่สำเร็จ', 'error');
    }
  };

  if (!report && !scanning) {
    return (
      <div className="diag-empty-box">
        <FileWarning size={22} />
        <div>
          <strong>ยังไม่ได้สแกนไฟล์ Log / Crash ของ FiveM</strong>
          <p className="help-text">
            กดปุ่มสแกนเพื่อตรวจวิเคราะห์ CitizenFX_log และโฟลเดอร์ crashes ล่าสุด พร้อมแนะนำวิธีแก้ทันที
          </p>
        </div>
        <button type="button" className="btn-action-play" onClick={() => onRescan?.()}>
          <RefreshCw size={14} /> สแกน Crash ล่าสุด
        </button>
      </div>
    );
  }

  const meta = CRASH_SEVERITY_META[report?.severity] || CRASH_SEVERITY_META.info;
  const isClean = !report?.hasCrash;

  return (
    <div className="crash-advisor-body">
      <div className={`crash-hero-banner tone-${meta.tone}`}>
        <div className="crash-hero-icon">
          {isClean ? (
            <CheckCircle2 size={22} />
          ) : report?.severity === 'critical' ? (
            <ShieldAlert size={22} />
          ) : (
            <AlertTriangle size={22} />
          )}
        </div>
        <div className="crash-hero-copy">
          <div className="crash-badge-row">
            <span className={`diag-pill tone-${meta.tone}`}>{meta.label}</span>
            {report?.code && <code className="crash-code-tag">{report.code}</code>}
            {report?.isRecentSessionCrash && (
              <span className="diag-pill tone-danger">ตรวจพบหลังเกมเพิ่งปิด</span>
            )}
          </div>
          <h4>{scanning ? 'กำลังวิเคราะห์ไฟล์ Crash และ CitizenFX_log…' : report?.title}</h4>
          <p>{report?.summary}</p>
        </div>
      </div>

      <div className="crash-meta-strip">
        <div>
          <span>CRASH DUMP ล่าสุด</span>
          <strong>
            {report?.latestCrashFile
              ? `${report.latestCrashFile.name} (${formatBytesCompact(report.latestCrashFile.sizeBytes)})`
              : 'ไม่พบไฟล์'}
          </strong>
          {report?.latestCrashFile?.modifiedAtMs ? (
            <small>{formatTimeTh(report.latestCrashFile.modifiedAtMs)}</small>
          ) : null}
        </div>
        <div>
          <span>CITIZENFX LOG ล่าสุด</span>
          <strong>{report?.latestLogFile ? report.latestLogFile.name : 'ไม่พบไฟล์'}</strong>
          {report?.latestLogFile?.modifiedAtMs ? (
            <small>{formatTimeTh(report.latestLogFile.modifiedAtMs)}</small>
          ) : null}
        </div>
      </div>

      {report?.fixes?.length > 0 && (
        <div className="crash-fixes-section">
          <div className="crash-section-head">
            <span>
              <Wrench size={14} /> วิธีแก้แนะนำ (Auto-Fix 1 คลิก)
            </span>
          </div>
          <div className="crash-fix-list">
            {report.fixes.map(fix => {
              const isBusy = actionBusyId === fix.id;
              return (
                <div key={fix.id} className={`crash-fix-card${fix.primary ? ' is-primary' : ''}`}>
                  <div>
                    <strong>{fix.label}</strong>
                    <p>{fix.description}</p>
                  </div>
                  <button
                    type="button"
                    className={fix.primary ? 'btn-action-play' : 'soft-button'}
                    disabled={Boolean(actionBusyId) || scanning}
                    onClick={() => onRunFix?.(fix.id)}
                  >
                    {isBusy ? 'กำลังแก้…' : 'แก้ทันที'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {actionFeedback && (
        <p
          className={actionFeedback.tone === 'error' ? 'error-message' : 'notice'}
          role={actionFeedback.tone === 'error' ? 'alert' : 'status'}
        >
          {actionFeedback.message}
        </p>
      )}

      {report?.evidenceLines?.length > 0 && (
        <details className="crash-evidence-box">
          <summary>ดูหลักฐานจาก Log ล่าสุด ({report.evidenceLines.length} บรรทัด · ซ่อนข้อมูลส่วนตัวแล้ว)</summary>
          <pre className="crash-evidence-pre">{report.evidenceLines.join('\n')}</pre>
        </details>
      )}

      <div className="crash-footer-actions">
        <button
          type="button"
          className="soft-button"
          disabled={scanning || Boolean(actionBusyId)}
          onClick={() => onRescan?.()}
        >
          <RefreshCw size={14} className={scanning ? 'spin' : ''} /> สแกนซ้ำ
        </button>
        {report?.discordTicketText && (
          <button
            type="button"
            className="soft-button"
            disabled={scanning}
            onClick={handleCopyTicket}
          >
            <ClipboardCopy size={14} />
            {copied ? 'คัดลอกแล้ว!' : 'คัดลอกรายงานส่ง Discord Ticket'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CrashAdvisorModal({
  isOpen,
  onClose,
  report,
  scanning,
  actionBusyId,
  actionFeedback,
  onRescan,
  onRunFix,
  onNotify
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => !actionBusyId && onClose?.()}>
      <div
        className="modal-dialog modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Crash Log Analyzer & Auto-Fix Advisor"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head-row">
          <div>
            <span className="eyebrow">CRASH LOG ANALYZER &amp; AUTO-FIX</span>
            <h3>วิเคราะห์สาเหตุเกมเด้งอัตโนมัติ</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="ปิดหน้าต่างวิเคราะห์ Crash"
            disabled={Boolean(actionBusyId)}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <CrashAdvisorContent
          report={report}
          scanning={scanning}
          actionBusyId={actionBusyId}
          actionFeedback={actionFeedback}
          onRescan={onRescan}
          onRunFix={onRunFix}
          onNotify={onNotify}
        />
      </div>
    </div>
  );
}
