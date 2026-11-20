import React from 'react';
import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  Gauge,
  HardDrive,
  Monitor,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles
} from 'lucide-react';

function ScoreBars({ label, score = 0, tone = 'cobalt' }) {
  return (
    <div className="perf-score-row">
      <span>{label}</span>
      <div className="perf-score-bars" aria-label={`${label} ${score}/5`}>
        {[1, 2, 3, 4, 5].map(n => (
          <i key={n} className={n <= score ? `filled tone-${tone}` : ''} />
        ))}
      </div>
    </div>
  );
}

function formatVram(hw) {
  if (!hw) return '—';
  const vramMb = Number(hw.vramMb || 0);
  if (vramMb >= 1024) {
    const gb = vramMb / 1024;
    const nearest = Math.round(gb);
    const label = Math.abs(gb - nearest) <= 0.15 ? String(nearest) : gb.toFixed(1);
    return `${label} GB VRAM`;
  }
  if (vramMb > 0) {
    return `${vramMb} MB VRAM${hw.isIntegrated ? ' (iGPU)' : ''}`;
  }
  return hw.isIntegrated ? 'Integrated GPU' : '—';
}

function getTierTone(tier) {
  switch (tier) {
    case 'high':
      return 'tone-emerald';
    case 'mid':
      return 'tone-cobalt';
    case 'entry':
      return 'tone-amber';
    default:
      return 'tone-red';
  }
}

