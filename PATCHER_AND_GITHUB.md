# คู่มือระบบ Rust/Tauri v2, Patcher และวิธีปล่อยอัปเดตบน GitHub

## 1. โครงสร้างใหม่ (Rust + Tauri v2)
- **Frontend UI:** `src/` (React 19 + Vite)
- **Rust Backend & Desktop Shell:** `src-tauri/src/`
  - `lib.rs` / `main.rs` — หน้าต่างไร้กรอบ (frameless), System Tray, Single Instance และ Tauri Commands
  - `fivem.rs` / `player_name.rs` — ตรวจพาธ FiveM, ยิง query Cfx.re / Direct HTTP, เขียน `nickOverride` ลง LevelDB (`Default/Local Storage/leveldb` และ fallback พาธเดิม), เปิด FiveM ผ่าน Windows Explorer
  - `presence.rs` — ตรวจ process Windows, Steam ActiveUser/Avatar, Discord RPC pipe
  - `maintenance.rs` — ล้างแคชเซิร์ฟเวอร์, Log, Crash reports, Shader cache อย่างปลอดภัย
  - `session.rs` — ติดตาม session ของ FiveM (รองรับ CL2) และซ่อน/คืนหน้าต่างอัตโนมัติ
  - `patcher.rs` — ระบบ Auto-Update ตัวลันเชอร์ (`tauri-plugin-updater`) + ระบบ City Resource Patcher (ตรวจ/โหลดไฟล์ผ่าน HTTPS + ยืนยัน SHA-256)

## 2. การตั้งค่า GitHub Repository สำหรับ Auto-Update ตัวลันเชอร์
1. โปรเจกต์นี้ตั้งค่า GitHub Repository เริ่มต้นไว้ที่ `Smallzoamz/5MLauncherEstra` ใน:
   - `src-tauri/tauri.conf.json` (`plugins.updater.endpoints`)
   - `src/shared/patcherConfig.js` (`DEFAULT_GITHUB_REPO`)
   - `src-tauri/src/patcher.rs` (`DEFAULT_GITHUB_REPO`)
   *(นอกจากนี้ผู้ใช้ยังสามารถเปลี่ยน `owner/repo` ได้จากในหน้า **การตั้งค่า** หรือหน้า **Patcher & อัปเดต** ได้ทันที)*
2. นำ Private Key จากไฟล์ `.tauri/updater.key` (ไฟล์นี้ถูกซ่อนใน `.gitignore` และห้ามอัปขึ้น GitHub) ไปใส่ใน GitHub Repository Settings → **Secrets and variables** → **Actions**:
   - `TAURI_SIGNING_PRIVATE_KEY` = เนื้อหาทั้งหมดใน `.tauri/updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = เว้นว่าง (หรือรหัสผ่านถ้าตั้งไว้)
3. เมื่อ Push tag เวอร์ชัน (เช่น `git tag v2.0.1 && git push origin v2.0.1`) ไฟล์ `.github/workflows/release.yml` จะสร้างตัวติดตั้ง Windows + `latest.json` + `.sig` และเผยแพร่ขึ้น GitHub Releases อัตโนมัติ

## 3. รูปแบบไฟล์ `patch-manifest.json` สำหรับ City Patcher
อัปโหลดไฟล์นี้ขึ้น GitHub Repo หรือ GitHub Releases แล้วนำลิงก์ **HTTPS** มาใส่ใน **ตั้งค่ารายละเอียดเมือง → Patch Manifest URL** หรือในหน้า **Patcher & อัปเดต**:

```json
{
  "version": "1.0.0",
  "name": "Estra City Patch",
  "notes": "- อัปเดตไฟล์เสียงและเมนูในเมือง\n- แก้ไขไฟล์คอนฟิกหลัก",
  "publishedAt": "2026-11-13T12:00:00Z",
  "files": [
    {
      "path": "citizen/common/data/example.meta",
      "url": "https://github.com/OWNER/REPO/releases/download/patch-1.0.0/example.meta",
      "sha256": "<ค่า SHA-256 64 ตัวอักษร>",
      "size": 1024
    }
  ]
}
```

- ไฟล์แพตช์ทั้งหมดจะถูกโหลดเข้า `FiveM.app/estra-patches/<serverId>/` โดยตรวจ SHA-256 ก่อนย้ายไฟล์จริงทุกครั้ง

## 4. คำสั่ง Build และทดสอบบนเครื่อง
```powershell
npm test                  # ทดสอบ Unit Tests ฝั่ง JS/Shared
cargo test --manifest-path src-tauri/Cargo.toml   # ทดสอบ Unit Tests ฝั่ง Rust
npm run tauri:dev         # เปิดโหมดพัฒนา Tauri (Rust + Vite)
npm run tauri:build       # บิลด์ไฟล์ติดตั้ง Windows (.exe) ไว้ใน src-tauri/target/release/bundle/nsis/
```
