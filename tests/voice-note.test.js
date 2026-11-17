import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDONS_CATALOG,
  CRP_OVERLAY_ADDON_ID,
  VOICE_NOTE_ADDON_ID,
  getAddonCatalogEntry
} from '../src/shared/addonsCatalog.js';
import {
  applyLearnedCorrections,
  buildWhisperPrompt,
  findSuspectTokensInText,
  segmentNoteTokens,
  suggestWordsForToken,
  thaiPhoneticKey
} from '../src/services/wordSuggestionService.js';
import {
  DEFAULT_VOICE_NOTE_CONFIG,
  installVoiceNoteAddon,
  loadVoiceNoteState,
  normalizeVoiceHotkey,
  normalizeVoicePosition,
  sanitizeVoiceNoteConfig,
  saveVoiceNoteConfig,
  uninstallVoiceNoteAddon
} from '../src/services/voiceNoteService.js';

async function withMockLocalStorage(fn) {
  const store = new Map();
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => { store.set(key, String(val)); },
    removeItem: key => { store.delete(key); }
  };
  try {
    return await fn(store);
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
}

test('addonsCatalog registers Voice To Note separately from FiveM C-RP-SRP Overlay', () => {
  assert.equal(ADDONS_CATALOG.length, 2);
  const crp = getAddonCatalogEntry(CRP_OVERLAY_ADDON_ID);
  const voice = getAddonCatalogEntry(VOICE_NOTE_ADDON_ID);
  assert.ok(crp);
  assert.ok(voice);
  assert.equal(voice.name, 'Voice To Note');
  assert.equal(voice.defaultHotkey, 'Alt+V');
});

test('wordSuggestionService computes Thai phonetic keys and suggests corrections for garbled RP words', () => {
  assert.equal(thaiPhoneticKey('สะพา'), thaiPhoneticKey('สภา'));
  assert.equal(thaiPhoneticKey('โล'), thaiPhoneticKey('โร'));

  const sugRoleplay = suggestWordsForToken('โลเพ', {
    customDictionary: ['โรลเพลย์'],
    corrections: [{ wrong: 'โลเพ', correct: 'โรลเพลย์' }]
  });
  assert.equal(sugRoleplay[0].word, 'โรลเพลย์');

  const sugStudentCouncil = suggestWordsForToken('สะพานักเลียน', {
    customDictionary: ['สภานักเรียน']
  });
  assert.equal(sugStudentCouncil[0].word, 'สภานักเรียน');

  const sugMusic = suggestWordsForToken('musci', {
    customDictionary: ['music']
  });
  assert.equal(sugMusic.some(s => s.word === 'music'), true);

  const corrected = applyLearnedCorrections('วันนี้ สะพานักเลียน ฝึก โลเพ', [
    { wrong: 'โลเพ', correct: 'โรลเพลย์' },
    { wrong: 'สะพานักเลียน', correct: 'สภานักเรียน' }
  ]);
  assert.equal(corrected.text, 'วันนี้ สภานักเรียน ฝึก โรลเพลย์');
  assert.equal(corrected.replacementsCount, 2);

  const tokens = segmentNoteTokens('วันนี้ วิชา โลเพ');
  assert.equal(tokens.some(t => t.isWord && t.text === 'โลเพ'), true);

  const suspects = findSuspectTokensInText('วันนี้ วิชา โลเพ', {
    customDictionary: ['โรลเพลย์'],
    corrections: []
  });
  assert.equal(suspects.some(s => s.token === 'โลเพ'), true);

  const prompt = buildWhisperPrompt(['วิชาเวทมนตร์', 'สภานักเรียน']);
  assert.match(prompt, /วิชาเวทมนตร์/);
});

test('voiceNoteService install, config save, sanitization, and uninstall lifecycle works cleanly', async () => {
  assert.equal(normalizeVoiceHotkey('ctrl + shift + v'), 'Ctrl+Shift+V');
  assert.equal(normalizeVoiceHotkey('bad'), 'Alt+V');
  assert.equal(normalizeVoicePosition('TOP-RIGHT'), 'top-right');
  assert.equal(normalizeVoicePosition('bad'), 'bottom-left');

  const sanitized = sanitizeVoiceNoteConfig({
    ...DEFAULT_VOICE_NOTE_CONFIG,
    vadSensitivity: 5,
    maxChunkSeconds: 99,
    sttEngine: 'local-whisper',
    localModelId: 'base'
  });
  assert.equal(sanitized.vadSensitivity, 0.15);
  assert.equal(sanitized.maxChunkSeconds, 20);
  assert.equal(sanitized.sttEngine, 'local-whisper');
  assert.equal(sanitized.localModelId, 'base');

  await withMockLocalStorage(async () => {
    const before = await loadVoiceNoteState();
    assert.equal(before.installed, false);

    const installed = await installVoiceNoteAddon();
    assert.equal(installed.installed, true);
    assert.equal(installed.config.audioSource, 'game');

    const updated = await saveVoiceNoteConfig({
      ...installed.config,
      audioSource: 'mic',
      customDictionary: ['วิชาปรุงยา', 'ฮอกวอตส์']
    });
    assert.equal(updated.config.audioSource, 'mic');
    assert.equal(updated.config.customDictionary.includes('วิชาปรุงยา'), true);

    const removed = await uninstallVoiceNoteAddon();
    assert.equal(removed.installed, false);
  });
});
