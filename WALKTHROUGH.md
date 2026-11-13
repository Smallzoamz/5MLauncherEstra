# ผลการตรวจและปรับปรุง FiveM Launcher

**อัปเดต 1.1.0:** แก้โลโก้เมืองและปรับหน้า Launcher ตาม reference พร้อมตัวติดตั้งใหม่ ดูแผนใน REDESIGN.md และผล packaged/installed/uninstall รอบล่าสุดใน INSTALLER.md ข้อความด้านล่างเป็นหลักฐานของรอบปรับปรุง local web application ก่อนทำ installer ภาพ live-desktop.png อัปเดตเป็น UI รุ่น 1.1.0 แล้ว

ตรวจวันที่ 5 กันยายน 2026 เอกสารนี้แทนบันทึกเก่าที่อ้าง “100%” โดยไม่มีชุดทดสอบประกอบ
ต้นฉบับ source/config/docs อยู่ .backups/before-functional-upgrade

## สิ่งที่แก้
- แชร์ API เดียวระหว่าง dev, preview และ standalone production server เพิ่ม npm start และ Start-Launcher.cmd
- จำกัด local API ด้วย loopback + Host/Origin check + mutation token + bounded body + serialization
- ตรวจที่อยู่ IP/domain/Cfx join ก่อนเรียก API และ spawn โดยไม่มี shell ไม่เปิด protocol ซ้ำ
- รอ process spawn/error ก่อนรายงานผล ตรวจพาธจริง ไม่มีการแก้ CitizenFX.ini อัตโนมัติ
- cache allowlist ตรวจ junction รวมถึงลูกโฟลเดอร์ก่อนเริ่มลบ ไม่ force kill เกม รายงาน partial failure
- ถอด random player count, online fallback และโปรไฟล์ผู้ใช้สมมติ
- ใช้ settings จริง: พาธ, auto cache, mic check, Steam/Discord requirement, อุปกรณ์ไมค์
- แก้ IP validation, refresh/poll ที่ไม่ทับ state ใหม่, favorites/empty persistence, settings cancel/reset
- ป้องกัน late mic streams หลังปิด/เปลี่ยนอุปกรณ์, reset loopback, permission error, keyboard/focus/responsive dialogs

## หลักฐานที่รันจริง
| การตรวจ | ผล |
| --- | --- |
| npm test | ผ่าน 18 tests, ไม่มี skip |
| npm run build | ผ่าน Vite 6.4.3 |
| npm run test:runtime | dev และ preview: HTML 200, session API, unauthorized mutation 403 |
| npm run test:ui | ผ่าน UI CRUD/validation/settings/failure flows และ successful mocked launch |
| Browser sizes | desktop 1366x900 และ widths 900, 390, 320 ไม่มี horizontal overflow |
| Modal mobile | อยู่ใน viewport, Tab วนใน dialog, Escape ปิดและคืน focus |
| Microphone | denial แสดง error; synthetic capture/loopback/track release ผ่าน |
| Live production smoke | HTML/API ทำงาน, installation found, ไม่มี pageerror |
| npm package audit ระหว่าง lockfile sync | 0 vulnerabilities ณ เวลาตรวจ |

Live snapshot เวลา 12:18 น. (Asia/Bangkok): พบ FiveM.exe ที่ installation เริ่มต้น, Steam และ Discord เปิดอยู่, Noxtis Legacy ตอบ 50/800 คน, Game Build 3095, Pure 0 จำนวนคนและเวลาตอบอาจเปลี่ยนได้
ไฟล์ tests/artifacts/live-smoke.json มี checkedAt UTC และรายละเอียด; ภาพ live-desktop.png เป็นหน้าจอจาก API จริง
ภาพ desktop.png/mobile.png/mobile-settings.png มาจาก deterministic UI fixtures

## ยังไม่ได้ยืนยันด้วยเกม/ฮาร์ดแวร์จริง
- ไม่เปิด FiveM จริงระหว่าง QA: spawn success/error ทดสอบด้วย process adapter จำลอง ส่วนพาธการติดตั้งตรวจจากเครื่องจริง
- ไม่ได้ทดสอบ login, เข้าเมืองสำเร็จ, whitelist, การเปลี่ยน build หรือ CL2 จริง
- ไม่ได้ลบแคชเกมจริงหรือเปลี่ยน config เกม การทดสอบลบบน temporary fixtures รวมทั้งทดสอบ junction และ running-process guard
- ไม่ได้ฟังเสียงจากไมค์/หูฟังจริงหรือทดสอบ voice ภายในเกม
- Cfx join query ผ่าน fixture contract; live smoke รอบนี้ใช้ direct IP ไม่ได้ยืนยัน Cfx master API กับ join code จริง
- Start-Launcher.cmd ตรวจเนื้อหาและทดสอบคำสั่ง build/start แยกแล้ว แต่ไม่ได้ double-click จาก Windows Explorer
- local application พร้อมใช้งานผ่าน npm start ยังไม่มี installer .exe หรือ code signing

## ขอบเขตการออกแบบ
เก็บ favorites/preferences ใน browser storage เท่านั้น ไม่มีฐานข้อมูล, login หรือ cloud sync
Build/pure เป็นข้อมูล read-only ที่ server กำหนด ชื่อในเกมเดิมเปลี่ยน label เป็นบันทึกส่วนตัวให้ตรงการทำงาน
ล้างแคชปฏิเสธ path links เพื่อลดความเสี่ยง แต่ไม่อ้างว่าป้องกันผู้โจมตีที่มีสิทธิ์แก้ filesystem ในเครื่องพร้อมกันได้ทุกกรณี


