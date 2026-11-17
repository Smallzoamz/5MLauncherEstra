import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  CalendarClock,
  Check,
  Copy,
  Download,
  Edit3,
  Layers,
  Minus,
  Music,
  Play,
  Plus,
  Power,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react';
import { getAddonCatalogEntry } from '../shared/addonsCatalog';
import {
  COMMAND_CATEGORIES,
  CRP_OVERLAY_HOTKEYS,
  CRP_OVERLAY_POSITIONS,
  DAY_OF_WEEK_LABELS,
  DEFAULT_QUICK_COMMANDS,
  REMIND_BEFORE_OPTIONS,
  SCHEDULE_CATEGORIES,
  buildF8MultiCommand,
  buildScheduleAlertPayload,
  clampRollCount,
  computeNextScheduleOccurrence,
  copyCommandText,
  formatScheduleDaysSummary,
  sanitizeQuickCommand,
  sanitizeScheduleItem
} from '../services/crpOverlayService';
import { isTauriDesktop } from '../services/desktopBridge';
import { playOverlayFriendChime, pushOverlayNotification } from '../services/overlayService';

const EMPTY_SCHEDULE_FORM = {
  id: '',
  title: '',
  category: 'class',
  scheduleType: 'weekly',
  daysOfWeek: [1, 2, 3, 4, 5],
  date: '',
  time: '20:00',
  remindBeforeMinutes: 5,
  notifyAtStart: true,
  location: '',
  note: '',
  enabled: true
};

const EMPTY_COMMAND_FORM = {
  id: '',
  label: '',
  command: '',
  mode: 'chat',
  category: 'rp',
  description: '',
  builtIn: false
};

