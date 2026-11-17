import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Mic,
  Pause,
  Play,
  Wand2,
  X
} from 'lucide-react';
import { copyCommandText } from '../services/crpOverlayService';
import {
  DEFAULT_VOICE_NOTE_CONFIG,
  hideVoiceNoteOverlayWindow,
  loadVoiceNoteState,
  saveVoiceNoteConfig,
  startVoiceNoteCapture,
  stopVoiceNoteCapture
} from '../services/voiceNoteService';
import {
  findSuspectTokensInText,
  segmentNoteTokens,
  suggestWordsForToken
} from '../services/wordSuggestionService';

export default function VoiceNoteOverlayApp({ desktopWindow = false }) {
  const [voiceState, setVoiceState] = useState({
    installed: true,
    config: DEFAULT_VOICE_NOTE_CONFIG,
    listening: false,
    activeCaptureLabel: ''
  });
  const [meter, setMeter] = useState({ level: 0, speaking: false, transcribing: false });
  const [selectedToken, setSelectedToken] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!desktopWindow) return undefined;
    document.documentElement.classList.add('overlay-window-root');
    document.body.classList.add('overlay-window-body');

    let active = true;
    void loadVoiceNoteState()
      .then(s => {
        if (active && s) setVoiceState(s);
      })
      .catch(() => {});

    const offState = window.estraWindow?.onVoiceNoteState?.(s => {
      if (active && s) setVoiceState(s);
    });
    const offMeter = window.estraWindow?.onVoiceNoteMeter?.(m => {
      if (active && m) setMeter(m);
    });
    const offErr = window.estraWindow?.onVoiceNoteError?.(err => {
      if (active) setErrorMsg(typeof err === 'string' ? err : 'ขัดข้อง');
    });

    const onKeyDown = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hideVoiceNoteOverlayWindow();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      active = false;
      offState?.();
      offMeter?.();
      offErr?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [desktopWindow]);

  const config = voiceState?.config || DEFAULT_VOICE_NOTE_CONFIG;
  const listening = Boolean(voiceState?.listening);
  const meterPct = Math.round(Math.max(0, Math.min(1, Number(meter?.level) || 0)) * 100);

  const suggestions = useMemo(() => {
    if (!selectedToken?.tokenText) return [];
    return suggestWordsForToken(selectedToken.tokenText, {
      customDictionary: config.customDictionary,
      corrections: config.corrections,
      maxResults: 5
    });
  }, [selectedToken, config]);

  const handleToggleListening = async () => {
    setErrorMsg('');
    try {
      const next = listening ? await stopVoiceNoteCapture() : await startVoiceNoteCapture();
      if (next) setVoiceState(next);
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'เริ่มจับเสียงไม่สำเร็จ');
    }
  };

  const handleReplace = async (note, tokenIndex, oldWord, newWord, remember = true) => {
    const tokens = segmentNoteTokens(note.text);
    const updatedText = tokens.map((t, idx) => (idx === tokenIndex ? newWord : t.text)).join('');
    const nextNotes = (config.notes || []).map(n =>
      n.id === note.id ? { ...n, text: updatedText } : n
    );
    let nextCorrections = config.corrections || [];
    if (remember && oldWord && oldWord !== newWord) {
      nextCorrections = [
        { wrong: oldWord, correct: newWord },
        ...nextCorrections.filter(c => c.wrong.toLowerCase() !== oldWord.toLowerCase())
      ];
    }
    const saved = await saveVoiceNoteConfig({
      ...config,
      notes: nextNotes,
      corrections: nextCorrections
    });
    if (saved) setVoiceState(saved);
    setSelectedToken(null);
  };

  return (
    <div className="crp-overlay-shell" role="dialog" aria-label="Voice To Note Overlay">
      <header className="crp-ov-header">
        <div className="crp-ov-brand">
          <span className="crp-ov-logo">
            <Mic size={14} />
          </span>
          <div>
            <strong>Voice To Note</strong>
            <small>
              {listening ? (meter.transcribing ? 'กำลังแปลงเสียง...' : 'กำลังจับเสียง') : 'หยุดอยู่'} · {config.toggleOverlayHotkey || 'Alt+V'}
            </small>
          </div>
        </div>

        <div className="crp-ov-head-actions">
          <button
            type="button"
            className={`crp-ov-autohide-btn${listening ? ' active' : ''}`}
            onClick={() => void handleToggleListening()}
          >
            {listening ? <Pause size={12} /> : <Play size={12} />}
            <span>{listening ? 'หยุด' : 'ฟังเสียง'}</span>
          </button>
          <button
            type="button"
            className="crp-ov-close-btn"
            aria-label="ซ่อน Voice To Note Overlay (ESC)"
            onClick={() => void hideVoiceNoteOverlayWindow()}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="voice-ov-meter-strip">
        <div className="voice-meter-track">
          <div className="voice-meter-fill" style={{ width: `${meterPct}%` }} />
        </div>
      </div>

      {errorMsg && <div className="voice-ov-error">{errorMsg}</div>}

      {selectedToken && (
        <div className="voice-ov-sug-bar">
          <div className="voice-ov-sug-title">
            <Wand2 size={12} /> แก้คำ <strong>"{selectedToken.tokenText}"</strong>:
          </div>
          <div className="voice-ov-sug-chips">
            {suggestions.length === 0 ? (
              <small>ไม่พบคำใกล้เคียง</small>
            ) : (
              suggestions.map(s => (
                <button
                  key={s.word}
                  type="button"
                  onClick={() => {
                    const targetNote = (config.notes || []).find(n => n.id === selectedToken.noteId);
                    if (targetNote) {
                      void handleReplace(
                        targetNote,
                        selectedToken.tokenIndex,
                        selectedToken.tokenText,
                        s.word,
                        true
                      );
                    }
                  }}
                >
                  {s.word}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="crp-ov-body">
        <div className="crp-ov-list">
          {(config.notes || []).length === 0 ? (
            <p className="crp-ov-empty">
              กด "ฟังเสียง" ด้านบนเพื่อจับเสียงพูดในเกม FiveM แล้วแปลงเป็นข้อความโน้ตอัตโนมัติ
            </p>
          ) : (
            (config.notes || []).slice(0, 30).map(note => {
              const tokens = segmentNoteTokens(note.text);
              const suspects = new Set(
                findSuspectTokensInText(note.text, {
                  customDictionary: config.customDictionary,
                  corrections: config.corrections
                }).map(s => s.index)
              );
              return (
                <div key={note.id} className="voice-ov-note-item">
                  <div className="voice-ov-note-top">
                    <span className={`voice-src-pill src-${note.source}`}>
                      {note.source === 'mic' ? 'เรา' : note.source === 'system' ? 'ระบบ' : 'ในเกม'}
                    </span>
                    <button
                      type="button"
                      className="voice-ov-copy-btn"
                      onClick={() => {
                        void copyCommandText(note.text).then(() => {
                          setCopiedId(note.id);
                          window.setTimeout(() => setCopiedId(c => (c === note.id ? '' : c)), 1400);
                        });
                      }}
                    >
                      {copiedId === note.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className="voice-tokens-flow">
                    {tokens.map((tok, idx) =>
                      tok.isWord ? (
                        <button
                          key={idx}
                          type="button"
                          className={`voice-token-btn${suspects.has(tok.index) ? ' is-suspect' : ''}`}
                          onClick={() =>
                            setSelectedToken({
                              noteId: note.id,
                              tokenIndex: idx,
                              tokenText: tok.text
                            })
                          }
                        >
                          {tok.text}
                        </button>
                      ) : (
                        <span key={idx}>{tok.text}</span>
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <footer className="crp-ov-footer">
        <span>คลิกที่คำในโน้ตเพื่อเลือก Word Suggestion · กด ESC ซ่อนหน้าต่าง</span>
      </footer>
    </div>
  );
}
