export const AVATAR_PALETTE = [
  '#2b6bf3',
  '#0ea5e9',
  '#6366f1',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899'
];

export const MAX_AVATAR_URL_LENGTH = 500;
export const MAX_AVATAR_DATA_URL_LENGTH = 45_000;

const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i;
const CONTROL_OR_SPACE_RE = /[\s\u0000-\u001F\u007F]/;

export function validateAvatarUrl(raw) {
  if (raw === undefined || raw === null) {
    return { valid: true, value: '', error: '' };
  }
  const value = String(raw).trim();
  if (!value) {
    return { valid: true, value: '', error: '' };
  }

  if (/^data:image\/svg\+xml/i.test(value)) {
    return { valid: false, value: '', error: 'ไม่รองรับไฟล์ SVG สำหรับรูปโปรไฟล์ (รองรับ PNG, JPG, WebP หรือลิงก์ HTTPS)' };
  }

  if (DATA_IMAGE_RE.test(value)) {
    if (value.length > MAX_AVATAR_DATA_URL_LENGTH) {
      return { valid: false, value: '', error: 'รูปโปรไฟล์มีขนาดใหญ่เกินกำหนด กรุณาลองรูปอื่น' };
    }
    return { valid: true, value, error: '' };
  }

  if (value.length > MAX_AVATAR_URL_LENGTH || CONTROL_OR_SPACE_RE.test(value)) {
    return { valid: false, value: '', error: 'ลิงก์รูปโปรไฟล์ต้องเป็น HTTPS ความยาวไม่เกิน 500 ตัวอักษร' };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return { valid: false, value: '', error: 'ลิงก์รูปโปรไฟล์ต้องขึ้นต้นด้วย https://' };
    }
    return { valid: true, value: parsed.toString(), error: '' };
  } catch {
    return { valid: false, value: '', error: 'รูปแบบรูปโปรไฟล์ไม่ถูกต้อง (รองรับอัปโหลด PNG/JPG/WebP หรือลิงก์ HTTPS)' };
  }
}

export async function resizeAvatarImageFileToDataUrl(file) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    throw new Error('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG หรือ WebP)');
  }
  if (/svg/i.test(file.type)) {
    throw new Error('ไม่รองรับไฟล์ SVG กรุณาใช้ PNG, JPG หรือ WebP');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('ไฟล์รูปต้นฉบับต้องมีขนาดไม่เกิน 10 MB');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
      el.src = objectUrl;
    });

    const targetSize = 128;
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ไม่สามารถเตรียมพื้นที่ปรับขนาดรูปภาพได้');

    const srcW = img.naturalWidth || img.width || targetSize;
    const srcH = img.naturalHeight || img.height || targetSize;
    const cropSize = Math.min(srcW, srcH);
    const sx = Math.max(0, Math.floor((srcW - cropSize) / 2));
    const sy = Math.max(0, Math.floor((srcH - cropSize) / 2));

    ctx.clearRect(0, 0, targetSize, targetSize);
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, targetSize, targetSize);

    const attempts = [
      ['image/webp', 0.86],
      ['image/webp', 0.72],
      ['image/jpeg', 0.82],
      ['image/jpeg', 0.66],
      ['image/jpeg', 0.5]
    ];

    for (const [mime, quality] of attempts) {
      const candidate = canvas.toDataURL(mime, quality);
      if (DATA_IMAGE_RE.test(candidate) && candidate.length <= MAX_AVATAR_DATA_URL_LENGTH) {
        return candidate;
      }
    }
    throw new Error('รูปภาพยังใหญ่เกินกำหนดหลังบีบอัด กรุณาเลือกรูปอื่น');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
