# Estra FiveM Launcher — Windows Installer

## ติดตั้งและเปิดใช้งาน
1. เปิด `release/Estra-FiveM-Launcher-Setup-1.7.1-x64.exe`
2. เลือกโฟลเดอร์ติดตั้งและทำตามขั้นตอน Setup
3. เปิด **Estra FiveM Launcher** จาก Desktop หรือ Start Menu
4. กดเฟือง > ตรวจสอบพาธ FiveM แล้วเลือกเซิร์ฟเวอร์และกดเล่น

ตัวติดตั้งสำหรับ Windows x64 รวม Electron runtime แล้ว **ไม่ต้องติดตั้ง Node.js/npm หรือเปิด terminal**
ต้องติดตั้ง FiveM/เกมที่รองรับไว้ก่อน ตัวติดตั้งนี้ไม่ได้รวมไฟล์เกม

ติดตั้งแบบ per-user ไม่ต้องเพิ่มสิทธิ์ administrator โปรแกรมติดตั้งมีตัวถอนการติดตั้งใน Windows Installed apps
การถอนการติดตั้งตั้งค่าให้เก็บ preferences ของแอปไว้ ไม่ลบเกม FiveM หรือข้อมูลเกม

## รุ่นล่าสุด 1.7.1
ตรวจ Game Build และ Pure Mode ปัจจุบันก่อนเปิดเกมทุกครั้ง ทั้งปุ่มเล่น ประวัติ และเมนู Tray แล้วส่งค่าให้ FiveM ตั้งแต่เริ่มเกม รวมถึง Pure Mode 0 ถ้าตรวจไม่ได้จะแจ้งข้อผิดพลาดแทนการใช้ค่าเก่า รายละเอียดและข้อจำกัดใน [SERVER_REQUIREMENTS.md](SERVER_REQUIREMENTS.md)

## รุ่นก่อน 1.4.0
Estra FiveM Launcher พร้อมหน้าต่างไร้แถบชื่อและชุดโลโก้ใหม่ ตัวติดตั้ง release/Estra-FiveM-Launcher-Setup-1.4.0-x64.exe รายละเอียดใน ESTRA_RELEASE.md เก็บข้อมูลเดิมด้วย app ID, origin และโฟลเดอร์ profile เดิม

## รุ่นก่อน 1.3.0
ตัวติดตั้ง: release/FiveM-Launcher-Setup-1.3.0-x64.exe เพิ่ม process guard และข้อยกเว้น CL2 ตาม PROCESS_GUARD.md ชุดทดสอบ 28/28 ผ่าน และตรวจพบ FiveM ที่เปิดอยู่จริงพร้อมปฏิเสธ normal launch ด้วย HTTP 409

## รุ่นก่อน 1.2.0
ตัวติดตั้งล่าสุด: release/FiveM-Launcher-Setup-1.2.0-x64.exe (112,918,932 bytes) เพิ่มแบนเนอร์เมืองและแอนิเมชัน UI ดู [BANNERS_AND_MOTION.md](BANNERS_AND_MOTION.md)
ทดสอบ packaged executable ผ่าน รวมการแสดงแบนเนอร์จริงและ persistence หลักฐาน: tests/artifacts/desktop-packaged-1.2.0.json
ไม่ได้ติดตั้งทับรุ่นของผู้ใช้: พบทางลัด Launcher ที่มีอยู่ จึงหยุด installer QA ก่อนเริ่มติดตั้ง หลักฐานติดตั้ง/ถอนติดตั้งด้านล่างเป็นของ 1.1.0

## ไฟล์ส่งมอบรอบก่อน (1.1.0)
- `release/FiveM-Launcher-Setup-1.1.0-x64.exe` — installer หลัก แจกไฟล์นี้ได้โดยไม่ต้องแจก node_modules
- `release/SHA256SUMS.txt` — checksum ตรวจไฟล์
- `release/win-unpacked/FiveM Launcher.exe` — ใช้ทดสอบจากโฟลเดอร์ unpacked ต้องเก็บไฟล์ข้างเคียงครบ ไม่ใช่ single-file portable executable
- `tests/artifacts/desktop-installed-1.1.0.json` — ผล smoke test แอปหลังติดตั้ง
- `tests/artifacts/installer-uninstall-1.1.0.json` — ผลตรวจถอนการติดตั้ง

เวอร์ชัน 1.1.0 แก้แหล่งโลโก้เมืองและปรับ UI ตาม reference รายละเอียดใน [REDESIGN.md](REDESIGN.md)
ขนาด installer 112,916,719 bytes (~107.7 MiB) เก็บ installer รุ่น 1.0.0 เดิมไว้ด้วย

