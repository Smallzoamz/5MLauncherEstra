import {
  sanitizeCorrectionsList,
  sanitizeDictionaryWords
} from './wordSuggestionService.js';

const STORAGE_KEY_VOICE_NOTE = 'estra_addon_voice_to_note_v1';

export const AUDIO_SOURCE_MODES = [
  {
    value: 'game',
    label: 'เฉพาะเสียงในเกม FiveM (Process Loopback)',
    help: 'ดักจับเฉพาะเสียงจากโปรเซส FiveM (บน Win 10/11 รุ่นใหม่) เพื่อไม่ให้เสียงเพลง/YouTube นอกเกมปน'
  },
  {
    value: 'system',
    label: 'เสียงระบบทั้งหมด (System Loopback)',
    help: 'จับเสียงที่ออกลำโพงทั้งหมดในเครื่อง (เหมาะสำหรับทดสอบหรือจับเสียง Discord/เกมรวมกัน)'
  },
  {
    value: 'mic',
    label: 'ไมโครโฟนของเรา (Microphone)',
    help: 'จับเสียงพูดจากไมโครโฟนของคุณเองสำหรับจดโน้ตด้วยเสียง'
  },
  {
    value: 'both',
    label: 'ทั้งเสียงในเกม + ไมโครโฟน',
    help: 'จับทั้งเสียงที่ได้ยินในเกม [ในเกม] และเสียงไมโครโฟนของเรา [เรา] พร้อมกัน'
  }
];

export const STT_ENGINES = [
  {
    value: 'cloud-groq',
    label: 'Groq Whisper API (แนะนำ — ไวมากและไม่กิน FPS เกม)',
    defaultModel: 'whisper-large-v3-turbo',
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions'
  },
  {
    value: 'cloud-openai',
    label: 'OpenAI Whisper API',
    defaultModel: 'whisper-1',
    endpoint: 'https://api.openai.com/v1/audio/transcriptions'
  },
  {
    value: 'cloud-custom',
    label: 'Custom Whisper Server (OpenAI-Compatible URL)',
    defaultModel: 'whisper-1',
    endpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions'
  },
  {
    value: 'local-whisper',
    label: 'Local Whisper ในเครื่อง (ฟรี/Offline 100% — ดาวน์โหลดโมเดลลง Add-on)',
    defaultModel: 'small-q5_1',
    endpoint: ''
  }
];

export const LOCAL_WHISPER_MODELS = [
  {
    id: 'small-q5_1',
    label: 'Whisper Small (Quantized Q5_1 · ~190 MB — แนะนำสำหรับภาษาไทย)',
    filename: 'ggml-small-q5_1.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
  },
  {
    id: 'base',
    label: 'Whisper Base (~148 MB — เบาและประมวลผลเร็ว)',
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
  }
];

export const VOICE_NOTE_HOTKEYS = [
  { value: 'Alt+V', label: 'Alt + V (แนะนำ)' },
  { value: 'Ctrl+Shift+V', label: 'Ctrl + Shift + V' },
  { value: 'F6', label: 'F6' },
  { value: 'F10', label: 'F10' }
];

export const VOICE_NOTE_POSITIONS = [
  { value: 'bottom-left', label: 'มุมซ้ายล่าง (Bottom-Left)' },
  { value: 'bottom-right', label: 'มุมขวาล่าง (Bottom-Right)' },
  { value: 'top-left', label: 'มุมซ้ายบน (Top-Left)' },
  { value: 'top-right', label: 'มุมขวาบน (Top-Right)' }
];

export const VOICE_LANGUAGES = [
  { value: 'th', label: 'ภาษาไทย (ปนอังกฤษ RP)' },
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'ตรวจจับภาษาอัตโนมัติ (Auto)' }
];

export const DEFAULT_VOICE_NOTE_CONFIG = {
  enabled: true,
  audioSource: 'game',
  sttEngine: 'cloud-groq',
  apiKey: '',
  customEndpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions',
  cloudModel: 'whisper-large-v3-turbo',
  localModelId: 'small-q5_1',
  language: 'th',
  vadSensitivity: 0.014,
  maxChunkSeconds: 8,
  autoApplyCorrections: true,
  toggleOverlayHotkey: 'Alt+V',
  overlayPosition: 'bottom-left',
  customDictionary: ['โรลเพลย์', 'สภานักเรียน', 'setvoiceintent', 'reloadskin', 'reloadmap'],
  corrections: [
    { wrong: 'โลเพ', correct: 'โรลเพลย์' },
    { wrong: 'โลลเพล', correct: 'โรลเพลย์' },
    { wrong: 'สะพา', correct: 'สภา' }
  ],
  notes: []
};

