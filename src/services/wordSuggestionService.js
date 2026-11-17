export const THAI_RP_BASE_LEXICON = [
  // Roleplay & Gaming
  'โรลเพลย์', 'สตอรี่', 'อินแคร์', 'เอาท์แคร์', 'ไอซี', 'โอโอซี', 'เซิร์ฟเวอร์', 'เมือง',
  'ตัวละคร', 'ผู้เล่น', 'แอดมิน', 'สตาฟ', 'กติกา', 'ประกาศ', 'กิจกรรม', 'อีเวนต์',
  'ประชุม', 'นัดหมาย', 'รวมตัว', 'รายงานตัว', 'ลงทะเบียน', 'เช็คชื่อ', 'ภารกิจ', 'รางวัล',
  'ปล้น', 'จับกุม', 'ประกันตัว', 'ค่าปรับ', 'คดี', 'สอบสวน', 'หลักฐาน', 'พยาน',
  'โรงพยาบาล', 'หมอ', 'พยาบาล', 'รักษา', 'ชุบชีวิต', 'ฉุกเฉิน', 'ตำรวจ', 'สภ.',
  'นายก', 'รองนายก', 'สภา', 'สภานักเรียน', 'ประธานนักเรียน', 'สารวัตรนักเรียน',
  // School RP & Classes
  'ตารางเรียน', 'วิชา', 'อาจารย์', 'คุณครู', 'นักเรียน', 'นักศึกษา', 'ห้องเรียน',
  'หอประชุม', 'ห้องสมุด', 'ห้องดนตรี', 'ห้องวิทยาศาสตร์', 'โรงอาหาร', 'ดาดฟ้า', 'สนามกีฬา',
  'วิชาคณิตศาสตร์', 'วิชาภาษาไทย', 'วิชาภาษาอังกฤษ', 'วิชาวิทยาศาสตร์', 'วิชาประวัติศาสตร์',
  'วิชาดนตรี', 'วิชาศิลปะ', 'วิชาพละ', 'วิชาป้องกันตัว', 'วิชาปรุงยา', 'วิชาเวทมนตร์',
  'คาบเรียน', 'การบ้าน', 'สอบกลางภาค', 'สอบปลายภาค', 'คะแนน', 'เกรด', 'ชั่วโมง',
  'เวทมนตร์', 'คาถา', 'ไม้กายสิทธิ์', 'อัญเชิญ', 'พลังเวท', 'ศาสตราจารย์',
  // Music & Voice
  'ร้องเพลง', 'ดนตรี', 'กีตาร์', 'เปียโน', 'กลอง', 'ไมโครโฟน', 'คอนเสิร์ต', 'ซ้อมดนตรี',
  'setvoiceintent', 'music', 'speech', 'reloadmap', 'reloadskin', 'roll', 'Discord', 'F8',
  // Common Thai RP conversation words prone to STT distortion
  'ขออนุญาต', 'ขอบคุณ', 'ขอโทษ', 'สวัสดี', 'สวัสดีครับ', 'สวัสดีค่ะ', 'รับทราบ',
  'เข้าใจแล้ว', 'เรียบร้อย', 'กำลังไป', 'รอสักครู่', 'เดี๋ยวนี้', 'สำคัญ', 'ด่วน',
  'ห้ามลืม', 'เตรียมตัว', 'พร้อมแล้ว', 'เริ่มต้น', 'จบคาบ', 'เลิกเรียน', 'พักเที่ยง',
  'อาวุธ', 'เกราะ', 'กระเป๋า', 'กุญแจ', 'โทรศัพท์', 'วิทยุ', 'ความถี่', 'พิกัด'
];

const TONE_AND_SILENT_RE = /[\u0E47-\u0E4E]/g;

export function thaiPhoneticKey(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(TONE_AND_SILENT_RE, '');

  // Common Thai spoken vowel/ending normalizations
  s = s
    .replace(/ำ/g, 'ัม')
    .replace(/ใ|ไ/g, 'ัย')
    .replace(/ฤ/g, 'ริ')
    .replace(/ทร/g, 'ซ')
    .replace(/ศ|ษ|ส|ซ/g, 'S')
    .replace(/ร|ล|ฬ/g, 'L')
    .replace(/ข|ฃ|ค|ฅ|ฆ|ก/g, 'K')
    .replace(/ด|ต|ฎ|ฏ|ฑ|ฒ/g, 'T')
    .replace(/ท|ธ|ถ|ฐ/g, 'H')
    .replace(/พ|ภ|ผ|ฟ|ฝ/g, 'P')
    .replace(/จ|ฉ|ช|ฌ/g, 'C')
    .replace(/น|ณ/g, 'N')
    .replace(/ย|ญ/g, 'Y')
    .replace(/บ|ป/g, 'B')
    .replace(/ว/g, 'W')
    .replace(/ห|ฮ/g, 'H')
    .replace(/ม/g, 'M')
    .replace(/ง/g, 'G')
    .replace(/อ/g, 'O')
    .replace(/ะ/g, '')
    .replace(/า/g, 'A')
    .replace(/[ิีึื]/g, 'I')
    .replace(/[ุู]/g, 'U')
    .replace(/[เแโ]/g, 'E')
    .replace(/ั/g, 'A');

  // Collapse consecutive duplicates (e.g. L + L -> L)
  s = s.replace(/(.)\1+/g, '$1');
  return s;
}

export function levenshteinDistance(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  const prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
  const curr = new Array(s2.length + 1);
  for (let i = 1; i <= s1.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= s2.length; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= s2.length; j += 1) prev[j] = curr[j];
  }
  return prev[s2.length];
}

function normalizedSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return Math.max(0, 1 - levenshteinDistance(a, b) / maxLen);
}

export function segmentNoteTokens(text) {
  const raw = String(text || '');
  if (!raw) return [];

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
      const out = [];
      for (const part of segmenter.segment(raw)) {
        out.push({
          text: part.segment,
          index: part.index,
          isWord: Boolean(part.isWordLike)
        });
      }
      return out;
    } catch {}
  }

  // Fallback regex segmentation
  const out = [];
  const re = /([A-Za-z0-9ก-๙._-]+)|([^A-Za-z0-9ก-๙._-]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    out.push({
      text: m[0],
      index: m.index,
      isWord: Boolean(m[1])
    });
  }
  return out;
}

export function sanitizeDictionaryWords(words = []) {
  if (!Array.isArray(words)) return [];
  const seen = new Set();
  const out = [];
  for (const w of words) {
    const clean = String(w || '').trim().slice(0, 60);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out.slice(0, 400);
}

export function sanitizeCorrectionsList(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const wrong = String(entry.wrong || '').trim().slice(0, 60);
    const correct = String(entry.correct || '').trim().slice(0, 60);
    if (!wrong || !correct || wrong === correct) continue;
    const key = wrong.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ wrong, correct });
  }
  return out.slice(0, 300);
}

export function suggestWordsForToken(
  token,
  { customDictionary = [], corrections = [], maxResults = 5 } = {}
) {
  const clean = String(token || '').trim();
  if (!clean || clean.length < 2) return [];

  const lower = clean.toLowerCase();
  const tokenPhonetic = thaiPhoneticKey(clean);
  const results = new Map();

  // 1. Direct learned corrections first
  for (const pair of corrections) {
    if (!pair?.wrong || !pair?.correct) continue;
    if (pair.wrong.toLowerCase() === lower) {
      results.set(pair.correct.toLowerCase(), {
        word: pair.correct,
        score: 0.99,
        reason: 'คำที่คุณเคยแก้ไว้ (Auto-Learn)'
      });
    }
  }

  // 2. Score custom dictionary + base RP lexicon
  const customSet = new Set(customDictionary.map(w => String(w).trim().toLowerCase()));
  const pool = [...sanitizeDictionaryWords(customDictionary), ...THAI_RP_BASE_LEXICON];

  for (const candidate of pool) {
    const candClean = String(candidate || '').trim();
    if (!candClean) continue;
    const candLower = candClean.toLowerCase();
    if (candLower === lower) continue;

    const textSim = normalizedSimilarity(
      lower.replace(TONE_AND_SILENT_RE, ''),
      candLower.replace(TONE_AND_SILENT_RE, '')
    );
    const candPhonetic = thaiPhoneticKey(candClean);
    const phonSim = normalizedSimilarity(tokenPhonetic, candPhonetic);
    const prefixBonus = candPhonetic.startsWith(tokenPhonetic.slice(0, 2)) ? 0.06 : 0;
    const customBonus = customSet.has(candLower) ? 0.07 : 0;
    const lenRatio =
      Math.min(clean.length, candClean.length) / Math.max(clean.length, candClean.length);

    if (lenRatio < 0.35 && phonSim < 0.75) continue;

    const combined = Math.min(0.98, phonSim * 0.62 + textSim * 0.38 + prefixBonus + customBonus);
    if (combined < 0.48) continue;

    const existing = results.get(candLower);
    const reason = customSet.has(candLower)
      ? 'จากคลังศัพท์ RP ของคุณ'
      : phonSim >= 0.72
        ? 'เสียงอ่านใกล้เคียง'
        : 'ตัวสะกดใกล้เคียง';

    if (!existing || combined > existing.score) {
      results.set(candLower, {
        word: candClean,
        score: Number(combined.toFixed(3)),
        reason
      });
    }
  }

  return Array.from(results.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export function applyLearnedCorrections(text, corrections = []) {
  let output = String(text || '');
  const sorted = sanitizeCorrectionsList(corrections).sort(
    (a, b) => b.wrong.length - a.wrong.length
  );
  let replacementsCount = 0;
  const appliedPairs = [];

  for (const pair of sorted) {
    if (!output.includes(pair.wrong)) continue;
    const escaped = pair.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    const matches = output.match(re);
    if (matches?.length) {
      output = output.replace(re, pair.correct);
      replacementsCount += matches.length;
      appliedPairs.push(pair);
    }
  }

  return { text: output, replacementsCount, appliedPairs };
}

export function findSuspectTokensInText(
  text,
  { customDictionary = [], corrections = [] } = {}
) {
  const tokens = segmentNoteTokens(text);
  const exactKnown = new Set([
    ...THAI_RP_BASE_LEXICON.map(w => w.toLowerCase()),
    ...sanitizeDictionaryWords(customDictionary).map(w => w.toLowerCase())
  ]);
  const suspects = [];

  for (const tok of tokens) {
    if (!tok.isWord || tok.text.trim().length < 2) continue;
    if (exactKnown.has(tok.text.trim().toLowerCase())) continue;
    const suggestions = suggestWordsForToken(tok.text, {
      customDictionary,
      corrections,
      maxResults: 4
    });
    if (suggestions.length > 0 && suggestions[0].score >= 0.62) {
      suspects.push({
        token: tok.text,
        index: tok.index,
        suggestions
      });
    }
  }

  return suspects;
}

export function buildWhisperPrompt(customDictionary = []) {
  const custom = sanitizeDictionaryWords(customDictionary);
  const combined = [...custom.slice(0, 40), ...THAI_RP_BASE_LEXICON.slice(0, 20)];
  return [...new Set(combined)].join(', ').slice(0, 600);
}
