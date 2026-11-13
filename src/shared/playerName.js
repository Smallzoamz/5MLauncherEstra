export function validatePlayerName(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Name ต้องไม่เกิน 100 ตัวอักษรและไม่มีอักขระควบคุม');
  return value.trim();
}
