import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarClock,
  Check,
  Copy,
  EyeOff,
  Layers,
  Minus,
  Plus,
  Search,
  Terminal,
  X
} from 'lucide-react';
import {
  COMMAND_CATEGORIES,
  DEFAULT_CRP_CONFIG,
  SCHEDULE_CATEGORIES,
  buildF8MultiCommand,
  clampRollCount,
  computeNextScheduleOccurrence,
  copyCommandText,
  formatScheduleDaysSummary,
  loadCrpAddonState,
  saveCrpOverlayConfig,
  hideCrpOverlayWindow
} from '../services/crpOverlayService';

export default function CrpOverlayApp({ desktopWindow = false }) {
  const [addonState, setAddonState] = useState({
    installed: true,
    config: DEFAULT_CRP_CONFIG,
    overlayVisible: true
  });
  const [tab, setTab] = useState('commands');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [copiedKey, setCopiedKey] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 5000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!desktopWindow) return undefined;
    document.documentElement.classList.add('overlay-window-root');
    document.body.classList.add('overlay-window-body');

    let active = true;
    void loadCrpAddonState()
      .then(state => {
        if (active && state) setAddonState(state);
      })
      .catch(() => {});

    const offState = window.estraWindow?.onCrpAddonState?.(state => {
      if (active && state) setAddonState(state);
    });

    const onKeyDown = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hideCrpOverlayWindow();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      active = false;
      offState?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [desktopWindow]);

  const config = addonState?.config || DEFAULT_CRP_CONFIG;
  const rollPreview = useMemo(
    () => buildF8MultiCommand(config.rollCommand, config.rollCount),
    [config.rollCommand, config.rollCount]
  );

  const filteredCommands = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (config.commands || []).filter(cmd => {
      if (category !== 'all' && cmd.category !== category) return false;
      if (!q) return true;
      return (
        cmd.label.toLowerCase().includes(q) ||
        cmd.command.toLowerCase().includes(q) ||
        (cmd.description || '').toLowerCase().includes(q)
      );
    });
  }, [config.commands, search, category]);

  const sortedSchedules = useMemo(() => {
    return [...(config.schedules || [])]
      .map(item => ({ item, next: computeNextScheduleOccurrence(item, now) }))
      .sort((a, b) => {
        if (a.item.enabled !== b.item.enabled) return a.item.enabled ? -1 : 1;
        if (a.next && b.next) return a.next.diffMs - b.next.diffMs;
        if (a.next) return -1;
        if (b.next) return 1;
        return a.item.time.localeCompare(b.item.time);
      });
  }, [config.schedules, now]);

  const updateConfig = async patch => {
    const nextCfg = { ...config, ...patch };
    setAddonState(prev => ({ ...prev, config: nextCfg }));
    try {
      const saved = await saveCrpOverlayConfig(nextCfg);
      if (saved) setAddonState(saved);
    } catch {}
  };

  const handleCopy = async (text, key, label) => {
    try {
      await copyCommandText(text);
      setCopiedKey(key);
      setCopyFeedback(`คัดลอก ${label || text} แล้ว!`);
      window.setTimeout(() => {
        setCopiedKey(curr => (curr === key ? '' : curr));
      }, 1500);
      if (desktopWindow && config.autoHideOnCopy !== false) {
        window.setTimeout(() => {
          void hideCrpOverlayWindow();
          setCopyFeedback('');
        }, 220);
      } else {
        window.setTimeout(() => setCopyFeedback(''), 2000);
      }
    } catch (err) {
      setCopyFeedback(err?.message || 'คัดลอกไม่สำเร็จ');
    }
  };

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return (
    <div className="crp-overlay-shell" role="dialog" aria-label="FiveM C-RP-SRP Overlay">
      <header className="crp-ov-header">
        <div className="crp-ov-brand">
          <span className="crp-ov-logo">
            <Layers size={14} />
          </span>
          <div>
            <strong>C-RP-SRP Overlay</strong>
            <small>
              {hh}:{mm} · {config.toggleHotkey || 'Alt+O'}
            </small>
          </div>
        </div>

        <div className="crp-ov-head-actions">
          <button
            type="button"
            className={`crp-ov-autohide-btn${config.autoHideOnCopy !== false ? ' active' : ''}`}
            title="พับหน้าต่างอัตโนมัติหลังคัดลอกคำสั่ง"
            onClick={() => void updateConfig({ autoHideOnCopy: config.autoHideOnCopy === false })}
          >
            <EyeOff size={12} />
            <span>{config.autoHideOnCopy !== false ? 'Auto-Hide' : 'ค้างจอ'}</span>
          </button>
          <button
            type="button"
            className="crp-ov-close-btn"
            aria-label="ซ่อน Overlay (ESC)"
            title="ซ่อน Overlay (ESC)"
            onClick={() => void hideCrpOverlayWindow()}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <nav className="crp-ov-tabs" aria-label="หมวดหมู่ Overlay">
        <button
          type="button"
          className={`crp-ov-tab${tab === 'commands' ? ' active' : ''}`}
          onClick={() => setTab('commands')}
        >
          <Terminal size={13} />
          <span>คำสั่งลัด &amp; F8 Roll</span>
        </button>
        <button
          type="button"
          className={`crp-ov-tab${tab === 'schedules' ? ' active' : ''}`}
          onClick={() => setTab('schedules')}
        >
          <CalendarClock size={13} />
          <span>ตารางแจ้งเตือน ({config.schedules?.length || 0})</span>
        </button>
      </nav>

      {copyFeedback && (
        <div className="crp-ov-toast" role="status" aria-live="polite">
          <Check size={13} />
          <span>{copyFeedback}</span>
        </div>
      )}

      {tab === 'commands' ? (
        <div className="crp-ov-body">
          <section className="crp-ov-roll-box" aria-label="F8 Multi-Roll">
            <div className="crp-ov-roll-head">
              <span>F8 Multi-Roll</span>
              <div className="crp-ov-roll-stepper">
                <button
                  type="button"
                  aria-label="ลดจำนวน Roll"
                  disabled={config.rollCount <= 1}
                  onClick={() => void updateConfig({ rollCount: clampRollCount((config.rollCount || 4) - 1) })}
                >
                  <Minus size={12} />
                </button>
                <strong>{config.rollCount || 4}x</strong>
                <button
                  type="button"
                  aria-label="เพิ่มจำนวน Roll"
                  disabled={config.rollCount >= 20}
                  onClick={() => void updateConfig({ rollCount: clampRollCount((config.rollCount || 4) + 1) })}
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>

            <div className="crp-ov-roll-presets">
              {[1, 2, 3, 4, 5, 6, 8].map(n => (
                <button
                  key={n}
                  type="button"
                  className={config.rollCount === n ? 'active' : ''}
                  onClick={() => void updateConfig({ rollCount: n })}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="crp-ov-roll-action">
              <code title={rollPreview}>{rollPreview}</code>
              <button
                type="button"
                className={`crp-ov-copy-primary${copiedKey === 'ov-roll' ? ' copied' : ''}`}
                onClick={() => void handleCopy(rollPreview, 'ov-roll', `F8 Roll ${config.rollCount}x`)}
              >
                {copiedKey === 'ov-roll' ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedKey === 'ov-roll' ? 'แล้ว!' : 'คัดลอก'}</span>
              </button>
            </div>
          </section>

          <div className="crp-ov-search">
            <Search size={13} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาคำสั่ง..."
              aria-label="ค้นหาคำสั่งลัดใน Overlay"
            />
          </div>

          <div className="crp-ov-cats">
            <button
              type="button"
              className={category === 'all' ? 'active' : ''}
              onClick={() => setCategory('all')}
            >
              ทั้งหมด
            </button>
            {COMMAND_CATEGORIES.map(c => (
              <button
                key={c.value}
                type="button"
                className={category === c.value ? 'active' : ''}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="crp-ov-list">
            {filteredCommands.length === 0 ? (
              <p className="crp-ov-empty">ไม่พบคำสั่งที่ตรงกับคำค้นหา</p>
            ) : (
              filteredCommands.map(cmd => {
                const isCopied = copiedKey === cmd.id;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    className={`crp-ov-cmd-row${isCopied ? ' copied' : ''}`}
                    onClick={() => void handleCopy(cmd.command, cmd.id, cmd.label)}
                  >
                    <div className="crp-ov-cmd-meta">
                      <div className="crp-ov-cmd-title-row">
                        <span className={`addon-mode-badge mode-${cmd.mode}`}>
                          {cmd.mode === 'f8' ? 'F8' : 'CHAT'}
                        </span>
                        <strong>{cmd.label}</strong>
                      </div>
                      <code>{cmd.command}</code>
                    </div>
                    <span className="crp-ov-cmd-copy-icon">
                      {isCopied ? <Check size={14} /> : <Copy size={14} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="crp-ov-body">
          <div className="crp-ov-list">
            {sortedSchedules.length === 0 ? (
              <p className="crp-ov-empty">
                ยังไม่มีตารางแจ้งเตือน สามารถเพิ่มตาราง Event หรือตารางเรียนได้ที่หน้า "ฟีเจอร์เสริม" ใน Launcher
              </p>
            ) : (
              sortedSchedules.map(({ item, next }) => {
                const cat = SCHEDULE_CATEGORIES.find(c => c.value === item.category) || SCHEDULE_CATEGORIES[1];
                return (
                  <div key={item.id} className={`crp-ov-sch-row${!item.enabled ? ' is-disabled' : ''}`}>
                    <span className="crp-ov-sch-dot" style={{ background: cat.color }} />
                    <div className="crp-ov-sch-copy">
                      <div className="crp-ov-sch-top">
                        <span style={{ color: cat.color }}>{cat.label}</span>
                        <small>{formatScheduleDaysSummary(item)}</small>
                      </div>
                      <strong>{item.title}</strong>
                      <small className="crp-ov-sch-sub">
                        <Bell size={11} />{' '}
                        {next && item.enabled ? `${next.dayLabel} · ${next.countdownLabel}` : item.enabled ? 'ผ่านรอบนี้แล้ว' : 'ปิดการเตือนอยู่'}
                        {item.location ? ` · ${item.location}` : ''}
                      </small>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={`เปิด-ปิด ${item.title}`}
                      checked={item.enabled}
                      onChange={e => {
                        const nextSchedules = (config.schedules || []).map(s =>
                          s.id === item.id ? { ...s, enabled: e.target.checked } : s
                        );
                        void updateConfig({ schedules: nextSchedules });
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <footer className="crp-ov-footer">
        <span>กด ESC หรือ {config.toggleHotkey || 'Alt+O'} เพื่อพับหน้าต่างกลับเข้าเกม</span>
      </footer>
    </div>
  );
}
