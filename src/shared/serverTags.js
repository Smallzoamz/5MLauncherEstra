export const CATEGORY_TAGS = ['RP', 'SRP', 'RP Commu', 'Commu', 'Training', 'School'];
export const SERVER_TAGS = ['ไม่มี', ...CATEGORY_TAGS];
export const DEFAULT_SERVER_TAG = 'RP';

const TAG_LOOKUP = new Map([
  ['roleplay', 'RP'],
  ['rp', 'RP'],
  ['srp', 'SRP'],
  ['rp commu', 'RP Commu'],
  ['commu', 'Commu'],
  ['training', 'Training'],
  ['school', 'School'],
  ['ไม่มี', 'ไม่มี']
]);

export function normalizeServerTag(raw, fallback = DEFAULT_SERVER_TAG) {
  const cleaned = typeof raw === 'string' ? raw.trim() : '';
  if (!cleaned) return fallback;
  return TAG_LOOKUP.get(cleaned.toLowerCase()) || fallback;
}