function todayIsoDate() {
  const dt = new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function AddonsHub({
  addonState,
  busy = false,
  settings,
  onInstallAddon,
  onUninstallAddon,
  onSaveConfig,
  onToggleOverlayWindow,
  onRequestConfirm,
  onNotify
}) {
  const desktop = isTauriDesktop();
  const catalog = getAddonCatalogEntry();
  const installed = Boolean(addonState?.installed);
  const config = addonState?.config;
  const [subTab, setSubTab] = useState('commands');
  const [now, setNow] = useState(() => new Date());

  // Schedule form state
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(EMPTY_SCHEDULE_FORM);
  const [scheduleError, setScheduleError] = useState('');

  // Command form & filter state
  const [cmdSearch, setCmdSearch] = useState('');
  const [cmdCategory, setCmdCategory] = useState('all');
  const [cmdFormOpen, setCmdFormOpen] = useState(false);
  const [cmdForm, setCmdForm] = useState(EMPTY_COMMAND_FORM);
  const [cmdError, setCmdError] = useState('');
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const rollOutput = useMemo(
    () => buildF8MultiCommand(config?.rollCommand || 'roll', config?.rollCount || 4),
    [config?.rollCommand, config?.rollCount]
  );

  const sortedSchedules = useMemo(() => {
    const list = Array.isArray(config?.schedules) ? config.schedules : [];
    return [...list]
      .map(item => ({
        item,
        next: computeNextScheduleOccurrence(item, now)
      }))
      .sort((a, b) => {
        if (a.item.enabled !== b.item.enabled) return a.item.enabled ? -1 : 1;
        if (a.next && b.next) return a.next.diffMs - b.next.diffMs;
        if (a.next) return -1;
        if (b.next) return 1;
        return a.item.time.localeCompare(b.item.time);
      });
  }, [config?.schedules, now]);

  const nextActiveSchedule = useMemo(
    () => sortedSchedules.find(entry => entry.item.enabled && entry.next) || null,
    [sortedSchedules]
  );

  const filteredCommands = useMemo(() => {
    const list = Array.isArray(config?.commands) ? config.commands : [];
    const q = cmdSearch.trim().toLowerCase();
    return list.filter(cmd => {
      if (cmdCategory !== 'all' && cmd.category !== cmdCategory) return false;
      if (!q) return true;
      return (
        cmd.label.toLowerCase().includes(q) ||
        cmd.command.toLowerCase().includes(q) ||
        (cmd.description || '').toLowerCase().includes(q)
      );
    });
  }, [config?.commands, cmdSearch, cmdCategory]);

  const handleCopy = async (text, markerId, labelText = 'คำสั่ง') => {
    try {
      await copyCommandText(text);
      setCopiedId(markerId);
      onNotify?.(`คัดลอก "${text}" (${labelText}) ลง Clipboard แล้ว`, 'notice');
      window.setTimeout(() => {
        setCopiedId(curr => (curr === markerId ? '' : curr));
      }, 1800);
    } catch (err) {
      onNotify?.(err?.message || 'คัดลอกคำสั่งไม่สำเร็จ', 'error');
    }
  };

  const updateConfig = async patch => {
    if (!config) return;
    await onSaveConfig({ ...config, ...patch });
  };

  const handleRollCountChange = nextCount => {
    void updateConfig({ rollCount: clampRollCount(nextCount) });
  };

  const handleSaveSchedule = async e => {
    e.preventDefault();
    setScheduleError('');
    const candidate = sanitizeScheduleItem({
      ...scheduleForm,
      date: scheduleForm.scheduleType === 'once' ? scheduleForm.date || todayIsoDate() : ''
    });
    if (!candidate) {
      setScheduleError('กรุณาระบุชื่อรายการกิจกรรมหรือวิชาเรียน');
      return;
    }
    if (candidate.scheduleType === 'once' && !candidate.date) {
      setScheduleError('กรุณาเลือกวันที่สำหรับกิจกรรมแบบครั้งเดียว');
      return;
    }
    const current = Array.isArray(config?.schedules) ? config.schedules : [];
    const exists = current.some(s => s.id === candidate.id);
    const nextList = exists
      ? current.map(s => (s.id === candidate.id ? candidate : s))
      : [candidate, ...current];
    await updateConfig({ schedules: nextList });
    setScheduleForm(EMPTY_SCHEDULE_FORM);
    setScheduleFormOpen(false);
    onNotify?.(exists ? `อัปเดตตาราง "${candidate.title}" แล้ว` : `เพิ่มตาราง "${candidate.title}" แล้ว`, 'notice');
  };

  const handleAddSampleSchedules = async () => {
    const samples = [
      sanitizeScheduleItem({
        id: `sample-class-${Date.now()}`,
        title: 'วิชาดนตรีและขับร้อง (School RP)',
        category: 'class',
        scheduleType: 'weekly',
        daysOfWeek: [1, 3, 5],
        time: '20:00',
        remindBeforeMinutes: 5,
        notifyAtStart: true,
        location: 'ห้องดนตรี ชั้น 2',
        note: 'อย่าลืมปรับ setvoiceintent music ก่อนขึ้นร้อง',
        enabled: true
      }),
      sanitizeScheduleItem({
        id: `sample-event-${Date.now() + 1}`,
        title: 'กิจกรรมรวมตัวหน้าลานเมือง',
        category: 'event',
        scheduleType: 'weekly',
        daysOfWeek: [0, 6],
        time: '21:30',
        remindBeforeMinutes: 10,
        notifyAtStart: true,
        location: 'ลานกิจกรรมกลาง',
        note: 'เช็คสกินด้วย /reloadskin หากเพื่อนมองไม่เห็นชุด',
        enabled: true
      })
    ].filter(Boolean);
    const current = Array.isArray(config?.schedules) ? config.schedules : [];
    await updateConfig({ schedules: [...samples, ...current] });
    onNotify?.('เพิ่มตัวอย่างตารางเรียนและ Event แล้ว', 'notice');
  };

  const handleTestScheduleAlert = async item => {
    const sample = item || {
      id: 'preview',
      title: 'วิชาดนตรีและขับร้อง (ทดสอบ)',
      category: 'class',
      time: '20:00',
      remindBeforeMinutes: 5,
      location: 'ห้องดนตรี ชั้น 2',
      note: 'ตัวอย่างการแจ้งเตือนตารางเรียน / Event บนหน้าจอ'
    };
    const payload = buildScheduleAlertPayload(sample, item ? 'pre' : 'pre');
    if (config?.playAlertSound !== false) playOverlayFriendChime();
    await pushOverlayNotification(payload, { force: true, settings });
    onNotify?.('ส่งแจ้งเตือนตัวอย่างไปยัง Overlay แล้ว', 'notice');
  };

  const handleSaveCommand = async e => {
    e.preventDefault();
    setCmdError('');
    const candidate = sanitizeQuickCommand(cmdForm);
    if (!candidate) {
      setCmdError('กรุณากรอกทั้งชื่อปุ่มและคำสั่งที่ต้องการคัดลอก');
      return;
    }
    const current = Array.isArray(config?.commands) ? config.commands : [];
    const exists = current.some(c => c.id === candidate.id);
    const nextList = exists
      ? current.map(c => (c.id === candidate.id ? candidate : c))
      : [...current, candidate];
    await updateConfig({ commands: nextList });
    setCmdForm(EMPTY_COMMAND_FORM);
    setCmdFormOpen(false);
    onNotify?.(exists ? `อัปเดตคำสั่ง "${candidate.label}" แล้ว` : `เพิ่มคำสั่ง "${candidate.label}" แล้ว`, 'notice');
  };

  const handleRestoreDefaultCommands = async () => {
    const current = Array.isArray(config?.commands) ? config.commands : [];
    const byId = new Map(current.map(c => [c.id, c]));
    for (const def of DEFAULT_QUICK_COMMANDS) {
      if (!byId.has(def.id)) {
        byId.set(def.id, { ...def });
      }
    }
    const merged = Array.from(byId.values());
    await updateConfig({ commands: merged, rollCommand: 'roll' });
    onNotify?.('คืนค่าคำสั่งลัดพื้นฐานครบแล้ว (คำสั่งที่คุณเพิ่มเองยังคงอยู่)', 'notice');
  };

  const requestUninstall = () => {
    if (onRequestConfirm) {
      onRequestConfirm({
        title: 'ถอนการติดตั้ง FiveM C-RP-SRP Overlay',
        message: 'ต้องการถอนการติดตั้งฟีเจอร์เสริมนี้ออกจาก Estra Launcher ใช่หรือไม่?',
        detail: 'ระบบจะปิดหน้าต่าง Overlay หยุดการแจ้งเตือน และลบไฟล์ตั้งค่าของฟีเจอร์เสริมนี้ในเครื่องออกทั้งหมด',
        confirmLabel: 'ถอนการติดตั้ง',
        tone: 'danger',
        onConfirm: onUninstallAddon
      });
    } else {
      void onUninstallAddon();
    }
  };

  const toggleDayInForm = dayVal => {
    setScheduleForm(prev => {
      const has = prev.daysOfWeek.includes(dayVal);
      const next = has ? prev.daysOfWeek.filter(d => d !== dayVal) : [...prev.daysOfWeek, dayVal];
      return { ...prev, daysOfWeek: next.sort((a, b) => a - b) };
    });
  };

  return (
    <section className="subtab-panel addons-panel" aria-label="ฟีเจอร์เสริม Add-ons">
      <div className="subtab-banner addons-banner">
        <div className="addons-banner-copy">
          <div className="screenshots-eyebrow-row">
            <span className="eyebrow">ESTRA ADD-ONS · MODULAR EXTENSION</span>
            <span className={`addon-status-pill${installed ? ' installed' : ''}`}>
              {installed ? `ติดตั้งแล้ว · v${catalog?.version || '1.0.0'}` : 'พร้อมติดตั้งผ่าน Launcher'}
            </span>
          </div>
          <h2>ฟีเจอร์เสริม (Add-ons)</h2>
          <p>
            ติดตั้งหรือถอนการติดตั้งเครื่องมือเสริมสำหรับสาย Roleplay ได้โดยตรงผ่าน Estra Launcher โดยไม่กระทบไฟล์เกม FiveM
          </p>
        </div>

        {installed && (
          <div className="addons-banner-actions">
            <button
              type="button"
              className={`soft-button${config?.enabled ? ' is-active-addon' : ''}`}
              disabled={busy}
              onClick={() => void updateConfig({ enabled: !config?.enabled })}
            >
              <Power size={15} />
              {config?.enabled ? 'กำลังเปิดใช้งาน' : 'พักการทำงานอยู่'}
            </button>
            <button
              type="button"
              className="btn-action-play"
              disabled={busy || !config?.enabled || !desktop}
              title={desktop ? `เปิด/ปิดหน้าต่าง Overlay (${config?.toggleHotkey || 'Alt+O'})` : 'รองรับหน้าต่าง Overlay บน Estra Desktop App'}
              onClick={() => void onToggleOverlayWindow?.()}
            >
              <Layers size={15} />
              {addonState?.overlayVisible ? 'ซ่อน Overlay' : 'เปิด Overlay บนจอ'}
            </button>
            <button
              type="button"
              className="soft-button danger"
              disabled={busy}
              onClick={requestUninstall}
            >
              <Trash2 size={15} />
              ถอนการติดตั้ง
            </button>
          </div>
        )}
      </div>

      {!installed ? (
        <article className="addon-store-card">
          <div className="addon-store-head">
            <div className="addon-store-icon">
              <Layers size={26} />
            </div>
            <div className="addon-store-title">
              <div className="addon-store-badges">
                <span className="addon-cat-badge">{catalog?.category}</span>
                <span className="addon-ver-badge">v{catalog?.version}</span>
                <span className="addon-ver-badge">โดย {catalog?.author}</span>
              </div>
              <h3>{catalog?.name}</h3>
              <p>{catalog?.description}</p>
            </div>
            <div className="addon-store-cta">
              <button
                type="button"
                className="btn-action-play"
                disabled={busy}
                onClick={() => void onInstallAddon()}
              >
                <Download size={16} />
                {busy ? 'กำลังติดตั้ง…' : 'ติดตั้งฟีเจอร์เสริม'}
              </button>
              <small className="help-text">ติดตั้ง/ถอนการติดตั้งได้ทุกเมื่อ</small>
            </div>
          </div>

          <div className="addon-features-grid">
            <div className="addon-feature-box">
              <div className="addon-feature-head">
                <CalendarClock size={18} />
                <strong>1. ตารางการแจ้งเตือน (Event &amp; ตารางเรียน)</strong>
              </div>
              <p>
                ตั้งตารางเรียนวิชาสำคัญ หรือตาราง Event ประจำวัน/สัปดาห์/เฉพาะวัน พร้อมแจ้งเตือนล่วงหน้าแบบ Overlay ไม่เด้งหลุดหน้าจอเกม
              </p>
            </div>
            <div className="addon-feature-box">
              <div className="addon-feature-head">
                <Terminal size={18} />
                <strong>2. ศูนย์คำสั่งลัด &amp; F8 Multi-Roll</strong>
              </div>
              <p>
                คัดลอกคำสั่งที่ใช้เป็นครั้งคราวได้ในคลิกเดียว เช่น <code>/reloadmap</code>, <code>/reloadskin</code>,{' '}
                <code>setvoiceintent music</code> / <code>speech</code> และสร้างคำสั่ง <code>roll;roll;roll;roll</code> ตามจำนวนครั้งสำหรับวางใน F8
              </p>
            </div>
          </div>
        </article>
      ) : (
        <>
          <div className="addons-subnav-bar">
            <div className="addons-subtabs" role="tablist" aria-label="เครื่องมือ FiveM C-RP-SRP Overlay">
              <button
                type="button"
                role="tab"
                aria-selected={subTab === 'commands'}
                className={`addon-subtab${subTab === 'commands' ? ' active' : ''}`}
                onClick={() => setSubTab('commands')}
              >
                <Terminal size={15} />
                <span>คำสั่งลัด &amp; F8 Roll</span>
                <span className="addon-tab-count">{config?.commands?.length || 0}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={subTab === 'schedules'}
                className={`addon-subtab${subTab === 'schedules' ? ' active' : ''}`}
                onClick={() => setSubTab('schedules')}
              >
                <CalendarClock size={15} />
                <span>ตารางแจ้งเตือน</span>
                <span className="addon-tab-count">{config?.schedules?.length || 0}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={subTab === 'settings'}
                className={`addon-subtab${subTab === 'settings' ? ' active' : ''}`}
                onClick={() => setSubTab('settings')}
              >
                <Settings2 size={15} />
                <span>ตั้งค่า Overlay</span>
              </button>
            </div>

            <div className="addon-hotkey-chip" title="กดคีย์ลัดนี้ขณะอยู่ในเกมเพื่อเปิด-ปิดหน้าต่าง Overlay">
              <span>คีย์ลัด Overlay:</span>
              <strong>{config?.toggleHotkey || 'Alt+O'}</strong>
            </div>
          </div>

          {subTab === 'commands' && (
            <div className="addon-workspace">
              <section className="addon-roll-card" aria-label="ตัวช่วยสร้างคำสั่ง Roll ผ่าน F8">
                <div className="addon-roll-copy">
                  <span className="eyebrow">F8 MULTI-ROLL BUILDER</span>
                  <h3>ตัวช่วย Roll หลายครั้งผ่าน F8</h3>
                  <p>
                    เลือกจำนวนครั้งที่ต้องการทอย แล้วกดคัดลอกเพื่อนำไปวางในหน้าต่าง <code>F8</code> ของ FiveM ได้ทันที (คั่นด้วย <code>;</code>)
                  </p>
                </div>

                <div className="addon-roll-controls">
                  <div className="addon-roll-presets">
                    {[1, 2, 3, 4, 5, 6, 8, 10].map(n => (
                      <button
                        key={n}
                        type="button"
                        className={`roll-preset-btn${config?.rollCount === n ? ' active' : ''}`}
                        onClick={() => handleRollCountChange(n)}
                      >
                        {n}x
                      </button>
                    ))}
                  </div>

                  <div className="addon-roll-stepper-row">
                    <div className="roll-stepper" aria-label="จำนวนครั้งที่ต้องการ Roll">
                      <button
                        type="button"
                        className="roll-step-btn"
                        aria-label="ลดจำนวน Roll"
                        disabled={(config?.rollCount || 4) <= 1}
                        onClick={() => handleRollCountChange((config?.rollCount || 4) - 1)}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        aria-label="จำนวนครั้ง Roll"
                        value={config?.rollCount || 4}
                        onChange={e => handleRollCountChange(e.target.value)}
                      />
                      <button
                        type="button"
                        className="roll-step-btn"
                        aria-label="เพิ่มจำนวน Roll"
                        disabled={(config?.rollCount || 4) >= 20}
                        onClick={() => handleRollCountChange((config?.rollCount || 4) + 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <input
                      type="text"
                      className="roll-base-input"
                      aria-label="คำสั่งพื้นฐานสำหรับทำซ้ำ"
                      value={config?.rollCommand || 'roll'}
                      onChange={e => void updateConfig({ rollCommand: e.target.value })}
                      placeholder="roll"
                      title="คำสั่งพื้นฐาน (ค่าเริ่มต้น: roll)"
                    />
                  </div>
                </div>

                <div className="addon-roll-preview-row">
                  <code className="addon-roll-preview">{rollOutput}</code>
                  <button
                    type="button"
                    className={`btn-action-play addon-copy-cta${copiedId === 'f8-roll' ? ' is-copied' : ''}`}
                    onClick={() => void handleCopy(rollOutput, 'f8-roll', `F8 Roll ${config?.rollCount || 4} ครั้ง`)}
                  >
                    {copiedId === 'f8-roll' ? <Check size={15} /> : <Copy size={15} />}
                    {copiedId === 'f8-roll' ? 'คัดลอกแล้ว!' : 'คัดลอกคำสั่ง F8'}
                  </button>
                </div>
              </section>

              <div className="addon-toolbar-row">
                <div className="addon-search-box">
                  <Search size={14} />
                  <input
                    type="text"
                    value={cmdSearch}
                    onChange={e => setCmdSearch(e.target.value)}
                    placeholder="ค้นหาคำสั่งลัด เช่น reloadskin, music, roll..."
                    aria-label="ค้นหาคำสั่งลัด"
                  />
                </div>

                <div className="addon-filter-pills">
                  <button
                    type="button"
                    className={`addon-filter-pill${cmdCategory === 'all' ? ' active' : ''}`}
                    onClick={() => setCmdCategory('all')}
                  >
                    ทั้งหมด
                  </button>
                  {COMMAND_CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      type="button"
                      className={`addon-filter-pill${cmdCategory === cat.value ? ' active' : ''}`}
                      onClick={() => setCmdCategory(cat.value)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="addon-toolbar-right">
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => {
                      setCmdForm(EMPTY_COMMAND_FORM);
                      setCmdError('');
                      setCmdFormOpen(v => !v);
                    }}
                  >
                    <Plus size={14} />
                    เพิ่มคำสั่งลัด
                  </button>
                  <button
                    type="button"
                    className="soft-button"
                    title="กู้คืนคำสั่งเริ่มต้น (/reloadmap, /reloadskin, setvoiceintent)"
                    onClick={() => void handleRestoreDefaultCommands()}
                  >
                    <RotateCcw size={14} />
                    คืนค่าเริ่มต้น
                  </button>
                </div>
              </div>

              {cmdFormOpen && (
                <form className="addon-inline-form" onSubmit={handleSaveCommand}>
                  <div className="addon-form-head">
                    <strong>{cmdForm.id ? 'แก้ไขคำสั่งลัด' : 'เพิ่มคำสั่งลัดใหม่'}</strong>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={() => setCmdFormOpen(false)}
                      aria-label="ปิดฟอร์มคำสั่ง"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="addon-form-grid">
                    <div>
                      <label htmlFor="cmd-label">ชื่อปุ่ม / คำสั่ง</label>
                      <input
                        id="cmd-label"
                        value={cmdForm.label}
                        onChange={e => setCmdForm({ ...cmdForm, label: e.target.value })}
                        placeholder="เช่น นั่งเล่นกีตาร์ หรือ รีเซ็ตเสียง"
                        maxLength={60}
                      />
                    </div>
                    <div>
                      <label htmlFor="cmd-text">ข้อความคำสั่งที่จะคัดลอก</label>
                      <input
                        id="cmd-text"
                        value={cmdForm.command}
                        onChange={e => setCmdForm({ ...cmdForm, command: e.target.value })}
                        placeholder="เช่น /e guitar หรือ setvoiceintent music"
                        maxLength={200}
                      />
                    </div>
                    <div>
                      <label htmlFor="cmd-mode">ช่องสำหรับวางคำสั่ง</label>
                      <select
                        id="cmd-mode"
                        value={cmdForm.mode}
                        onChange={e => setCmdForm({ ...cmdForm, mode: e.target.value })}
                      >
                        <option value="chat">Chat ในเกม (/)</option>
                        <option value="f8">F8 Console</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cmd-category">หมวดหมู่</label>
                      <select
                        id="cmd-category"
                        value={cmdForm.category}
                        onChange={e => setCmdForm({ ...cmdForm, category: e.target.value })}
                      >
                        {COMMAND_CATEGORIES.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <label htmlFor="cmd-desc">คำอธิบายสั้นๆ (ไม่บังคับ)</label>
                    <input
                      id="cmd-desc"
                      value={cmdForm.description}
                      onChange={e => setCmdForm({ ...cmdForm, description: e.target.value })}
                      placeholder="ใช้เมื่อไหร่ หรือหมายเหตุการใช้งาน"
                      maxLength={140}
                    />
                  </div>
                  {cmdError && <p role="alert" className="error-message">{cmdError}</p>}
                  <div className="addon-form-actions">
                    <button type="button" className="soft-button" onClick={() => setCmdFormOpen(false)}>
                      ยกเลิก
                    </button>
                    <button type="submit" className="btn-action-play">
                      {cmdForm.id ? 'บันทึกการแก้ไข' : 'เพิ่มคำสั่งลัด'}
                    </button>
                  </div>
                </form>
              )}

              {filteredCommands.length === 0 ? (
                <div className="addon-empty-box">
                  <Terminal size={26} />
                  <strong>ไม่พบคำสั่งลัดที่ค้นหา</strong>
                  <p>ลองเปลี่ยนคำค้นหา หรือกด "+ เพิ่มคำสั่งลัด" เพื่อสร้างคำสั่งใหม่</p>
                </div>
              ) : (
                <div className="addon-commands-grid">
                  {filteredCommands.map(cmd => {
                    const isCopied = copiedId === cmd.id;
                    const catLabel = COMMAND_CATEGORIES.find(c => c.value === cmd.category)?.label || 'กำหนดเอง';
                    return (
                      <article key={cmd.id} className="addon-command-card">
                        <div className="addon-command-top">
                          <span className={`addon-mode-badge mode-${cmd.mode}`}>
                            {cmd.mode === 'f8' ? 'F8' : 'CHAT /'}
                          </span>
                          <span className="addon-cmd-cat">
                            {cmd.category === 'voice' ? <Music size={12} /> : cmd.category === 'fix' ? <Wrench size={12} /> : <Sparkles size={12} />}
                            {catLabel}
                          </span>
                        </div>
                        <strong className="addon-command-title">{cmd.label}</strong>
                        <code className="addon-command-code">{cmd.command}</code>
                        {cmd.description && <p className="addon-command-desc">{cmd.description}</p>}
                        <div className="addon-command-actions">
                          <button
                            type="button"
                            className={`btn-inline-cobalt addon-cmd-copy-btn${isCopied ? ' copied' : ''}`}
                            onClick={() => void handleCopy(cmd.command, cmd.id, cmd.label)}
                          >
                            {isCopied ? <Check size={13} /> : <Copy size={13} />}
                            {isCopied ? 'คัดลอกแล้ว' : 'คัดลอกคำสั่ง'}
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`แก้ไข ${cmd.label}`}
                            title="แก้ไขคำสั่ง"
                            onClick={() => {
                              setCmdForm({ ...cmd });
                              setCmdError('');
                              setCmdFormOpen(true);
                            }}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            aria-label={`ลบ ${cmd.label}`}
                            title="ลบคำสั่ง"
                            onClick={() => {
                              const nextList = (config?.commands || []).filter(c => c.id !== cmd.id);
                              void updateConfig({ commands: nextList });
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {subTab === 'schedules' && (
            <div className="addon-workspace">
              <div className="addon-next-up-bar">
                <div className="addon-next-up-info">
                  <BellRing size={18} />
                  <div>
                    <span className="eyebrow">UPCOMING SCHEDULE</span>
                    {nextActiveSchedule ? (
                      <strong>
                        ถัดไป: {nextActiveSchedule.item.title} · {nextActiveSchedule.next.dayLabel}{' '}
                        {nextActiveSchedule.item.time} ({nextActiveSchedule.next.countdownLabel})
                      </strong>
                    ) : (
                      <strong>ยังไม่มีรายการแจ้งเตือนที่กำลังจะมาถึง</strong>
                    )}
                  </div>
                </div>
                <div className="addon-next-up-actions">
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => void handleTestScheduleAlert(nextActiveSchedule?.item || null)}
                  >
                    <Play size={14} />
                    ทดสอบแจ้งเตือน
                  </button>
                  <button
                    type="button"
                    className="btn-action-play"
                    onClick={() => {
                      setScheduleForm({ ...EMPTY_SCHEDULE_FORM, date: todayIsoDate() });
                      setScheduleError('');
                      setScheduleFormOpen(v => !v);
                    }}
                  >
                    <Plus size={15} />
                    เพิ่มตารางแจ้งเตือน
                  </button>
                </div>
              </div>

              {scheduleFormOpen && (
                <form className="addon-inline-form" onSubmit={handleSaveSchedule}>
                  <div className="addon-form-head">
                    <strong>{scheduleForm.id ? 'แก้ไขตารางแจ้งเตือน' : 'เพิ่มตารางแจ้งเตือน Event / ตารางเรียน'}</strong>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={() => setScheduleFormOpen(false)}
                      aria-label="ปิดฟอร์มตาราง"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="addon-form-grid">
                    <div>
                      <label htmlFor="sch-title">ชื่อ Event หรือวิชาเรียน</label>
                      <input
                        id="sch-title"
                        value={scheduleForm.title}
                        onChange={e => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                        placeholder="เช่น วิชาดนตรี / Event กิจกรรมกลางเมือง"
                        maxLength={80}
                      />
                    </div>
                    <div>
                      <label htmlFor="sch-category">หมวดหมู่</label>
                      <select
                        id="sch-category"
                        value={scheduleForm.category}
                        onChange={e => setScheduleForm({ ...scheduleForm, category: e.target.value })}
                      >
                        {SCHEDULE_CATEGORIES.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="sch-type">รูปแบบเวลา</label>
                      <select
                        id="sch-type"
                        value={scheduleForm.scheduleType}
                        onChange={e => setScheduleForm({ ...scheduleForm, scheduleType: e.target.value })}
                      >
                        <option value="weekly">ประจำสัปดาห์ / ทุกวัน</option>
                        <option value="once">ครั้งเดียวตามวันที่กำหนด</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="sch-time">เวลา (24 ชม.)</label>
                      <input
                        id="sch-time"
                        type="time"
                        value={scheduleForm.time}
                        onChange={e => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                      />
                    </div>
                  </div>

                  {scheduleForm.scheduleType === 'weekly' ? (
                    <div className="addon-days-picker">
                      <div className="addon-days-head">
                        <span>เลือกวันในสัปดาห์</span>
                        <div className="addon-days-shortcuts">
                          <button
                            type="button"
                            className="btn-inline-cobalt"
                            onClick={() => setScheduleForm({ ...scheduleForm, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })}
                          >
                            ทุกวัน
                          </button>
                          <button
                            type="button"
                            className="btn-inline-cobalt"
                            onClick={() => setScheduleForm({ ...scheduleForm, daysOfWeek: [1, 2, 3, 4, 5] })}
                          >
                            จันทร์-ศุกร์
                          </button>
                        </div>
                      </div>
                      <div className="addon-days-row">
                        {DAY_OF_WEEK_LABELS.map(d => {
                          const activeDay = scheduleForm.daysOfWeek.includes(d.value);
                          return (
                            <button
                              key={d.value}
                              type="button"
                              aria-pressed={activeDay}
                              className={`day-chip-btn${activeDay ? ' active' : ''}`}
                              onClick={() => toggleDayInForm(d.value)}
                            >
                              {d.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <label htmlFor="sch-date">วันที่จัด Event / เรียน</label>
                      <input
                        id="sch-date"
                        type="date"
                        value={scheduleForm.date || todayIsoDate()}
                        onChange={e => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="addon-form-grid" style={{ marginTop: 10 }}>
                    <div>
                      <label htmlFor="sch-remind">แจ้งเตือนล่วงหน้า</label>
                      <select
                        id="sch-remind"
                        value={scheduleForm.remindBeforeMinutes}
                        onChange={e => setScheduleForm({ ...scheduleForm, remindBeforeMinutes: Number(e.target.value) })}
                      >
                        {REMIND_BEFORE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="sch-location">สถานที่ / ห้องเรียน (ไม่บังคับ)</label>
                      <input
                        id="sch-location"
                        value={scheduleForm.location}
                        onChange={e => setScheduleForm({ ...scheduleForm, location: e.target.value })}
                        placeholder="เช่น ห้อง 204 หรือ ลานกิจกรรม"
                        maxLength={60}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <label htmlFor="sch-note">หมายเหตุเพิ่มเติม (ไม่บังคับ)</label>
                    <input
                      id="sch-note"
                      value={scheduleForm.note}
                      onChange={e => setScheduleForm({ ...scheduleForm, note: e.target.value })}
                      placeholder="เช่น เตรียมคำสั่ง setvoiceintent music"
                      maxLength={140}
                    />
                  </div>

                  <label className="setting-row" style={{ marginTop: 10 }}>
                    <span>แจ้งเตือนซ้ำอีกครั้งเมื่อถึงเวลาพอดี<small className="help-text">หากตั้งเตือนล่วงหน้าไว้ ระบบจะแจ้งเตือนทั้งก่อนเวลา และตอนเริ่มจริง</small></span>
                    <input
                      type="checkbox"
                      checked={scheduleForm.notifyAtStart !== false}
                      onChange={e => setScheduleForm({ ...scheduleForm, notifyAtStart: e.target.checked })}
                    />
                  </label>

                  {scheduleError && <p role="alert" className="error-message">{scheduleError}</p>}
                  <div className="addon-form-actions">
                    <button type="button" className="soft-button" onClick={() => setScheduleFormOpen(false)}>
                      ยกเลิก
                    </button>
                    <button type="submit" className="btn-action-play">
                      {scheduleForm.id ? 'บันทึกการแก้ไข' : 'บันทึกตารางแจ้งเตือน'}
                    </button>
                  </div>
                </form>
              )}

              {sortedSchedules.length === 0 ? (
                <div className="addon-empty-box">
                  <CalendarClock size={28} />
                  <strong>ยังไม่มีตารางแจ้งเตือน Event หรือตารางเรียน</strong>
                  <p>
                    เพิ่มตารางเรียนวิชาสำคัญ หรือกิจกรรม RP ประจำสัปดาห์ เพื่อให้ระบบเด้งแจ้งเตือนบนหน้าจออัตโนมัติขณะเล่นเกม
                  </p>
                  <div className="empty-state-actions">
                    <button
                      type="button"
                      className="btn-action-play"
                      onClick={() => {
                        setScheduleForm({ ...EMPTY_SCHEDULE_FORM, date: todayIsoDate() });
                        setScheduleFormOpen(true);
                      }}
                    >
                      <Plus size={15} /> เพิ่มรายการแรก
                    </button>
                    <button type="button" className="soft-button" onClick={() => void handleAddSampleSchedules()}>
                      <Sparkles size={15} /> ใส่ตัวอย่างตารางเรียน &amp; Event
                    </button>
                  </div>
                </div>
              ) : (
                <div className="addon-schedule-list">
                  {sortedSchedules.map(({ item, next }) => {
                    const cat = SCHEDULE_CATEGORIES.find(c => c.value === item.category) || SCHEDULE_CATEGORIES[1];
                    return (
                      <article key={item.id} className={`addon-schedule-card${!item.enabled ? ' is-disabled' : ''}`}>
                        <div className="addon-schedule-stripe" style={{ background: cat.color }} aria-hidden="true" />
                        <div className="addon-schedule-main">
                          <div className="addon-schedule-top">
                            <span className="addon-sch-cat" style={{ color: cat.color }}>
                              {cat.label}
                            </span>
                            <span className="addon-sch-when">{formatScheduleDaysSummary(item)}</span>
                            {next && item.enabled && (
                              <span className="addon-sch-countdown">
                                {next.dayLabel} · {next.countdownLabel}
                              </span>
                            )}
                          </div>
                          <strong>{item.title}</strong>
                          <div className="addon-sch-meta">
                            <span>
                              <Bell size={12} />{' '}
                              {item.remindBeforeMinutes > 0
                                ? `เตือนก่อน ${item.remindBeforeMinutes} นาที`
                                : 'เตือนตรงเวลา'}
                            </span>
                            {item.location && <span>สถานที่: {item.location}</span>}
                            {item.note && <span>{item.note}</span>}
                          </div>
                        </div>

                        <div className="addon-schedule-actions">
                          <label className="switch-mini" title={item.enabled ? 'ปิดการแจ้งเตือนนี้' : 'เปิดการแจ้งเตือนนี้'}>
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={e => {
                                const nextList = (config?.schedules || []).map(s =>
                                  s.id === item.id ? { ...s, enabled: e.target.checked } : s
                                );
                                void updateConfig({ schedules: nextList });
                              }}
                            />
                            <span>{item.enabled ? 'เปิด' : 'ปิด'}</span>
                          </label>
                          <button
                            type="button"
                            className="icon-button"
                            title="ทดสอบแจ้งเตือนรายการนี้"
                            aria-label={`ทดสอบแจ้งเตือน ${item.title}`}
                            onClick={() => void handleTestScheduleAlert(item)}
                          >
                            <BellRing size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="แก้ไข"
                            aria-label={`แก้ไข ${item.title}`}
                            onClick={() => {
                              setScheduleForm({ ...item });
                              setScheduleError('');
                              setScheduleFormOpen(true);
                            }}
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="ลบรายการ"
                            aria-label={`ลบ ${item.title}`}
                            onClick={() => {
                              const nextList = (config?.schedules || []).filter(s => s.id !== item.id);
                              void updateConfig({ schedules: nextList });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {subTab === 'settings' && (
            <div className="addon-workspace">
              <div className="addon-settings-card">
                <div className="addon-form-grid">
                  <div>
                    <label htmlFor="crp-hotkey">ปุ่มคีย์ลัดเปิด-ปิดหน้าต่าง Overlay</label>
                    <select
                      id="crp-hotkey"
                      value={config?.toggleHotkey || 'Alt+O'}
                      onChange={e => void updateConfig({ toggleHotkey: e.target.value })}
                    >
                      {CRP_OVERLAY_HOTKEYS.map(item => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="crp-position">ตำแหน่งหน้าต่าง Overlay บนหน้าจอ</label>
                    <select
                      id="crp-position"
                      value={config?.position || 'top-right'}
                      onChange={e => void updateConfig({ position: e.target.value })}
                    >
                      {CRP_OVERLAY_POSITIONS.map(pos => (
                        <option key={pos.value} value={pos.value}>{pos.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="setting-row" style={{ marginTop: 14 }}>
                  <span>
                    พับหน้าต่าง Overlay อัตโนมัติหลังกดคัดลอกคำสั่ง
                    <small className="help-text">
                      เมื่อกดคัดลอกคำสั่งในหน้าต่าง Overlay จะซ่อนหน้าต่างและคืนโฟกัสกลับเข้า FiveM ให้กด F8 / T เพื่อวางได้ทันที
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={config?.autoHideOnCopy !== false}
                    onChange={e => void updateConfig({ autoHideOnCopy: e.target.checked })}
                  />
                </label>

                <label className="setting-row">
                  <span>
                    แสดง Popup แจ้งเตือนตารางเรียน &amp; Event บนหน้าจอเกม
                    <small className="help-text">
                      แจ้งเตือนแบบ Steam-style มุมขวาล่างโดยไม่แย่งโฟกัสเมาส์ขณะเล่น FiveM (แนะนำโหมด Windowed / Borderless)
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={config?.showScheduleToasts !== false}
                    onChange={e => void updateConfig({ showScheduleToasts: e.target.checked })}
                  />
                </label>

                <label className="setting-row">
                  <span>
                    เปิดเสียงเตือนเบาๆ เมื่อถึงเวลาตารางแจ้งเตือน
                    <small className="help-text">ส่งเสียงกระดิ่งสั้นๆ เพื่อไม่ให้พลาดวิชาสำคัญหรือ Event</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={config?.playAlertSound !== false}
                    onChange={e => void updateConfig({ playAlertSound: e.target.checked })}
                  />
                </label>

                <label className="setting-row">
                  <span>
                    ทำงานเฉพาะตอนเปิด FiveM อยู่เท่านั้น
                    <small className="help-text">
                      หากเปิดไว้ คีย์ลัด {config?.toggleHotkey || 'Alt+O'} และการแจ้งเตือนตารางจะทำงานเฉพาะระหว่างเปิด FiveM
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(config?.onlyInGame)}
                    onChange={e => void updateConfig({ onlyInGame: e.target.checked })}
                  />
                </label>

                {addonState?.installDir && (
                  <p className="help-text" style={{ marginTop: 12 }}>
                    โฟลเดอร์ติดตั้งฟีเจอร์เสริม: <code>{addonState.installDir}</code>
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
