# Estra FiveM Launcher (Windows local application)

เปิด FiveM ไปยังเซิร์ฟเวอร์ที่บันทึกไว้ ตรวจสถานะเซิร์ฟเวอร์ ตรวจโปรแกรม Steam/Discord และทดสอบไมโครโฟนจากหน้า local browser

## เปิดใช้งาน

**รุ่นติดตั้ง Windows x64:** เปิด `release/Estra-FiveM-Launcher-Setup-1.7.1-x64.exe` แล้วเปิด Estra FiveM Launcher จาก Desktop/Start Menu ไม่ต้องติดตั้ง Node.js หรือเปิด terminal ดูรายละเอียดและผลทดสอบใน [INSTALLER.md](INSTALLER.md)

**รุ่น browser / สำหรับพัฒนา:** ต้องมี Windows, Node.js 22 ขึ้นไป และ FiveM ที่ติดตั้งแล้ว ใช้ Chrome/Edge

- ดับเบิลคลิก `Start-Launcher.cmd` เพื่อ build และเปิดหน้าเมื่อ local server พร้อม
- หรือเปิด PowerShell ที่ `F:\5MLauncher` แล้วรัน:

```powershell
npm ci
npm run build
npm start
```

เปิด http://127.0.0.1:5199 และเปิดหน้าต่าง terminal ค้างไว้ ใช้ Ctrl+C เพื่อหยุด server
`npm start -- --open` จะเปิด browser อัตโนมัติบน Windows
หากพอร์ต 5199 ถูกใช้ ให้ปิด Launcher เดิม หรือใช้ `$env:PORT='5200'; npm start`

รุ่น browser ใช้ local Node backend ส่วนรุ่นติดตั้งรวม runtime ไว้ใน Electron แล้ว การคัดลอกเฉพาะ dist ไป static hosting จะไม่มี API สำหรับเปิดเกม/ล้างแคช

รุ่น 1.1.0 ปรับหน้าตาตาม reference และแก้โลโก้เป็นไอคอนจริงจากเซิร์ฟเวอร์ ดูแผนและหลักฐานใน [REDESIGN.md](REDESIGN.md) กด “เมืองของฉัน” เพื่อค้นหา/เลือกเมือง และ “รายละเอียดเมือง” เพื่อแก้ข้อมูล

รุ่น 1.2.0 เพิ่มพื้นหลังจากแบนเนอร์ของแต่ละเมือง และแอนิเมชัน UI ดูรายละเอียดและผลทดสอบใน [BANNERS_AND_MOTION.md](BANNERS_AND_MOTION.md)

รุ่น 1.3.0 ตรวจ process FiveM และปิดปุ่มเริ่มเกมเมื่อเกมกำลังทำงาน ยกเว้นเปิด CL2 ดู [PROCESS_GUARD.md](PROCESS_GUARD.md)

รุ่น 1.4.0 เปลี่ยนชื่อเป็น Estra FiveM Launcher ใช้หน้าต่างไร้แถบชื่อ Windows และชุดโลโก้/ไอคอนใหม่ เมนูจุดสามจุดมุมขวาบนใช้ย่อ ขยาย และปิดแอป ลากพื้นที่ว่างด้านบนเพื่อย้ายหน้าต่าง ดู [ESTRA_RELEASE.md](ESTRA_RELEASE.md)

## การใช้งาน

1. กดตั้งค่า (เฟือง) และตรวจสอบพาธ เว้นว่างเพื่อตรวจ `%LOCALAPPDATA%\FiveM` หรือระบุ FiveM.exe, โฟลเดอร์ติดตั้ง หรือ FiveM.app
2. เพิ่มเซิร์ฟเวอร์ด้วย IPv4:port, โดเมน:port หรือ `cfx.re/join/code` / `https://cfx.re/join/code` พอร์ตที่ไม่ระบุใช้ 30120
3. หน้าแสดงจำนวนคนจากเซิร์ฟเวอร์ที่เลือกและตรวจใหม่ทุก 30 วินาที ปุ่มรีเฟรชตรวจทันที คำว่า “ตรวจสอบไม่ได้” อาจเกิดจากเครือข่าย/HTTP ไม่ตอบ ไม่ยืนยันว่าเกมเซิร์ฟเวอร์ปิด
4. กดเช็คไมค์และอนุญาตสิทธิ์ ใช้หูฟังถ้าเปิดฟังเสียงตัวเอง ปิดหน้าทดสอบเพื่อคืนอุปกรณ์
5. กดเล่น ส่งคำสั่งไป FiveM.exe ครั้งเดียว ระบบรายงานเมื่อส่งคำสั่งสำเร็จ ผลการเข้าเมือง/ล็อกอิน/whitelist ให้ดูในเกม

## พฤติกรรมที่ควรทราบ