export default function PerfPresetsPanel({
  perfState,
  busy = false,
  fivemRunning = false,
  onRefresh,
  onApplyPreset,
  onRestoreBackup,
  onOpenFolder,
  onRequestConfirm
}) {
  const presets = perfState?.presets || [];
  const current = perfState?.current || null;
  const hardware = perfState?.hardware || null;

  const handleRestoreClick = () => {
    const run = () => onRestoreBackup?.();
    if (onRequestConfirm) {
      onRequestConfirm({
        title: 'คืนค่ากราฟิก GTA V เดิม?',
        message: 'ระบบจะนำไฟล์สำรอง settings.xml เดิมก่อนปรับพรีเซ็ตกลับมาแทนที่ค่าปัจจุบัน',
        confirmLabel: 'คืนค่าเดิม',
        tone: 'cobalt',
        onConfirm: run
      });
    } else {
      run();
    }
  };

  return (
    <section className="diag-panel" aria-label="Game Performance Setting Presets 1 คลิก">
      <div className="diag-panel-header">
        <div>
          <span className="eyebrow">ADAPTIVE GAME PERFORMANCE PRESETS · 1-CLICK</span>
          <h3>ปรับกราฟิก FiveM / GTA V อัตโนมัติตามสเปกเครื่อง (3 พรีเซ็ต)</h3>
          <p className="help-text">
            ลันเชอร์ตรวจจับการ์ดจอ VRAM, RAM และ CPU ของเครื่องคุณแล้วคำนวณ 3 พรีเซ็ตให้เหมาะกับกำลังเครื่องจริง โดยคงความละเอียดจอและโหมดหน้าจอเดิมไว้ 100% พร้อมสำรองค่าเดิมอัตโนมัติ
          </p>
        </div>
        <div className="diag-header-actions">
          <button type="button" className="soft-button" disabled={busy} onClick={() => onRefresh?.()}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> รีเฟรช
          </button>
          {perfState?.found && (
            <button type="button" className="soft-button" disabled={busy} onClick={() => onOpenFolder?.()}>
              <FolderOpen size={14} /> เปิดโฟลเดอร์
            </button>
          )}
          {perfState?.hasBackup && (
            <button
              type="button"
              className="soft-button"
              disabled={busy || fivemRunning}
              onClick={handleRestoreClick}
            >
              <RotateCcw size={14} /> คืนค่าเดิมของฉัน
            </button>
          )}
        </div>
      </div>

      {hardware && (
        <div className={`perf-hardware-card tier-${hardware.tier || 'entry'}`}>
          <div className="perf-hardware-head">
            <div className="perf-hardware-title">
              <span className={`diag-pill ${getTierTone(hardware.tier)}`}>
                {hardware.tierLabel}
              </span>
              <strong>สเปกเครื่องที่ตรวจพบ · ปรับจูน 3 พรีเซ็ตให้เฉพาะเครื่องนี้แล้ว</strong>
            </div>
            <p className="help-text">{hardware.tierSummary}</p>
          </div>
          <div className="perf-hardware-specs">
            <div>
              <span><Monitor size={12} /> การ์ดจอ (GPU)</span>
              <strong>{hardware.gpuName || 'Unknown GPU'} · {formatVram(hardware)}</strong>
            </div>
            <div>
              <span><HardDrive size={12} /> หน่วยความจำ (RAM)</span>
              <strong>{hardware.ramGb || 0} GB</strong>
            </div>
            <div>
              <span><Cpu size={12} /> ซีพียู (Threads)</span>
              <strong>{hardware.cpuCores || 0} Threads</strong>
            </div>
          </div>
        </div>
      )}

      {fivemRunning && (
        <div className="diag-banner tone-amber" role="status">
          <ShieldAlert size={16} />
          <span>FiveM / GTA V กำลังทำงานอยู่ — กรุณาปิดเกมก่อนกดเปลี่ยนพรีเซ็ตเพื่อไม่ให้เกมเขียนทับค่าเดิม</span>
        </div>
      )}

      {!perfState ? (
        <div className="diag-empty-box">
          <Gauge size={22} />
          <div>
            <strong>ยังไม่สามารถอ่านไฟล์ settings.xml ของ GTA V</strong>
            <p className="help-text">ฟีเจอร์ปรับกราฟิก 1 คลิกทำงานบน Estra Desktop (Tauri) — กดรีเฟรชเพื่อตรวจสอบอีกครั้ง</p>
          </div>
        </div>
      ) : !perfState.found ? (
        <div className="diag-empty-box">
          <Gauge size={22} />
          <div>
            <strong>ยังไม่พบไฟล์ Documents\Rockstar Games\GTA V\settings.xml</strong>
            <p className="help-text">กรุณาเข้าเกม GTA V หรือ FiveM อย่างน้อย 1 ครั้งเพื่อให้เกมสร้างไฟล์ตั้งค่า แล้วกลับมากดรีเฟรช</p>
          </div>
        </div>
      ) : (
        <>
          <div className="perf-current-strip">
            <div>
              <span>จอ &amp; โหมดหน้าจอ (คงเดิม)</span>
              <strong>{current?.resolution || '—'} · {current?.windowMode || '—'}</strong>
            </div>
            <div>
              <span>TEXTURE / SHADER</span>
              <strong>{current?.texture || '—'} / {current?.shader || '—'}</strong>
            </div>
            <div>
              <span>SHADOW / GRASS</span>
              <strong>{current?.shadow || '—'} / {current?.grass || '—'}</strong>
            </div>
            <div>
              <span>POSTFX / AA</span>
              <strong>{current?.postFx || '—'} · MSAA {current?.msaa || 'Off'}{current?.fxaa ? ' + FXAA' : ''}</strong>
            </div>
          </div>

          <div className="perf-presets-grid">
            {presets.map(preset => (
              <article
                key={preset.id}
                className={`perf-preset-card${preset.active ? ' is-active' : ''}${preset.recommended ? ' is-recommended' : ''}`}
              >
                <div className="perf-preset-top">
                  <div className="crash-badge-row">
                    <span
                      className={`diag-pill ${
                        preset.recommended
                          ? 'tone-emerald'
                          : preset.id === 'high-visual'
                            ? 'tone-cobalt'
                            : 'tone-amber'
                      }`}
                    >
                      {preset.badge}
                    </span>
                    {preset.vramTarget && (
                      <span className="diag-pill">VRAM {preset.vramTarget}</span>
                    )}
                    {preset.active && (
                      <span className="diag-pill tone-emerald">
                        <CheckCircle2 size={11} /> กำลังใช้งานอยู่
                      </span>
                    )}
                  </div>
                  <h4>{preset.name}</h4>
                  <p className="help-text">{preset.subtitle}</p>
                </div>

                <div className="perf-score-box">
                  <ScoreBars label="ความลื่น (FPS)" score={preset.fpsScore} tone="emerald" />
                  <ScoreBars label="ความคมชัดภาพ" score={preset.visualScore} tone="cobalt" />
                </div>

                <ul className="perf-preset-bullets">
                  {preset.highlights.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>

                <div className="perf-preset-cta">
                  <button
                    type="button"
                    className={preset.active ? 'soft-button is-bound' : 'btn-action-play'}
                    disabled={busy || fivemRunning}
                    onClick={() => onApplyPreset?.(preset.id)}
                  >
                    {preset.active ? (
                      <>
                        <CheckCircle2 size={14} /> ใช้งานซ้ำ (Re-apply)
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> ใช้พรีเซ็ตนี้ (1 คลิก)
                      </>
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
