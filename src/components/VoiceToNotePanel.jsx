import React, { useMemo, useState } from 'react';
import {
  BookMarked,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Languages,
  Layers,
  Mic,
  Pause,
  Play,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Volume2,
  Wand2
} from 'lucide-react';
import { getAddonCatalogEntry, VOICE_NOTE_ADDON_ID } from '../shared/addonsCatalog';
import { copyCommandText } from '../services/crpOverlayService';
import { isTauriDesktop } from '../services/desktopBridge';
import {
  AUDIO_SOURCE_MODES,
  LOCAL_WHISPER_MODELS,
  STT_ENGINES,
  VOICE_LANGUAGES,
  VOICE_NOTE_HOTKEYS,
  VOICE_NOTE_POSITIONS
} from '../services/voiceNoteService';
import {
  applyLearnedCorrections,
  findSuspectTokensInText,
  segmentNoteTokens,
  suggestWordsForToken
} from '../services/wordSuggestionService';

function formatNoteTime(ms) {
  if (!ms) return '';
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sourceBadgeLabel(source) {
  if (source === 'mic') return 'เรา (Mic)';
  if (source === 'system') return 'เสียงระบบ';
  return 'ในเกม';
}

export default function VoiceToNotePanel({
  voiceState,
  meter,
  downloadProgress,
  busy = false,
  onInstall,
  onUninstall,
  onSaveConfig,
  onStartCapture,
  onStopCapture,
  onDownloadLocalWhisper,
  onToggleOverlay,
  onRequestConfirm,
  onNotify
}) {
  const desktop = isTauriDesktop();
  const catalog = getAddonCatalogEntry(VOICE_NOTE_ADDON_ID);
  const installed = Boolean(voiceState?.installed);
  const config = voiceState?.config;
  const [subTab, setSubTab] = useState('notes');
  const [selectedToken, setSelectedToken] = useState(null); // { noteId, tokenIndex, tokenText }
  const [customFixInput, setCustomFixInput] = useState('');
  const [editingNoteId, setEditingNoteId] = useState('');
  const [editingText, setEditingText] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [playingClip, setPlayingClip] = useState(false);

  const handlePlayLastClip = async () => {
    if (!window.estraWindow?.getLastVoiceClip || playingClip) return;
    setPlayingClip(true);
    try {
      const dataUrl = await window.estraWindow.getLastVoiceClip();
      const base64 = String(dataUrl || '').split(',')[1] || '';
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const audio = new Audio(blobUrl);
      const cleanup = () => {
        setPlayingClip(false);
        URL.revokeObjectURL(blobUrl);
      };
      audio.onended = cleanup;
      audio.onerror = () => {
        cleanup();
        onNotify?.('เล่นไฟล์เสียงล่าสุดไม่สำเร็จ', 'error');
      };
      await audio.play();
    } catch (err) {
      setPlayingClip(false);
      onNotify?.(typeof err === 'string' ? err : err?.message || 'ยังไม่มีคลิปเสียงล่าสุด', 'error');
    }
  };

  // Dictionary & correction form inputs
  const [newDictWord, setNewDictWord] = useState('');
  const [newWrongWord, setNewWrongWord] = useState('');
  const [newRightWord, setNewRightWord] = useState('');
  const [manualDraft, setManualDraft] = useState('');

  const updateConfig = async patch => {
    if (!config) return;
    await onSaveConfig({ ...config, ...patch });
  };

  const activeSuggestions = useMemo(() => {
    if (!selectedToken?.tokenText || !config) return [];
    return suggestWordsForToken(selectedToken.tokenText, {
      customDictionary: config.customDictionary,
      corrections: config.corrections,
      maxResults: 6
    });
  }, [selectedToken, config]);

  const handleCopyText = async (text, markerId, label = 'โน้ต') => {
    try {
      await copyCommandText(text);
      setCopiedId(markerId);
      onNotify?.(`คัดลอก${label}ลง Clipboard แล้ว`, 'notice');
      window.setTimeout(() => {
        setCopiedId(curr => (curr === markerId ? '' : curr));
      }, 1600);
    } catch (err) {
      onNotify?.(err?.message || 'คัดลอกไม่สำเร็จ', 'error');
    }
  };

  const handleReplaceTokenInNote = async (note, tokenIndex, oldWord, newWord, rememberPair = false) => {
    const cleanNew = String(newWord || '').trim();
    if (!cleanNew || !note) return;
    const tokens = segmentNoteTokens(note.text);
    const updatedText = tokens
      .map((t, idx) => (idx === tokenIndex ? cleanNew : t.text))
      .join('');

    const nextNotes = (config?.notes || []).map(n =>
      n.id === note.id ? { ...n, text: updatedText } : n
    );
    let nextCorrections = config?.corrections || [];
    let nextDict = config?.customDictionary || [];

    if (rememberPair && oldWord.trim() && oldWord.trim() !== cleanNew) {
      const exists = nextCorrections.some(
        c => c.wrong.toLowerCase() === oldWord.trim().toLowerCase()
      );
      nextCorrections = exists
        ? nextCorrections.map(c =>
            c.wrong.toLowerCase() === oldWord.trim().toLowerCase()
              ? { wrong: oldWord.trim(), correct: cleanNew }
              : c
          )
        : [{ wrong: oldWord.trim(), correct: cleanNew }, ...nextCorrections];
      if (!nextDict.some(w => w.toLowerCase() === cleanNew.toLowerCase())) {
        nextDict = [cleanNew, ...nextDict];
      }
    }

    await updateConfig({
      notes: nextNotes,
      corrections: nextCorrections,
      customDictionary: nextDict
    });
    setSelectedToken(null);
    setCustomFixInput('');
    onNotify?.(
      rememberPair
        ? `แก้เป็น "${cleanNew}" และจดจำเข้า Auto-Learn แล้ว`
        : `เปลี่ยน "${oldWord}" เป็น "${cleanNew}" แล้ว`,
      'notice'
    );
  };

  const handleAddSampleDistortedNote = async () => {
    const sample = {
      id: `note-${Date.now()}`,
      text: 'วันนี้เข้าห้องเรียน วิชาสะพานักเลียน อย่าลืมฝึก โลเพ แล้วปรับ setvoiceintent มิวสิก ก่อนขึ้นร้อง',
      rawText: 'วันนี้เข้าห้องเรียน วิชาสะพานักเลียน อย่าลืมฝึก โลเพ แล้วปรับ setvoiceintent มิวสิก ก่อนขึ้นร้อง',
      source: 'game',
      createdAt: Date.now(),
      pinned: false
    };
    const nextNotes = [sample, ...(config?.notes || [])];
    await updateConfig({ notes: nextNotes });
    onNotify?.('เพิ่มข้อความตัวอย่างคำเพี้ยนแล้ว — ลองคลิกที่คำที่ขีดเส้นประเพื่อดู Word Suggestion', 'notice');
  };

  const handleAddManualNote = async e => {
    e.preventDefault();
    const clean = manualDraft.trim();
    if (!clean) return;
    const fixed = config?.autoApplyCorrections
      ? applyLearnedCorrections(clean, config?.corrections).text
      : clean;
    const entry = {
      id: `note-${Date.now()}`,
      text: fixed,
      rawText: clean,
      source: 'mic',
      createdAt: Date.now(),
      pinned: false
    };
    await updateConfig({ notes: [entry, ...(config?.notes || [])] });
    setManualDraft('');
  };

  const handleAutoFixAllNotes = async () => {
    let total = 0;
    const nextNotes = (config?.notes || []).map(n => {
      const res = applyLearnedCorrections(n.text, config?.corrections);
      total += res.replacementsCount;
      return res.replacementsCount > 0 ? { ...n, text: res.text } : n;
    });
    await updateConfig({ notes: nextNotes });
    onNotify?.(
      total > 0 ? `แก้ไขคำอัตโนมัติสำเร็จ ${total} จุด` : 'ไม่พบคำเพี้ยนที่ตรงกับรายการ Auto-Learn ในโน้ตปัจจุบัน',
      'notice'
    );
  };

  const handleAddDictWord = async e => {
    e.preventDefault();
    const clean = newDictWord.trim();
    if (!clean) return;
    const current = config?.customDictionary || [];
    if (!current.some(w => w.toLowerCase() === clean.toLowerCase())) {
      await updateConfig({ customDictionary: [clean, ...current] });
    }
    setNewDictWord('');
  };

  const handleAddCorrectionPair = async e => {
    e.preventDefault();
    const wrong = newWrongWord.trim();
    const right = newRightWord.trim();
    if (!wrong || !right || wrong === right) return;
    const current = config?.corrections || [];
    const next = [
      { wrong, correct: right },
      ...current.filter(c => c.wrong.toLowerCase() !== wrong.toLowerCase())
    ];
    await updateConfig({ corrections: next });
    setNewWrongWord('');
    setNewRightWord('');
  };

  const requestUninstall = () => {
    if (onRequestConfirm) {
      onRequestConfirm({
        title: 'ถอนการติดตั้ง Voice To Note',
        message: 'ต้องการถอนการติดตั้งฟีเจอร์เสริม Voice To Note ออกจากเครื่องใช่หรือไม่?',
        detail: 'ระบบจะหยุดการจับเสียง ปิดหน้าต่าง Overlay และลบโมเดล/ข้อมูลโน้ตของ Add-on นี้ออกจากเครื่อง',
        confirmLabel: 'ถอนการติดตั้ง',
        tone: 'danger',
        onConfirm: onUninstall
      });
    } else {
      void onUninstall();
    }
  };

  if (!installed) {
    return (
      <article className="addon-store-card">
        <div className="addon-store-head">
          <div className="addon-store-icon">
            <Mic size={26} />
          </div>
          <div className="addon-store-title">
            <div className="addon-store-badges">
              <span className="addon-cat-badge">{catalog?.category}</span>
              <span className="addon-ver-badge">v{catalog?.version}</span>
              <span className="addon-ver-badge">แยก Add-on อิสระ</span>
            </div>
            <h3>{catalog?.name}</h3>
            <p>{catalog?.description}</p>
          </div>
          <div className="addon-store-cta">
            <button
              type="button"
              className="btn-action-play"
              disabled={busy}
              onClick={() => void onInstall()}
            >
              <Download size={16} />
              {busy ? 'กำลังติดตั้ง…' : 'ติดตั้ง Voice To Note'}
            </button>
            <small className="help-text">ติดตั้ง/ถอนการติดตั้งแยกต่างหากได้ทุกเมื่อ</small>
          </div>
        </div>

        <div className="addon-features-grid">
          <div className="addon-feature-box">
            <div className="addon-feature-head">
              <Volume2 size={18} />
              <strong>1. จับเสียงพูดภายในเกม (WASAPI Loopback)</strong>
            </div>
            <p>
              ดักเสียงจาก FiveM โดยตรง (Process Loopback บน Win10/11) หรือเสียงระบบ/ไมค์ โดยไม่ยุ่งกับไฟล์หรือ Memory ของเกม ปลอดภัย 100%
            </p>
          </div>
          <div className="addon-feature-box">
            <div className="addon-feature-head">
              <Wand2 size={18} />
              <strong>2. Word Suggestion แก้คำเพี้ยนอัตโนมัติ</strong>
            </div>
            <p>
              คลิกคำที่ถอดเสียงเพี้ยนเพื่อเลือกคำแนะนำจากเสียงอ่านคล้ายและคลังศัพท์ RP ของคุณ พร้อมระบบ Auto-Learn จำคู่คำแก้ให้รอบถัดไป
            </p>
          </div>
        </div>
      </article>
    );
  }

  const listening = Boolean(voiceState?.listening);
  const meterPct = Math.round(Math.max(0, Math.min(1, Number(meter?.level) || 0)) * 100);
  const allNotesText = (config?.notes || [])
    .slice()
    .reverse()
    .map(n => `[${formatNoteTime(n.createdAt)} · ${sourceBadgeLabel(n.source)}] ${n.text}`)
    .join('\n');

  return (
    <div className="addon-workspace">
      <div className="voice-top-control-bar">
        <div className="voice-control-left">
          <button
            type="button"
            className={`btn-action-play${listening ? ' is-listening-stop' : ''}`}
            disabled={busy || !desktop}
            title={desktop ? 'เริ่ม/หยุดจับเสียงพูดเพื่อแปลงเป็นโน้ต' : 'รองรับการจับเสียงเกมใน Estra Desktop App'}
            onClick={() => void (listening ? onStopCapture?.() : onStartCapture?.())}
          >
            {listening ? <Pause size={15} /> : <Play size={15} />}
            {listening ? 'หยุดฟังเสียง' : 'เริ่มจับเสียงเกม'}
          </button>

          <button
            type="button"
            className="soft-button"
            disabled={busy || !desktop}
            onClick={() => void onToggleOverlay?.()}
          >
            <Layers size={15} />
            {voiceState?.overlayVisible ? 'ซ่อน Overlay' : `เปิด Overlay (${config?.toggleOverlayHotkey || 'Alt+V'})`}
          </button>

          <button
            type="button"
            className="soft-button"
            disabled={busy || !desktop || playingClip}
            title="เล่นฟังเสียง 16kHz ที่ระบบกรองและส่งให้ AI ล่าสุด เพื่อเช็กว่าจับเสียงได้ชัดหรือไม่"
            onClick={() => void handlePlayLastClip()}
          >
            <Volume2 size={15} />
            {playingClip ? 'กำลังเล่นเสียง...' : 'ฟังเสียงล่าสุด'}
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

        <div className="voice-meter-box">
          <div className="voice-meter-head">
            <span className={`voice-status-dot${listening ? (meter?.speaking ? ' speaking' : ' active') : ''}`} />
            <strong>
              {listening
                ? meter?.transcribing
                  ? 'กำลังแปลงเสียงเป็นข้อความ...'
                  : meter?.speaking
                    ? 'กำลังรับเสียงพูด...'
                    : voiceState?.activeCaptureLabel || 'กำลังรอเสียงพูด...'
                : 'พร้อมรับเสียง (หยุดอยู่)'}
            </strong>
          </div>
          <div className="voice-meter-track" aria-hidden="true">
            <div className="voice-meter-fill" style={{ width: `${meterPct}%` }} />
          </div>
        </div>
      </div>

      <div className="addons-subnav-bar">
        <div className="addons-subtabs" role="tablist" aria-label="เครื่องมือ Voice To Note">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'notes'}
            className={`addon-subtab${subTab === 'notes' ? ' active' : ''}`}
            onClick={() => setSubTab('notes')}
          >
            <Sparkles size={15} />
            <span>โน้ต &amp; Word Suggestion</span>
            <span className="addon-tab-count">{config?.notes?.length || 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'dictionary'}
            className={`addon-subtab${subTab === 'dictionary' ? ' active' : ''}`}
            onClick={() => setSubTab('dictionary')}
          >
            <BookMarked size={15} />
            <span>คลังศัพท์ &amp; Auto-Learn</span>
            <span className="addon-tab-count">{(config?.customDictionary?.length || 0) + (config?.corrections?.length || 0)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'settings'}
            className={`addon-subtab${subTab === 'settings' ? ' active' : ''}`}
            onClick={() => setSubTab('settings')}
          >
            <Settings2 size={15} />
            <span>ตั้งค่า Engine &amp; เสียง</span>
          </button>
        </div>

        <div className="addon-hotkey-chip">
          <span>Engine:</span>
          <strong>
            {config?.sttEngine === 'local-whisper'
              ? 'Local Whisper'
              : config?.sttEngine === 'cloud-openai'
                ? 'OpenAI'
                : config?.sttEngine === 'cloud-custom'
                  ? 'Custom'
                  : 'Groq Whisper'}
          </strong>
        </div>
      </div>

      {subTab === 'notes' && (
        <div className="addon-workspace">
          <div className="addon-toolbar-row">
            <form className="voice-manual-form" onSubmit={handleAddManualNote}>
              <input
                type="text"
                value={manualDraft}
                onChange={e => setManualDraft(e.target.value)}
                placeholder="พิมพ์จดโน้ตเพิ่มเอง หรือทดสอบข้อความ..."
                aria-label="จดโน้ตเพิ่มเอง"
              />
              <button type="submit" className="soft-button">
                <Plus size={14} /> เพิ่มโน้ต
              </button>
            </form>

            <div className="addon-toolbar-right">
              <button type="button" className="soft-button" onClick={() => void handleAutoFixAllNotes()}>
                <Wand2 size={14} /> แก้คำอัตโนมัติ
              </button>
              <button
                type="button"
                className="soft-button"
                disabled={!allNotesText}
                onClick={() => void handleCopyText(allNotesText, 'all-notes', 'โน้ตทั้งหมด')}
              >
                {copiedId === 'all-notes' ? <Check size={14} /> : <Copy size={14} />}
                คัดลอกทั้งหมด
              </button>
              {(config?.notes?.length || 0) > 0 && (
                <button
                  type="button"
                  className="soft-button danger"
                  onClick={() => void updateConfig({ notes: [] })}
                >
                  <Trash2 size={14} /> ล้างโน้ต
                </button>
              )}
            </div>
          </div>

          {(config?.notes?.length || 0) === 0 ? (
            <div className="addon-empty-box">
              <Mic size={28} />
              <strong>ยังไม่มีบันทึกเสียงเป็นข้อความ</strong>
              <p>
                ตั้งค่า Engine (Groq API Key หรือ Local Whisper) แล้วกด <strong>"เริ่มจับเสียงเกม"</strong> เพื่อถอดเสียงพูดเป็นข้อความอัตโนมัติ หรือกดปุ่มด้านล่างเพื่อทดลองระบบ Word Suggestion
              </p>
              <button type="button" className="soft-button" onClick={() => void handleAddSampleDistortedNote()}>
                <Wand2 size={15} /> ทดลองข้อความคำเพี้ยน (Word Suggestion)
              </button>
            </div>
          ) : (
            <div className="voice-notes-list">
              {(config?.notes || []).map(note => {
                const tokens = segmentNoteTokens(note.text);
                const suspects = findSuspectTokensInText(note.text, {
                  customDictionary: config?.customDictionary,
                  corrections: config?.corrections
                });
                const suspectIndexes = new Set(suspects.map(s => s.index));
                const isEditing = editingNoteId === note.id;

                return (
                  <article key={note.id} className="voice-note-card">
                    <div className="voice-note-head">
                      <div className="voice-note-meta">
                        <span className={`voice-src-pill src-${note.source}`}>
                          {sourceBadgeLabel(note.source)}
                        </span>
                        <small>{formatNoteTime(note.createdAt)}</small>
                        {suspects.length > 0 && (
                          <span className="voice-suspect-count">
                            พบ {suspects.length} คำที่แนะนำให้ตรวจสอบ (คลิกที่คำเพื่อแก้)
                          </span>
                        )}
                      </div>

                      <div className="voice-note-actions">
                        <button
                          type="button"
                          className="icon-button"
                          title="คัดลอกโน้ตนี้"
                          aria-label="คัดลอกโน้ตนี้"
                          onClick={() => void handleCopyText(note.text, note.id)}
                        >
                          {copiedId === note.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="แก้ไขข้อความ"
                          aria-label="แก้ไขข้อความ"
                          onClick={() => {
                            if (isEditing) {
                              setEditingNoteId('');
                            } else {
                              setEditingNoteId(note.id);
                              setEditingText(note.text);
                            }
                          }}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          title="ลบโน้ตนี้"
                          aria-label="ลบโน้ตนี้"
                          onClick={() => {
                            const nextNotes = (config?.notes || []).filter(n => n.id !== note.id);
                            void updateConfig({ notes: nextNotes });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="voice-edit-row">
                        <input
                          type="text"
                          value={editingText}
                          onChange={e => setEditingText(e.target.value)}
                          aria-label="แก้ไขข้อความโน้ต"
                        />
                        <button
                          type="button"
                          className="btn-inline-cobalt"
                          onClick={() => {
                            const nextNotes = (config?.notes || []).map(n =>
                              n.id === note.id ? { ...n, text: editingText.trim() || n.text } : n
                            );
                            void updateConfig({ notes: nextNotes });
                            setEditingNoteId('');
                          }}
                        >
                          บันทึก
                        </button>
                      </div>
                    ) : (
                      <div className="voice-tokens-flow">
                        {tokens.map((tok, idx) => {
                          if (!tok.isWord) {
                            return <span key={idx}>{tok.text}</span>;
                          }
                          const isSuspect = suspectIndexes.has(tok.index);
                          const isSelected =
                            selectedToken?.noteId === note.id && selectedToken?.tokenIndex === idx;
                          return (
                            <button
                              key={idx}
                              type="button"
                              className={`voice-token-btn${isSuspect ? ' is-suspect' : ''}${isSelected ? ' is-selected' : ''}`}
                              title="คลิกเพื่อดู Word Suggestion สำหรับคำนี้"
                              onClick={() => {
                                setSelectedToken({
                                  noteId: note.id,
                                  tokenIndex: idx,
                                  tokenText: tok.text
                                });
                                setCustomFixInput(tok.text);
                              }}
                            >
                              {tok.text}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {selectedToken?.noteId === note.id && (
                      <div className="voice-suggestion-drawer" role="region" aria-label="Word Suggestion">
                        <div className="voice-sug-head">
                          <span>
                            <Wand2 size={13} /> คำแนะนำสำหรับ <strong>"{selectedToken.tokenText}"</strong>:
                          </span>
                          <button
                            type="button"
                            className="modal-close-btn"
                            onClick={() => setSelectedToken(null)}
                            aria-label="ปิดคำแนะนำ"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="voice-sug-chips">
                          {activeSuggestions.length === 0 ? (
                            <small className="help-text">ไม่พบคำใกล้เคียงในคลังศัพท์ สามารถพิมพ์คำที่ถูกต้องด้านล่างแล้วจำเข้า Auto-Learn ได้เลย</small>
                          ) : (
                            activeSuggestions.map(sug => (
                              <div key={sug.word} className="voice-sug-chip-group">
                                <button
                                  type="button"
                                  className="voice-sug-chip"
                                  title={sug.reason}
                                  onClick={() =>
                                    void handleReplaceTokenInNote(
                                      note,
                                      selectedToken.tokenIndex,
                                      selectedToken.tokenText,
                                      sug.word,
                                      false
                                    )
                                  }
                                >
                                  <span>{sug.word}</span>
                                  <small>{Math.round(sug.score * 100)}%</small>
                                </button>
                                <button
                                  type="button"
                                  className="voice-sug-learn-btn"
                                  title={`เปลี่ยนเป็น "${sug.word}" และจดจำเข้า Auto-Learn`}
                                  onClick={() =>
                                    void handleReplaceTokenInNote(
                                      note,
                                      selectedToken.tokenIndex,
                                      selectedToken.tokenText,
                                      sug.word,
                                      true
                                    )
                                  }
                                >
                                  จำคำนี้
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="voice-sug-custom">
                          <input
                            type="text"
                            value={customFixInput}
                            onChange={e => setCustomFixInput(e.target.value)}
                            placeholder="หรือพิมพ์คำที่ถูกต้องเอง..."
                            aria-label="พิมพ์คำที่ถูกต้องเอง"
                          />
                          <button
                            type="button"
                            className="btn-inline-cobalt"
                            onClick={() =>
                              void handleReplaceTokenInNote(
                                note,
                                selectedToken.tokenIndex,
                                selectedToken.tokenText,
                                customFixInput,
                                true
                              )
                            }
                          >
                            แก้ &amp; จำคำนี้
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subTab === 'dictionary' && (
        <div className="addon-workspace">
          <div className="voice-dict-grid">
            <section className="addon-inline-form">
              <div className="addon-form-head">
                <strong>คลังศัพท์ RP / ชื่อวิชา / ชื่อตัวละคร</strong>
              </div>
              <p className="help-text" style={{ marginBottom: 10 }}>
                คำศัพท์ในคลังนี้จะถูกใช้ทั้งช่วย <strong>ชี้นำ Whisper</strong> ตอนถอดเสียง และใช้เป็นตัวเลือกใน <strong>Word Suggestion</strong>
              </p>
              <form className="voice-add-inline" onSubmit={handleAddDictWord}>
                <input
                  type="text"
                  value={newDictWord}
                  onChange={e => setNewDictWord(e.target.value)}
                  placeholder="เช่น วิชาเวทมนตร์, ชื่อเมือง, ชื่อเพื่อน..."
                  maxLength={60}
                />
                <button type="submit" className="btn-action-play">
                  <Plus size={14} /> เพิ่มคำ
                </button>
              </form>
              <div className="voice-tag-cloud">
                {(config?.customDictionary || []).map(word => (
                  <span key={word} className="voice-dict-tag">
                    <span>{word}</span>
                    <button
                      type="button"
                      aria-label={`ลบคำ ${word}`}
                      onClick={() => {
                        const next = (config?.customDictionary || []).filter(w => w !== word);
                        void updateConfig({ customDictionary: next });
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </section>

            <section className="addon-inline-form">
              <div className="addon-form-head">
                <strong>คู่คำแก้เพี้ยนอัตโนมัติ (Auto-Learn Pairs)</strong>
              </div>
              <p className="help-text" style={{ marginBottom: 10 }}>
                เมื่อระบบถอดเสียงได้คำฝั่งซ้าย จะถูกแก้เป็นคำฝั่งขวาให้อัตโนมัติ (และแนะนำเป็นอันดับแรก)
              </p>
              <form className="voice-pair-form" onSubmit={handleAddCorrectionPair}>
                <input
                  type="text"
                  value={newWrongWord}
                  onChange={e => setNewWrongWord(e.target.value)}
                  placeholder="คำที่มักเพี้ยน (เช่น โลเพ)"
                  maxLength={60}
                />
                <span>→</span>
                <input
                  type="text"
                  value={newRightWord}
                  onChange={e => setNewRightWord(e.target.value)}
                  placeholder="คำที่ถูกต้อง (เช่น โรลเพลย์)"
                  maxLength={60}
                />
                <button type="submit" className="btn-action-play">
                  <Plus size={14} /> เพิ่มคู่คำ
                </button>
              </form>
              <div className="voice-pairs-list">
                {(config?.corrections || []).map(pair => (
                  <div key={pair.wrong} className="voice-pair-row">
                    <code>{pair.wrong}</code>
                    <span>→</span>
                    <strong>{pair.correct}</strong>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`ลบคู่คำ ${pair.wrong}`}
                      onClick={() => {
                        const next = (config?.corrections || []).filter(c => c.wrong !== pair.wrong);
                        void updateConfig({ corrections: next });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {subTab === 'settings' && (
        <div className="addon-workspace">
          <div className="addon-settings-card">
            <div className="addon-form-grid">
              <div>
                <label htmlFor="vn-source">แหล่งเสียงที่ต้องการจับ</label>
                <select
                  id="vn-source"
                  value={config?.audioSource || 'game'}
                  onChange={e => void updateConfig({ audioSource: e.target.value })}
                >
                  {AUDIO_SOURCE_MODES.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="vn-engine">ตัวถอดเสียง (Speech-to-Text Engine)</label>
                <select
                  id="vn-engine"
                  value={config?.sttEngine || 'cloud-groq'}
                  onChange={e => {
                    const nextEngine = e.target.value;
                    const meta = STT_ENGINES.find(item => item.value === nextEngine);
                    void updateConfig({
                      sttEngine: nextEngine,
                      cloudModel: meta?.defaultModel || config?.cloudModel
                    });
                  }}
                >
                  {STT_ENGINES.map(e => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="vn-lang">
                  <Languages size={12} style={{ verticalAlign: 'middle' }} /> ภาษาที่ถอดเสียง
                </label>
                <select
                  id="vn-lang"
                  value={config?.language || 'th'}
                  onChange={e => void updateConfig({ language: e.target.value })}
                >
                  {VOICE_LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="vn-hotkey">คีย์ลัดเปิด-ปิดหน้าต่าง Voice Overlay</label>
                <select
                  id="vn-hotkey"
                  value={config?.toggleOverlayHotkey || 'Alt+V'}
                  onChange={e => void updateConfig({ toggleOverlayHotkey: e.target.value })}
                >
                  {VOICE_NOTE_HOTKEYS.map(k => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {config?.sttEngine === 'local-whisper' ? (
              <div className="voice-local-box">
                <div className="voice-local-head">
                  <strong>ตั้งค่า Local Whisper ในเครื่อง (Offline 100%)</strong>
                  <span className={`addon-status-pill${voiceState?.localEngineReady && voiceState?.localModelReady ? ' installed' : ''}`}>
                    {voiceState?.localEngineReady && voiceState?.localModelReady
                      ? 'Engine & โมเดลพร้อมใช้งาน'
                      : 'ยังไม่ได้ดาวน์โหลดไฟล์ Engine / โมเดล'}
                  </span>
                </div>
                <div className="addon-form-grid">
                  <div>
                    <label htmlFor="vn-local-model">เลือกโมเดล Whisper</label>
                    <select
                      id="vn-local-model"
                      value={config?.localModelId || 'small-q5_1'}
                      onChange={e => void updateConfig({ localModelId: e.target.value })}
                    >
                      {LOCAL_WHISPER_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-action-play"
                      disabled={busy || !desktop}
                      onClick={() => void onDownloadLocalWhisper?.(config?.localModelId || 'small-q5_1')}
                    >
                      <Download size={15} />
                      {voiceState?.localEngineReady && voiceState?.localModelReady
                        ? 'ตรวจสอบ / โหลดโมเดลที่เลือก'
                        : 'ดาวน์โหลด Engine & โมเดลอัตโนมัติ'}
                    </button>
                  </div>
                </div>
                {downloadProgress && (
                  <div className="voice-download-progress">
                    <small>{downloadProgress.message} ({downloadProgress.percent}%)</small>
                    <div className="voice-meter-track">
                      <div className="voice-meter-fill" style={{ width: `${downloadProgress.percent}%` }} />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="addon-form-grid" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="vn-apikey">
                    API Key ({config?.sttEngine === 'cloud-openai' ? 'OpenAI' : config?.sttEngine === 'cloud-custom' ? 'Optional' : 'Groq Console Free/Paid'})
                  </label>
                  <div className="input-container">
                    <input
                      id="vn-apikey"
                      type={showApiKey ? 'text' : 'password'}
                      value={config?.apiKey || ''}
                      onChange={e => void updateConfig({ apiKey: e.target.value })}
                      placeholder="gsk_... หรือ sk-..."
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={showApiKey ? 'ซ่อน API Key' : 'แสดง API Key'}
                      onClick={() => setShowApiKey(v => !v)}
                    >
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="vn-model">ชื่อโมเดล Cloud</label>
                  <input
                    id="vn-model"
                    type="text"
                    value={config?.cloudModel || 'whisper-large-v3-turbo'}
                    onChange={e => void updateConfig({ cloudModel: e.target.value })}
                  />
                </div>
                {config?.sttEngine === 'cloud-custom' && (
                  <div>
                    <label htmlFor="vn-endpoint">Custom Transcription URL</label>
                    <input
                      id="vn-endpoint"
                      type="text"
                      value={config?.customEndpoint || ''}
                      onChange={e => void updateConfig({ customEndpoint: e.target.value })}
                      placeholder="http://127.0.0.1:8080/v1/audio/transcriptions"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="addon-form-grid" style={{ marginTop: 12 }}>
              <div>
                <label htmlFor="vn-pos">ตำแหน่งหน้าต่าง Voice Overlay</label>
                <select
                  id="vn-pos"
                  value={config?.overlayPosition || 'bottom-left'}
                  onChange={e => void updateConfig({ overlayPosition: e.target.value })}
                >
                  {VOICE_NOTE_POSITIONS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="vn-vad">ความไวตรวจจับเสียงพูด (VAD Threshold: {Number(config?.vadSensitivity || 0.014).toFixed(3)})</label>
                <input
                  id="vn-vad"
                  type="range"
                  min={0.004}
                  max={0.06}
                  step={0.002}
                  value={config?.vadSensitivity || 0.014}
                  onChange={e => void updateConfig({ vadSensitivity: Number(e.target.value) })}
                />
              </div>
            </div>

            <label className="setting-row" style={{ marginTop: 12 }}>
              <span>
                แก้คำที่รู้จักเพี้ยนบ่อยอัตโนมัติ (Auto-Apply Corrections)
                <small className="help-text">เมื่อถอดเสียงเสร็จ จะเทียบกับรายการคู่คำในแท็บ Auto-Learn และแก้ให้อัตโนมัติทันที</small>
              </span>
              <input
                type="checkbox"
                checked={config?.autoApplyCorrections !== false}
                onChange={e => void updateConfig({ autoApplyCorrections: e.target.checked })}
              />
            </label>

            {voiceState?.installDir && (
              <p className="help-text" style={{ marginTop: 10 }}>
                โฟลเดอร์ Add-on: <code>{voiceState.installDir}</code> (เสียงถูกประมวลผลใน RAM ชั่วคราวและไม่บันทึกไฟล์เสียงถาวร)
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
