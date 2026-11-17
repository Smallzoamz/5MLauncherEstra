export const CRP_OVERLAY_ADDON_ID = 'fivem-crp-srp-overlay';
export const VOICE_NOTE_ADDON_ID = 'voice-to-note';

export const ADDONS_CATALOG = [
  {
    id: CRP_OVERLAY_ADDON_ID,
    name: 'FiveM C-RP-SRP Overlay',
    shortName: 'C-RP-SRP Overlay',
    version: '1.0.0',
    author: 'Estra Studio',
    category: 'Roleplay & Utility Overlay',
    tagline: 'ผู้ช่วยเล่น RP / School-RP บนหน้าจอเกม พร้อมตารางแจ้งเตือนและศูนย์คำสั่งลัด F8',
    description:
      'ฟีเจอร์เสริมแบบติดตั้ง/ถอนการติดตั้งได้ในคลิกเดียว สำหรับผู้เล่นสาย Roleplay และ School-RP: รวมตารางแจ้งเตือน Event หรือตารางเรียนวิชาสำคัญ และศูนย์คำสั่งลัดพร้อมตัวสร้างคำสั่ง /roll ผ่าน F8 หลายครั้งในคลิกเดียว',
    highlights: [
      'ตารางแจ้งเตือน Event และตารางเรียน (รายสัปดาห์ / เฉพาะวัน) พร้อมแจ้งเตือนล่วงหน้าแบบ Overlay ไม่เด้งหลุดจากเกม',
      'F8 Multi-Roll Builder เลือกจำนวนครั้งได้ (เช่น 4 ครั้ง -> roll;roll;roll;roll) คัดลอกไปวางใน F8 ทันที',
      'คำสั่งลัดสำคัญพร้อมใช้ (/reloadmap, /reloadskin, setvoiceintent music / speech) และเพิ่มคำสั่งเองได้ไม่จำกัด',
      'หน้าต่าง Overlay ลอยบนจอ กดคีย์ลัดเปิด-ปิดได้ทันทีขณะเล่น FiveM (Windowed / Borderless)'
    ],
    defaultHotkey: 'Alt+O'
  },
  {
    id: VOICE_NOTE_ADDON_ID,
    name: 'Voice To Note',
    shortName: 'Voice To Note',
    version: '1.0.0',
    author: 'Estra Studio',
    category: 'Audio & RP Notes',
    tagline: 'จับเสียงพูดภายในเกม FiveM แปลงเป็นข้อความโน้ต พร้อมระบบ Word Suggestion แก้คำเพี้ยนอัตโนมัติ',
    description:
      'ฟีเจอร์เสริมแบบติดตั้ง/ถอนการติดตั้งได้แยกต่างหาก สำหรับดักจับเสียงพูดภายในเกม FiveM (ผ่าน WASAPI Loopback ปลอดภัย 100% ไม่แตะไฟล์เกม) แปลงเป็นข้อความโน้ตอัตโนมัติ พร้อมระบบแนะนำคำแก้คำเพี้ยน (Word Suggestion) และคลังศัพท์ RP ส่วนตัว',
    highlights: [
      'จับเสียงเฉพาะจากเกม FiveM (Windows Process Loopback) หรือเสียงระบบ/ไมโครโฟน โดยไม่ยุ่งกับ Memory ของเกม',
      'รองรับทั้งโหมด Cloud Whisper API (Groq / OpenAI / Custom — ไม่กิน FPS เกม) และ Local Whisper ฟรีในเครื่อง',
      'ระบบ Word Suggestion เทียบเสียงอ่านภาษาไทย + คลังศัพท์ RP ให้คลิกแก้คำเพี้ยนในโน้ตได้ใน 1 คลิก',
      'จดจำคู่คำแก้ไข (Auto-Learn) เพื่อช่วยแก้คำที่เพี้ยนบ่อยให้อัตโนมัติ พร้อมหน้าต่าง Overlay ลอยดูโน้ตระหว่างเล่น'
    ],
    defaultHotkey: 'Alt+V'
  }
];

export function getAddonCatalogEntry(addonId = CRP_OVERLAY_ADDON_ID) {
  return ADDONS_CATALOG.find(item => item.id === addonId) || null;
}
