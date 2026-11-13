# แผนปรับปรุง FiveM Launcher ให้ใช้งานได้จริง

วันที่ตรวจ: 2026-09-05 — Windows local launcher บน React 19 / Vite 6 / Node.js ไม่มีฐานข้อมูลหรือระบบบัญชีของตัวเอง รายการโปรดเป็นข้อมูลส่วนตัวใน browser storage

## ผลตรวจจากโค้ด
- API อยู่เฉพาะ Vite configureServer จึงหายเมื่อใช้ production preview
- launch ไม่ตรวจผล backend และเปิด protocol ซ้ำ; input ถูกต่อเข้า shell
- สถานะ fallback, จำนวนคนใหม่ และบัญชี Discord บางกรณีเป็นข้อมูลสมมติ
- cache cleaner บังคับปิดเกมและรายงานสำเร็จแม้ลบบางส่วนล้มเหลว
- path/auto cache/mic settings ไม่เชื่อมเส้นทาง launch; stream อาจเปิดค้างเมื่อปิด modal ขณะรอ permission
- ไม่มีชุดทดสอบ; workspace ไม่มี Git สำรองไว้ .backups/before-functional-upgrade

## ขั้นตอนและเกณฑ์ยอมรับ
1. สัญญาข้อมูล — src/shared/target.js: ตรวจ IP/domain/port/Cfx join; ปฏิเสธ shell syntax ตรวจด้วย node:test
2. backend/runtime — src/server/*, vite.config.js, package.json, Start-Launcher.cmd: API เดียวกันใน dev/preview/start, listen loopback, ตรวจ Host/Origin และ session token สำหรับ mutation, จำกัด body/timeout ทดสอบ HTTP allowed/denied
3. เปิดเกม/แคช — fivemBackend.js: resolve installation, spawn ไม่มี shell รอ spawn/error, ไม่เขียน CitizenFX.ini อัตโนมัติ ให้ FiveM ใช้ build ที่ server บังคับ, ล้าง allowlist ปฏิเสธ junction และเกมที่กำลังรัน ทดสอบ temporary fixtures
4. UI/state — services/components: ยกเลิกข้อมูลสมมติ, poll พร้อม stale-response guard, เชื่อม settings, validation, empty/error/loading, คืนค่าฟอร์มเมื่อยกเลิก, keyboard/modal/mobile
5. เสียง — audioService/MicTestModal: ไม่ถามสิทธิ์เมื่อเปิดหน้า, ปิด stream เมื่อยกเลิก pending request/ปิด modal, reset loopback, แสดง permission error บันทึก device preference
6. ส่งมอบ — npm test, npm run build, smoke dev/preview/production, browser desktop/mobile และ README/WALKTHROUGH บอกผลจริง

## ขอบเขตความเสี่ยง
- ไม่เปิดเกม ไม่ล้างแคชจริง ไม่แก้ config เกมจริงระหว่าง automated QA
- ตรวจ live status แบบ read-only; game login/whitelist/voice ต้องพิสูจน์กับเกมและบัญชีผู้ใช้
- เป็น local web application ไม่ใช่ packaged .exe ไม่เพิ่ม Electron/platform dependency
- build/pure/count/ping ที่ไม่ทราบต้องแสดงไม่ทราบ
- ดู https://docs.fivem.net/docs/client-manual/console-commands/ และ https://docs.fivem.net/docs/client-manual/running-two-fivem-clients/ สำหรับ connect/CL2


## แผนต่อยอดตัวติดตั้ง Windows .exe (2026-09-05)
ผู้ใช้อนุมัติให้ทำ installer: ใช้ Electron + electron-builder/NSIS แบบ per-user x64 รวม runtime ไม่ต้องลง Node.js บนเครื่องปลายทาง
1. แยก localServer ให้เปิด/ปิดจาก browser runner และ Electron ได้ ตรวจ regression tests
2. Desktop main: sandbox/context isolation, ปิด Node ใน renderer, จำกัด navigation/permissions, single instance, stable launcher://app origin สำหรับ preferences, backend บน loopback random port
3. สร้าง NSIS setup, shortcuts และ uninstaller โดยไม่ลบ app data เมื่อถอนติดตั้ง
4. ทดสอบ unpacked/packaged app, renderer/API/storage/sandbox และติดตั้ง/ถอนติดตั้งในพาธ QA แยก
5. ส่งมอบ installer, SHA256, คู่มือ และสถานะ code signing ตามจริง

## รอบ 1.1.0: โลโก้และหน้าตา Launcher
ดำเนินการตามแผนใน [REDESIGN.md](REDESIGN.md): ใช้ไอคอนจาก info.json, ย้ายข้อมูลเก่า, ปรับ hero/sidebar/dashboard, ทดสอบ responsive/ระบบเดิม และแพ็ก installer ใหม่

## รอบ 1.2.0: Banner และ motion
ตรวจฟิลด์ server banner → resolve direct image ของ host ที่พบ → preload/crossfade พร้อม cancellation/fallback → ปรับ interaction/dialog motion → ทดสอบ regression และ packaged app → ส่งตัวติดตั้งใหม่ รายละเอียดและหลักฐานใน BANNERS_AND_MOTION.md

## รอบ 1.3.0: FiveM process guard
เพิ่มการตรวจ process ที่แยกจากชื่อ Launcher, ปิดปุ่ม Play และตรวจซ้ำใน backend, รองรับ CL2/auto-cache และทดสอบทั้ง fixture กับ process ที่กำลังทำงานจริง ดู PROCESS_GUARD.md

## รอบ 1.4.0: Estra
ออกแบบ identity เวกเตอร์และ export icon → frameless window พร้อม restricted IPC และ window menu → เปลี่ยนชื่อ executable/product โดยรักษา profile เดิม → ตรวจ runtime/window controls/metadata และแพ็ก installer รายละเอียดใน ESTRA_RELEASE.md

## 1.5.0 — launch / city background / Tray
Completed: diagnose direct-child launch and missing live banner fields; dispatch through Explorer with URI/CL2; main-process Tray and guarded session tracking; per-city theme and optional custom banner; unit/UI/native/packaged verification; NSIS installer. See TRAY_AND_LAUNCH_FIXES.md and release/verification-1.5.0.json. Real FiveM connection remains unverified because the user already had a live session.

## 1.6.0 — Name / Offline / account profiles / maintenance
Completed: inspect actual nickname storage and current account interfaces; validate Discord Application ID from user; safe atomic nickname update; reachability classification; Steam ActiveUser + Discord RPC; measured maintenance allowlist; unit/browser/native/package verification. See PROFILES_NAME_MAINTENANCE.md for evidence and live-game limits.

## 1.7.0 — launch history and last-city shortcut
Implemented: bounded local attempt history, shared launch preflight with application-wide duplicate guard, history dialog and replay, validated Tray label plus fixed launch request, safe handling of removed/retargeted cities, unit/UI/native/packaged checks and NSIS installer. See LAUNCH_HISTORY.md for behavior and verification scope.
