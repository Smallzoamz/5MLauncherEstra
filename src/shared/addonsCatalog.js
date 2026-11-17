export const CRP_OVERLAY_ADDON_ID = 'fivem-crp-srp-overlay';

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
  }
];

export function getAddonCatalogEntry(addonId = CRP_OVERLAY_ADDON_ID) {
  return ADDONS_CATALOG.find(item => item.id === addonId) || null;
}
