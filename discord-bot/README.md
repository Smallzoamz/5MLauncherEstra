# Estra Bot — Official Discord Bot for Estra FiveM Launcher

บอทสำหรับเซิร์ฟเวอร์ Discord ของ **Estra FiveM Launcher** (`Estra Launcher`) พัฒนาด้วย Node.js ESM (`>=22`), `discord.js` v14 และ `node:sqlite` (zero native build dependencies)

## ความสามารถหลัก

1. **Automated Server Setup & Persistent Panels (`/setup`)**
   - จัดโครงสร้าง 6 หมวดหมู่, ห้องสถานะ Live Telemetry, ห้องต้อนรับ/Verify, ห้องดาวน์โหลดตรง, ห้องอัปเดต, คู่มือ FAQ แบบ Interactive, ห้องแชท/โชว์ผลงาน, ระบบ Ticket และห้อง Staff Logs
   - วางและอัปเดตข้อความพาเนลแบบ In-Place (ไม่โพสต์ซ้ำ)
2. **Live Telemetry & Auto-Release Watcher**
   - ดึงข้อมูลจริงจาก `https://estralauncher.vercel.app/api/stats` (พร้อม fallback ไป GitHub Releases)
   - อัปเดต Rich Presence ของบอทและ Voice Counter (`🟢 ออนไลน์ / ในเมือง`, `⬇️ ดาวน์โหลด`) พร้อมตัวกัน Rate Limit (cooldown >= 11 นาทีต่อช่อง)
   - ตรวจพบเวอร์ชันใหม่แล้วโพสต์แจ้งเตือนใน `🚀・updates-changelog` (แท็กเฉพาะผู้รับยศ `@Release Ping`) พร้อมอัปเดตการ์ดดาวน์โหลดใน `⚡・download-estra` อัตโนมัติ
3. **Interactive Download, SHA-256 & FiveM Preflight Tools**
   - `/estra` — แสดงการ์ดข้อมูลเวอร์ชันล่าสุด ปุ่มโหลดตรง และสถิติจริง
   - `/verify-hash` — เทียบค่า SHA-256 ของไฟล์ `.exe` ที่ผู้ใช้โหลดมากับฐานข้อมูล Release อย่างเป็นทางการ
   - `/fivem-check` — ตรวจสถานะเซิร์ฟเวอร์ FiveM (`cfx.re/join/code` หรือ `ip:port`) พร้อมแสดง `sv_enforceGameBuild` / `sv_pureLevel` และพารามิเตอร์ที่ Estra ส่งเข้า FiveM (มี SSRF protection บล็อก IP ภายใน)
   - `/patch-template` — แสดงเทมเพลต `patch-manifest.json` สำหรับเจ้าของเมืองที่ต้องการเชื่อม Pre-Launch City Patcher
4. **Verify, Release Ping & Support Ticket System**
   - ปุ่มรับยศ `Estra Member` (ปลดล็อกแชท/เสียง/Ticket) และปุ่ม Toggle `Release Ping`
   - Ticket แบบแบ่ง 3 หมวด (`🐛 แจ้งบั๊ก`, `🏙️ City Patcher / Partner`, `💡 เสนอฟีเจอร์`) เปิด Modal ก่อนสร้างห้องส่วนตัว พร้อมปุ่ม `Claim`, `/ticket add|remove|close` และส่งไฟล์ `.txt` Transcript เข้า `📋・bot-logs` อัตโนมัติ

## โครงสร้างไฟล์และการตั้งค่า

1. คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่าคอนฟิกให้ครบ:
   - `DISCORD_TOKEN` — Bot Token จาก Discord Developer Portal
   - `DISCORD_CLIENT_ID` — Application / Client ID
   - `DISCORD_CLIENT_SECRET` — OAuth2 Client Secret (สงวนไว้หากต่อยอด Web Dashboard)
   - `DISCORD_GUILD_ID` — Guild ID ของเซิร์ฟเวอร์เป้าหมาย
2. สิทธิ์และ Intents ที่ใช้ใน Discord Developer Portal:
   - **Privileged Gateway Intents:** `Server Members Intent` (สำหรับ Welcome Card & Log สมาชิกเข้า/ออก)
   - **Bot Permissions:** `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Manage Messages`, `Manage Threads` (หรือ `Administrator` ในช่วงตั้งค่าเซิร์ฟเวอร์)

## คำสั่งรันและทดสอบ

```powershell
cd discord-bot
npm install
npm test             # ทดสอบ Unit Tests แบบออฟไลน์ทั้งหมด
npm run setup-guild  # จัดห้อง/ยศ วางพาเนล และลงทะเบียน Slash Commands เข้า Guild
npm start            # รันบอทออนไลน์ตลอดเวลา
```