## รายละเอียดการแพ็ก
Electron 44.2.0, electron-builder 26.15.3, NSIS, x64
แอปใช้ sandbox/contextIsolation และปิด nodeIntegration ใน renderer
backend ใช้ loopback พอร์ตว่างอัตโนมัติ และ frontend ใช้ origin คงที่ `launcher://app` เพื่อเก็บ preferences ข้ามการเปิดใหม่
หน้าต่างใหม่/การนำทางไปเว็บภายนอกถูกปิด ไม่อนุญาตกล้อง และอนุญาตเฉพาะการขอไมโครโฟนจากหน้าแอป
ข้อมูลของรุ่นติดตั้งแยกจาก localStorage ใน Chrome/Edge ของรุ่น browser เดิม ไม่ได้ย้ายข้อมูลอัตโนมัติ

## สถานะลายเซ็น
ไฟล์นี้ **ยังไม่มี digital code-signing certificate** และไม่มี publisher signature Windows/SmartScreen อาจแสดงคำเตือนผู้เผยแพร่ที่ยังไม่รู้จัก
ไม่มีการซื้อใบรับรอง ปิดระบบความปลอดภัย หรือเปลี่ยน policy Windows ระหว่างการทำงานนี้

## ทดสอบรอบนี้ (1.1.0)
- ชุดทดสอบเดิม 22/22 ผ่าน และ dev/preview API regression ผ่าน
- Desktop development, packaged และ installed app: โหลดหน้าต่าง/API ได้, พบ installation ของ FiveM, unauthorized mutation 403, invalid input 400
- renderer ไม่มี Node, sandbox/contextIsolation เปิด, secure origin
- synthetic microphone capture ผ่าน และ camera permission ถูกปฏิเสธ
- ปิด/เปิดใหม่ยังเก็บ localStorage, ไม่พบ pageerror, ไม่เปิด popup เว็บภายนอก
- ติดตั้งจริงแบบ silent ใน `F:/5MLauncher/.installer-qa/v1.1.0` แล้วทดสอบแอปจากไฟล์ที่ติดตั้ง
- ตรวจ Desktop และ Start Menu shortcuts ชี้ถูกต้อง
- ถอนติดตั้งออกจากโฟลเดอร์ QA: exit 0, ไฟล์แอป/shortcuts/Uninstall registry ถูกนำออก
- โลโก้จริงเทียบตรงกับ info.json และรูปแสดงสำเร็จ; search/filter/select, รูปเสีย/ไม่มีรูป, ชื่อไทยยาว 100 ตัวอักษร, widths 1366/900/390/320 และ reduced motion ผ่าน
- ไม่เปิดเกมจริง ไม่ล้างแคชจริง และไม่ได้ทดสอบ installer บนเครื่อง Windows เครื่องอื่น

## สร้างซ้ำสำหรับผู้พัฒนา
```powershell
npm ci
npm run dist:win
```
หาก npm install ไม่ได้ติดตั้ง Electron binary ให้รัน `node node_modules/electron/install.js`
สำหรับทดสอบ desktop ใช้ Playwright ที่ติดตั้งอยู่และ `npm run test:desktop`
`LAUNCHER_PACKAGED_EXE` กำหนด executable ที่ต้องการทดสอบ และ `LAUNCHER_TEST_USER_DATA` ใช้ profile เฉพาะ automation

อ้างอิง: [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol/) และ [NSIS configuration](https://www.electron.build/nsis/)





## ผลแพ็กล่าสุด 1.3.0
ไฟล์โปรแกรมที่แพ็กผ่าน process guard ขณะ FiveM เปิดจริง, CL2 toggle, live banner, API, sandbox, microphone และ reopen persistence รายงาน tests/artifacts/desktop-packaged-1.3.0.json ตัวติดตั้งขนาด 112,919,620 bytes ยังไม่มีลายเซ็น ไม่ได้ติดตั้งทับรุ่นของผู้ใช้



## ผลแพ็กล่าสุด Estra 1.4.0
ตัวติดตั้งขนาด 113,125,404 bytes ชื่อ process และ Windows ProductName/FileDescription เป็น Estra FiveM Launcher ไอคอนใหม่ตรวจจาก exe แล้ว Window controls และ desktop regression ผ่าน ดู ESTRA_RELEASE.md ไม่ได้ติดตั้งทับโปรแกรมของผู้ใช้

