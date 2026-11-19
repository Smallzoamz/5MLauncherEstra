import React from 'react';
import {
  Activity,
  BellOff,
  BellRing,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Wifi
} from 'lucide-react';
import {
  ALLOWED_FREE_SLOT_THRESHOLDS,
  ALLOWED_WATCHER_INTERVALS_SEC
} from '../services/serverWatcherService';

const QUALITY_META = {
  excellent: { label: 'ดีเยี่ยม', tone: 'emerald' },
  good: { label: 'ดี', tone: 'cobalt' },
  fair: { label: 'พอใช้', tone: 'amber' },
  poor: { label: 'แกว่ง / เสียแพ็กเก็ต', tone: 'danger' },
  unreachable: { label: 'ติดต่อไม่ได้', tone: 'danger' }
};

function LatencySparkline({ samples = [], history = [] }) {
  const points = samples.length
    ? samples.map((s, idx) => ({
        xLabel: `#${s.seq || idx + 1}`,
        ok: Boolean(s.ok),
        val: s.ok ? Number(s.rttMs) || 1 : null
      }))
    : history.map((h, idx) => ({
        xLabel: `${idx + 1}`,
        ok: Number.isFinite(Number(h.ping)),
        val: Number.isFinite(Number(h.ping)) ? Number(h.ping) : null
      }));

  if (!points.length) {
    return (
      <div className="sparkline-empty">
        <Activity size={16} />
        <span>กด “ทดสอบเส้นทาง (6 แพ็กเก็ต)” เพื่อวัดกราฟ Ping / Jitter จริงไปยังเมืองนี้</span>
      </div>
    );
  }

  const validVals = points.map(p => p.val).filter(v => v != null);
  const maxVal = Math.max(40, ...validVals, 1);
  const width = 420;
  const height = 104;
  const padX = 18;
  const padY = 14;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const coords = points.map((pt, i) => {
    const x = points.length === 1 ? width / 2 : padX + (i / (points.length - 1)) * plotW;
    const y = pt.val == null ? height - padY : padY + plotH - (pt.val / maxVal) * plotH;
    return { ...pt, x, y };
  });

  const okCoords = coords.filter(c => c.ok);
  const polyline = okCoords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPath =
    okCoords.length >= 2
      ? `M ${okCoords[0].x.toFixed(1)},${height - padY} L ${okCoords
          .map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
          .join(' L ')} L ${okCoords[okCoords.length - 1].x.toFixed(1)},${height - padY} Z`
      : '';

  return (
    <div className="sparkline-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="sparkline-svg" role="img" aria-label="กราฟค่า Ping และ Jitter">
        <defs>
          <linearGradient id="estraPingGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#2b6bf3" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={padY} x2={width - padX} y2={padY} className="spark-grid" />
        <line x1={padX} y1={padY + plotH / 2} x2={width - padX} y2={padY + plotH / 2} className="spark-grid" />
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="spark-grid" />
        {areaPath && <path d={areaPath} fill="url(#estraPingGrad)" />}
        {okCoords.length >= 2 && <polyline points={polyline} className="spark-line" />}
        {coords.map((c, idx) => (
          <g key={idx}>
            <circle
              cx={c.x}
              cy={c.y}
              r={c.ok ? 4 : 4.5}
              className={c.ok ? 'spark-dot-ok' : 'spark-dot-loss'}
            >
              <title>{c.ok ? `${c.xLabel}: ${c.val} ms` : `${c.xLabel}: Timeout / Loss`}</title>
            </circle>
            {c.ok && (
              <text x={c.x} y={Math.max(11, c.y - 7)} textAnchor="middle" className="spark-val-label">
                {c.val}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function NetworkWatcherPanel({
  server,
  servers = [],
  routeReport,
  pingHistory = [],
  probing = false,
  watcherMap = {},
  readyAlert = null,
  launchBusy = false,
  onProbeRoute,
  onToggleWatcher,
  onUpdateWatcher,
  onRearmWatcher,
  onQuickJoinServer,
  onDismissReadyAlert
}) {
  const activeRule = server ? watcherMap[server.id] || null : null;
  const qualityMeta = routeReport ? QUALITY_META[routeReport.quality] || QUALITY_META.fair : null;
  const watchedEntries = Object.values(watcherMap)
    .filter(r => r?.enabled)
    .map(rule => ({
      rule,
      city: servers.find(s => s.id === rule.serverId) || null
    }))
    .filter(item => item.city);

  return (
    <div className="network-watcher-stack">
      {readyAlert && (
        <div className="watcher-ready-banner" role="status">
          <div className="watcher-ready-copy">
            <span className="diag-pill tone-emerald">
              <Radio size={11} /> {readyAlert.badge}
            </span>
            <strong>{readyAlert.serverName}</strong>
            <span>{readyAlert.subtitle}</span>
          </div>
          <div className="watcher-ready-actions">
            <button
              type="button"
              className="btn-action-play"
              disabled={launchBusy}
              onClick={() => onQuickJoinServer?.(readyAlert.serverId)}
            >
              <Play size={13} fill="currentColor" /> เข้าเมืองทันที
            </button>
            <button
              type="button"
              className="soft-button"
              onClick={() => onDismissReadyAlert?.()}
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {/* Part A: Ping & Route Diagnostics */}
      <section className="diag-panel" aria-label="ตรวจสอบ Ping และ Jitter ไปยังเซิร์ฟเวอร์">
        <div className="diag-panel-header">
          <div>
            <span className="eyebrow">PING / JITTER &amp; ROUTE CHECK</span>
            <h3>ตรวจเส้นทางและสัญญาณก่อนเข้าเมือง</h3>
            <p className="help-text">
              {server
                ? `ปลายทางปัจจุบัน: ${server.name} (${server.ip})`
                : 'เลือกเมืองก่อนเพื่อเริ่มทดสอบเส้นทาง'}
            </p>
          </div>
          <button
            type="button"
            className="btn-action-play"
            disabled={!server || probing}
            onClick={() => server && onProbeRoute?.(server)}
          >
            <RefreshCw size={14} className={probing ? 'spin' : ''} />
            {probing ? 'กำลังวัดสัญญาณ…' : 'ทดสอบเส้นทาง (6 แพ็กเก็ต)'}
          </button>
        </div>

        <LatencySparkline
          samples={routeReport?.samples || []}
          history={pingHistory}
        />

        {routeReport && (
          <>
            <div className="route-kpi-grid">
              <div className="route-kpi">
                <span>AVG PING</span>
                <strong>{routeReport.avgMs != null ? `${routeReport.avgMs} ms` : '—'}</strong>
              </div>
              <div className="route-kpi">
                <span>MIN / MAX</span>
                <strong>
                  {routeReport.minMs != null
                    ? `${routeReport.minMs} / ${routeReport.maxMs} ms`
                    : '—'}
                </strong>
              </div>
              <div className="route-kpi">
                <span>JITTER</span>
                <strong>{routeReport.jitterMs != null ? `${routeReport.jitterMs} ms` : '—'}</strong>
              </div>
              <div className="route-kpi">
                <span>PACKET LOSS</span>
                <strong>{routeReport.lossPercent}%</strong>
              </div>
              <div className="route-kpi">
                <span>HTTP /INFO</span>
                <strong>{routeReport.httpRttMs != null ? `${routeReport.httpRttMs} ms` : '—'}</strong>
              </div>
            </div>

            <div className={`diag-banner tone-${qualityMeta.tone}`}>
              <Wifi size={16} />
              <div className="diag-banner-copy">
                <strong>
                  คุณภาพเส้นทาง: {qualityMeta.label} ({routeReport.resolvedIp}:{routeReport.port})
                </strong>
                <span>{routeReport.summary}</span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Part B: Server Restart & Slot Watcher */}
      <section className="diag-panel" aria-label="ระบบเฝ้าเมืองรีสตาร์ทและสล็อตว่าง">
        <div className="diag-panel-header">
          <div>
            <span className="eyebrow">SERVER RESTART &amp; SLOT WATCHER</span>
            <h3>แจ้งเตือนเมื่อเมืองเปิดหลังรีสตาร์ท หรือมีสล็อตว่าง</h3>
            <p className="help-text">
              เฝ้าสถานะแบบสุภาพ (ทุก 20–45 วินาที ไม่รัวสแปมเซิร์ฟเวอร์) เมื่อพร้อมจะเด้ง Overlay แจ้งเตือนพร้อมปุ่มเข้าเมือง 1 คลิก
            </p>
          </div>
          {server && (
            <button
              type="button"
              className={activeRule?.enabled ? 'soft-button is-watching' : 'btn-action-play'}
              onClick={() => onToggleWatcher?.(server)}
            >
              {activeRule?.enabled ? <BellOff size={14} /> : <BellRing size={14} />}
              {activeRule?.enabled ? 'หยุดเฝ้าเมืองนี้' : `เริ่มเฝ้า ${server.name}`}
            </button>
          )}
        </div>

        {server && activeRule?.enabled && (
          <div className="watcher-config-card">
            <div className="watcher-config-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={activeRule.watchRestart}
                  onChange={e =>
                    onUpdateWatcher?.(server.id, {
                      watchRestart: e.target.checked,
                      armedRestart: true
                    })
                  }
                />
                <span>แจ้งเตือนเมื่อเมืองรีสตาร์ทเสร็จ (Offline → Online)</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={activeRule.watchFreeSlots}
                  onChange={e =>
                    onUpdateWatcher?.(server.id, {
                      watchFreeSlots: e.target.checked,
                      armedSlots: true
                    })
                  }
                />
                <span>แจ้งเตือนเมื่อมีสล็อตว่าง</span>
              </label>
            </div>

            <div className="watcher-selects-row">
              <div>
                <label className="field-label" htmlFor="watcher-free-slots">
                  แจ้งเมื่อว่างอย่างน้อย
                </label>
                <select
                  id="watcher-free-slots"
                  className="watcher-select"
                  disabled={!activeRule.watchFreeSlots}
                  value={activeRule.minFreeSlots}
                  onChange={e =>
                    onUpdateWatcher?.(server.id, {
                      minFreeSlots: Number(e.target.value),
                      armedSlots: true
                    })
                  }
                >
                  {ALLOWED_FREE_SLOT_THRESHOLDS.map(n => (
                    <option key={n} value={n}>
                      ≥ {n} ที่ว่าง
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="watcher-interval">
                  ความถี่ในการเช็ก
                </label>
                <select
                  id="watcher-interval"
                  className="watcher-select"
                  value={activeRule.intervalSec}
                  onChange={e =>
                    onUpdateWatcher?.(server.id, { intervalSec: Number(e.target.value) })
                  }
                >
                  {ALLOWED_WATCHER_INTERVALS_SEC.map(sec => (
                    <option key={sec} value={sec}>
                      ทุก {sec} วินาที
                    </option>
                  ))}
                </select>
              </div>

              <div className="watcher-arm-box">
                <span className="field-label">สถานะการเตือน</span>
                <div className="watcher-arm-status">
                  <span className="diag-pill tone-cobalt">
                    {activeRule.armedRestart || activeRule.armedSlots
                      ? 'กำลังเฝ้ารอสัญญาณ'
                      : 'แจ้งเตือนไปแล้ว'}
                  </span>
                  {!activeRule.armedRestart && !activeRule.armedSlots && (
                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => onRearmWatcher?.(server.id)}
                    >
                      <RotateCcw size={12} /> เฝ้าต่ออีกครั้ง
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="watched-list">
          <span className="eyebrow">เมืองที่กำลังเฝ้าอยู่ ({watchedEntries.length})</span>
          {watchedEntries.length === 0 ? (
            <p className="help-text">
              ยังไม่ได้เปิดเฝ้าเมืองใด กดปุ่ม “เริ่มเฝ้า” ด้านบน หรือกดไอคอนกระดิ่งบนการ์ดเมืองหน้าหลักได้เลย
            </p>
          ) : (
            <div className="watched-items-grid">
              {watchedEntries.map(({ rule, city }) => {
                const freeSlots =
                  city.status === 'Online' && city.maxPlayers > 0 && city.onlinePlayers != null
                    ? Math.max(0, city.maxPlayers - city.onlinePlayers)
                    : null;
                return (
                  <div key={city.id} className="watched-city-row">
                    <div>
                      <strong>{city.name}</strong>
                      <small>
                        {city.status === 'Online'
                          ? `Online · ${city.onlinePlayers ?? 0}/${city.maxPlayers ?? '—'}${
                              freeSlots != null ? ` (ว่าง ${freeSlots})` : ''
                            }`
                          : city.status}
                        {' · '}เช็กทุก {rule.intervalSec} วิ
                      </small>
                    </div>
                    <div className="watched-row-actions">
                      <button
                        type="button"
                        className="soft-button"
                        disabled={launchBusy}
                        onClick={() => onQuickJoinServer?.(city.id)}
                      >
                        <Play size={12} fill="currentColor" /> เข้าเมือง
                      </button>
                      <button
                        type="button"
                        className="soft-button danger-ghost"
                        onClick={() => onToggleWatcher?.(city)}
                      >
                        <BellOff size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