- ก่อนเปิดเกมทุกครั้ง Launcher ตรวจ Game Build และ Pure Mode จากเซิร์ฟเวอร์ปัจจุบัน แล้วส่ง `-b<build>` และ `-pure_<level>` ให้ FiveM ตั้งแต่เริ่ม รวมถึง Pure Mode 0 โดยไม่เขียน CitizenFX.ini ถ้าตรวจค่าไม่ได้จะหยุดและแจ้งข้อผิดพลาด ดู [SERVER_REQUIREMENTS.md](SERVER_REQUIREMENTS.md)
- ช่อง Name บันทึกค่าที่ FiveM ใช้ก่อนส่งคำสั่งเปิดเกม โดยต้องปิด FiveM ก่อนเปลี่ยนชื่อ ไม่เปลี่ยนชื่อตัวละคร RP ที่เมืองจัดการเอง
- CL2 ส่ง `-cl2` สำหรับ FiveM/GTA V Legacy ส่วน Enhanced ใช้ระบบ Launch Additional Client ของ FiveM
- Steam/Discord แสดง process และชื่อ/รูปบัญชีปัจจุบันเมื่ออ่านได้ ไม่ยืนยันสิทธิ์ whitelist ของเมือง
- Auto Mic Check ตรวจเปิดอุปกรณ์และสิทธิ์ ไม่ประเมินว่าเสียงพูดชัดหรือได้ยินในเกม
- ล้างแคชลบเฉพาะ server-cache, server-cache-priv, cache/subprocess เก็บ game-storage และ cache/game ไว้ ต้องปิด FiveM ก่อน และปฏิเสธ symlink/junction
- รายการโปรดและ preferences เก็บเฉพาะ browser profile และ origin นี้ ไม่มี cloud sync การเปลี่ยน localhost เป็น 127.0.0.1 หรือเปลี่ยนพอร์ตจะใช้ storage คนละชุด
- ไฟล์ .ini ที่ดาวน์โหลดเป็นตัวอย่างอ้างอิง ไม่ใช่ config เต็ม ห้ามนำไปแทนที่ไฟล์เดิมทั้งไฟล์
- API listen เฉพาะ 127.0.0.1 ตรวจ Host/Origin และ token สำหรับคำสั่งเปลี่ยนแปลง ไม่ควรนำ local launcher ไปเปิดเป็น public server

## ทดสอบ

```powershell
npm test
npm run build
npm run test:runtime
```

Browser tests ต้องมี Playwright พร้อม Chromium และมี `npm start` ที่พอร์ต 5199
ใช้ Playwright ที่ติดตั้งในเครื่อง โดยกำหนด `PLAYWRIGHT_MODULE_PATH` เป็นพาธ package หากไม่อยู่ใน project dependencies

```powershell
$env:PLAYWRIGHT_MODULE_PATH='C:/path/to/node_modules/playwright'
npm run test:ui
node tests/live-smoke.cjs
```

- `test:ui` จำลอง transport ของ launch/cache ไม่เปิดเกมและไม่ลบแคชจริง
- `ui-success.cjs` ใช้อุปกรณ์เสียงจำลองของ Chromium ไม่บันทึกเสียงจากไมค์จริง
- `live-smoke.cjs` ตรวจการติดตั้งและสถานะจริงแบบอ่านอย่างเดียว ต้องติดตั้ง FiveM และสร้าง screenshot/JSON ใน tests/artifacts
- backend tests ลบเฉพาะ fixtures ที่สร้างใต้ temporary directory ของการทดสอบ
- ดูผลรอบนี้ใน WALKTHROUGH.md และแผนใน IMPLEMENTATION_PLAN.md

## อ้างอิง FiveM

- [connect command](https://docs.fivem.net/docs/client-manual/console-commands/)
- [CL2 และความแตกต่างระหว่าง Legacy/Enhanced](https://docs.fivem.net/docs/client-manual/running-two-fivem-clients/)






รุ่น 1.5.0 เปิด FiveM ผ่าน Windows Explorer, เพิ่ม System Tray/เปิดกลับหลังเกมปิด และธีมแยกเมืองเมื่อเซิร์ฟเวอร์ไม่ประกาศแบนเนอร์ พร้อมตั้ง URL รูปเอง ดู [TRAY_AND_LAUNCH_FIXES.md](TRAY_AND_LAUNCH_FIXES.md)

รุ่น 1.6.0 ใช้ Name ของเมืองใน FiveM, แสดง Offline, แสดงชื่อ/รูปบัญชีปัจจุบันของ Steam และ Discord และเพิ่มการตรวจ/ล้าง Log, Crash, Shader ใน Settings ดู [PROFILES_NAME_MAINTENANCE.md](PROFILES_NAME_MAINTENANCE.md)

รุ่น 1.7.0 เพิ่มปุ่มรูปนาฬิกา “ประวัติการเปิดเกม” ในแถบซ้าย เก็บ 50 ครั้งล่าสุดพร้อมผลการส่งคำสั่ง และเมนู Tray “เข้าเมืองล่าสุด” ใช้เมืองล่าสุดที่ส่งคำสั่งสำเร็จกับการตั้งค่าปัจจุบัน ตรวจ Name/CL2/ไมค์/แคชตามขั้นตอนเดิม ดู [LAUNCH_HISTORY.md](LAUNCH_HISTORY.md)
