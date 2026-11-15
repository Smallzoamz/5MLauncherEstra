import React from 'react';
import {
  BookOpen,
  CheckCircle2,
  AlertCircle,
  FolderCog,
  Plus,
  Headphones,
  Trash2,
  Users,
  Sparkles
} from 'lucide-react';

export default function GuideModal({
  isOpen,
  onClose,
  settings,
  gameEnv,
  servers = [],
  isFirstVisit = false,
  onOpenSettings,
  onOpenNewServerModal,
  onOpenMicTest,
  onOpenCacheModal
}) {
  if (!isOpen) return null;

  const detectedFivemRoot = settings?.fivemPath || (gameEnv?.fivem?.found ? gameEnv.fivem.root : '');
  const fivemReady = Boolean(detectedFivemRoot);
  const serverCount = servers.length;

  const jumpTo = fn => {
    onClose();
    fn?.();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="คู่มือการตั้งค่าและการใช้งานครั้งแรก"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            <BookOpen size={18} />
            <div>
              <div>คู่มือการตั้งค่าและคำแนะนำการใช้งาน</div>
              <small className="guide-subtitle">
                {isFirstVisit
                  ? 'ยินดีต้อนรับสู่ Estra FiveM Launcher — ตั้งค่า 3 ขั้นตอนสั้นๆ ก่อนเข้าเมืองแรกของคุณ'
                  : 'เปิดดูได้ตลอดเวลาจากปุ่ม คำแนะนำ ด้านบนหรือแถบเครื่องมือซ้าย'}
              </small>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="modal-body guide-modal-body">
          <div className="guide-readiness-grid" aria-label="สถานะความพร้อมเบื้องต้น">
            <div className={`guide-status-card${fivemReady ? ' ready' : ' pending'}`}>
              <div className="guide-status-head">
                {fivemReady ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <strong>1. พาธ FiveM</strong>
              </div>
              <p>
                {fivemReady
                  ? `พร้อมใช้งาน: ${detectedFivemRoot}`
                  : 'ยังไม่ได้ตั้งค่าพาธ FiveM.exe (กดตั้งค่าเพื่อตรวจจับหรือติดตั้งอัตโนมัติ)'}
              </p>
              <button type="button" className="btn-inline-cobalt" onClick={() => jumpTo(onOpenSettings)}>
                <FolderCog size={13} />
                ตั้งค่า FiveM
              </button>
            </div>

            <div className={`guide-status-card${serverCount > 0 ? ' ready' : ' pending'}`}>
              <div className="guide-status-head">
                {serverCount > 0 ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <strong>2. เมืองที่บันทึกไว้</strong>
              </div>
              <p>
                {serverCount > 0
                  ? `มีเมืองในรายการแล้ว ${serverCount} เมือง พร้อมเชื่อมต่อ`
                  : 'ลันเชอร์เริ่มต้นยังว่างเปล่า — เพิ่ม IP หรือคำสั่ง connect เพื่อเลือกเมืองของคุณ'}
              </p>
              <button type="button" className="btn-inline-cobalt" onClick={() => jumpTo(onOpenNewServerModal)}>
                <Plus size={13} />
                เพิ่มเซิร์ฟเวอร์
              </button>
            </div>
          </div>

          <ol className="guide-step-list">
            <li className="guide-step-item">
              <span className="guide-step-num">1</span>
              <div className="guide-step-copy">
                <strong>ชี้โฟลเดอร์ FiveM หรือติดตั้ง FiveM.exe ให้เรียบร้อย</strong>
                <p>
                  ไปที่เมนู <b>การตั้งค่า</b> เพื่อตรวจหา GTA V และ FiveM อัตโนมัติ หากยังไม่มีสามารถกดติดตั้ง FiveM.exe
                  ได้จากในหน้าตั้งค่า และเปิดระบบตรวจ Discord/Steam อัตโนมัติก่อนเข้าเมืองได้
                </p>
              </div>
            </li>

            <li className="guide-step-item">
              <span className="guide-step-num">2</span>
              <div className="guide-step-copy">
                <strong>วาง IP, ลิงก์ Cfx.re หรือคำสั่ง <code>connect</code> ได้ทันที</strong>
                <p>
                  กดปุ่ม <b>+ เพิ่มเซิร์ฟเวอร์</b> แล้ววาง IP เช่น <code>127.0.0.1:30120</code>,{' '}
                  <code>cfx.re/join/xxxxx</code> หรือวางทั้งประโยค <code>connect ...</code> ที่คัดลอกมาได้เลย
                  ระบบจะตัดคำว่า <code>connect</code> ออกให้เอง และดึง<b>ชื่อเซิร์ฟเวอร์กลาง</b>จากสารบัญให้อัตโนมัติ
                </p>
              </div>
            </li>

            <li className="guide-step-item">
              <span className="guide-step-num">3</span>
              <div className="guide-step-copy">
                <strong>เช็กเสียงไมโครโฟนและล้างแคชได้อย่างปลอดภัย</strong>
                <p>
                  ใช้เครื่องมือ <b>ทดสอบไมค์</b> ก่อนเข้าเมืองเพื่อความมั่นใจว่าเสียงเข้าถูกต้อง และสามารถใช้{' '}
                  <b>ล้างแคช FiveM</b> เมื่อเกิดปัญหาไฟล์เมืองค้างโดยไม่ลบข้อมูลเกมหลักหรือการตั้งค่าของคุณ
                </p>
                <div className="guide-step-links">
                  <button type="button" className="guide-mini-btn" onClick={() => jumpTo(onOpenMicTest)}>
                    <Headphones size={13} /> ทดสอบไมค์
                  </button>
                  <button type="button" className="guide-mini-btn" onClick={() => jumpTo(onOpenCacheModal)}>
                    <Trash2 size={13} /> ล้างแคช FiveM
                  </button>
                </div>
              </div>
            </li>

            <li className="guide-step-item">
              <span className="guide-step-num">4</span>
              <div className="guide-step-copy">
                <strong>เล่นกับเพื่อนและตามเข้าเมืองเดียวกัน</strong>
                <p>
                  แถบเพื่อนด้านขวาจะแสดงเมืองที่เพื่อนกำลังเล่นจากชื่อเมืองจริงที่เพิ่มไว้ในลันเชอร์
                  พร้อมปุ่มชวนเล่นและกดเข้าร่วมเมืองเดียวกันได้ทันที
                </p>
                <div className="guide-step-note">
                  <Users size={13} /> สถานะ &ldquo;กำลังเล่น...&rdquo; จะไม่แสดงชื่อเมืองเริ่มต้นแปลกปลอมถ้าเพื่อนยังไม่ได้เพิ่มเมืองใดๆ
                </div>
              </div>
            </li>
          </ol>

          <div className="guide-footer-actions">
            <button type="button" className="soft-button" onClick={() => jumpTo(onOpenNewServerModal)}>
              <Plus size={14} /> เพิ่มเซิร์ฟเวอร์แรก
            </button>
            <button type="button" className="btn-action-play" onClick={onClose}>
              <Sparkles size={15} /> เข้าใจแล้ว, เริ่มใช้งานเลย
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