export function normalizeVoiceHotkey(raw) {
  const clean = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const matched = VOICE_NOTE_HOTKEYS.find(
    item => item.value.toLowerCase().replace(/\s+/g, '') === clean
  );
  return matched ? matched.value : 'Alt+V';
}

export function normalizeVoicePosition(raw) {
  const clean = String(raw || '').trim().toLowerCase();
  const matched = VOICE_NOTE_POSITIONS.find(item => item.value === clean);
  return matched ? matched.value : 'bottom-left';
}

export function sanitizeNoteEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = String(entry.text || '').trim().slice(0, 4000);
  if (!text) return null;
  const source = ['game', 'system', 'mic'].includes(entry.source) ? entry.source : 'game';
  const createdAt = Number(entry.createdAt);
  return {
    id: String(entry.id || '').trim().slice(0, 64) || `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    rawText: String(entry.rawText || text).trim().slice(0, 4000),
    source,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    pinned: Boolean(entry.pinned)
  };
}

export function sanitizeVoiceNoteConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const audioSource = AUDIO_SOURCE_MODES.some(m => m.value === src.audioSource) ? src.audioSource : 'game';
  const sttEngine = STT_ENGINES.some(e => e.value === src.sttEngine) ? src.sttEngine : 'cloud-groq';
  const localModelId = LOCAL_WHISPER_MODELS.some(m => m.id === src.localModelId) ? src.localModelId : 'small-q5_1';
  const language = VOICE_LANGUAGES.some(l => l.value === src.language) ? src.language : 'th';
  const vadRaw = Number(src.vadSensitivity);
  const vadSensitivity = Number.isFinite(vadRaw) ? Math.max(0.003, Math.min(0.15, vadRaw)) : 0.014;
  const chunkRaw = Number(src.maxChunkSeconds);
  const maxChunkSeconds = Number.isFinite(chunkRaw) ? Math.max(4, Math.min(20, Math.round(chunkRaw))) : 8;

  const engineMeta = STT_ENGINES.find(e => e.value === sttEngine);
  const cloudModel = String(src.cloudModel || engineMeta?.defaultModel || 'whisper-large-v3-turbo')
    .trim()
    .slice(0, 80);

  return {
    enabled: src.enabled !== false,
    audioSource,
    sttEngine,
    apiKey: String(src.apiKey || '').trim().slice(0, 300),
    customEndpoint: String(src.customEndpoint || 'http://127.0.0.1:8080/v1/audio/transcriptions')
      .trim()
      .slice(0, 500),
    cloudModel: cloudModel || 'whisper-large-v3-turbo',
    localModelId,
    language,
    vadSensitivity,
    maxChunkSeconds,
    autoApplyCorrections: src.autoApplyCorrections !== false,
    toggleOverlayHotkey: normalizeVoiceHotkey(src.toggleOverlayHotkey),
    overlayPosition: normalizeVoicePosition(src.overlayPosition),
    customDictionary: sanitizeDictionaryWords(
      Array.isArray(src.customDictionary) ? src.customDictionary : DEFAULT_VOICE_NOTE_CONFIG.customDictionary
    ),
    corrections: sanitizeCorrectionsList(
      Array.isArray(src.corrections) ? src.corrections : DEFAULT_VOICE_NOTE_CONFIG.corrections
    ),
    notes: Array.isArray(src.notes)
      ? src.notes.map(sanitizeNoteEntry).filter(Boolean).slice(0, 200)
      : []
  };
}

function normalizeAddonEnvelope(raw) {
  return {
    installed: Boolean(raw?.installed),
    manifest: raw?.manifest || null,
    config: sanitizeVoiceNoteConfig(raw?.config || DEFAULT_VOICE_NOTE_CONFIG),
    listening: Boolean(raw?.listening),
    overlayVisible: Boolean(raw?.overlayVisible),
    localEngineReady: Boolean(raw?.localEngineReady),
    localModelReady: Boolean(raw?.localModelReady),
    localModelsDownloaded: Array.isArray(raw?.localModelsDownloaded) ? raw.localModelsDownloaded : [],
    activeCaptureLabel: String(raw?.activeCaptureLabel || ''),
    installDir: String(raw?.installDir || '')
  };
}

function readLocalVoiceEnvelope() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VOICE_NOTE);
    if (!raw) return normalizeAddonEnvelope({ installed: false });
    return normalizeAddonEnvelope(JSON.parse(raw));
  } catch {
    return normalizeAddonEnvelope({ installed: false });
  }
}

function writeLocalVoiceEnvelope(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY_VOICE_NOTE,
      JSON.stringify({
        installed: Boolean(state?.installed),
        manifest: state?.manifest || null,
        config: sanitizeVoiceNoteConfig(state?.config || DEFAULT_VOICE_NOTE_CONFIG),
        installDir: String(state?.installDir || '')
      })
    );
  } catch {}
}

export async function loadVoiceNoteState() {
  if (typeof window !== 'undefined' && window.estraWindow?.getVoiceNoteState) {
    const state = await window.estraWindow.getVoiceNoteState();
    const norm = normalizeAddonEnvelope(state);
    writeLocalVoiceEnvelope(norm);
    return norm;
  }
  return readLocalVoiceEnvelope();
}

export async function installVoiceNoteAddon() {
  if (typeof window !== 'undefined' && window.estraWindow?.installVoiceNoteAddon) {
    const state = await window.estraWindow.installVoiceNoteAddon();
    const norm = normalizeAddonEnvelope(state);
    writeLocalVoiceEnvelope(norm);
    return norm;
  }
  const next = normalizeAddonEnvelope({
    installed: true,
    manifest: {
      id: 'voice-to-note',
      version: '1.0.0',
      installedAt: Date.now(),
      enabled: true
    },
    config: DEFAULT_VOICE_NOTE_CONFIG,
    installDir: 'browser-storage'
  });
  writeLocalVoiceEnvelope(next);
  return next;
}

export async function uninstallVoiceNoteAddon() {
  if (typeof window !== 'undefined' && window.estraWindow?.uninstallVoiceNoteAddon) {
    const state = await window.estraWindow.uninstallVoiceNoteAddon();
    try { localStorage.removeItem(STORAGE_KEY_VOICE_NOTE); } catch {}
    return normalizeAddonEnvelope(state);
  }
  try { localStorage.removeItem(STORAGE_KEY_VOICE_NOTE); } catch {}
  return normalizeAddonEnvelope({ installed: false });
}

export async function saveVoiceNoteConfig(nextConfig) {
  const clean = sanitizeVoiceNoteConfig(nextConfig);
  if (typeof window !== 'undefined' && window.estraWindow?.setVoiceNoteConfig) {
    const state = await window.estraWindow.setVoiceNoteConfig(clean);
    const norm = normalizeAddonEnvelope(state);
    writeLocalVoiceEnvelope(norm);
    return norm;
  }
  const current = readLocalVoiceEnvelope();
  const next = normalizeAddonEnvelope({ ...current, config: clean });
  writeLocalVoiceEnvelope(next);
  return next;
}

export async function startVoiceNoteCapture() {
  if (typeof window !== 'undefined' && window.estraWindow?.startVoiceNoteCapture) {
    return normalizeAddonEnvelope(await window.estraWindow.startVoiceNoteCapture());
  }
  throw new Error('การจับเสียงจากเกมผ่าน WASAPI Loopback รองรับใน Estra Desktop App บน Windows');
}

export async function stopVoiceNoteCapture() {
  if (typeof window !== 'undefined' && window.estraWindow?.stopVoiceNoteCapture) {
    return normalizeAddonEnvelope(await window.estraWindow.stopVoiceNoteCapture());
  }
  return readLocalVoiceEnvelope();
}

export async function downloadLocalWhisperRuntime(modelId = 'small-q5_1') {
  if (typeof window !== 'undefined' && window.estraWindow?.downloadLocalWhisper) {
    return normalizeAddonEnvelope(await window.estraWindow.downloadLocalWhisper(modelId));
  }
  throw new Error('การดาวน์โหลด Local Whisper Engine รองรับใน Estra Desktop App');
}

export async function toggleVoiceNoteOverlayWindow(visible = null) {
  if (typeof window !== 'undefined' && window.estraWindow?.toggleVoiceNoteOverlay) {
    return window.estraWindow.toggleVoiceNoteOverlay(visible);
  }
  return false;
}

export async function hideVoiceNoteOverlayWindow() {
  if (typeof window !== 'undefined' && window.estraWindow?.hideVoiceNoteOverlay) {
    return window.estraWindow.hideVoiceNoteOverlay();
  }
  return false;
}
