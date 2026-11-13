import React from 'react';
import { Gamepad2, Plus, Headphones, Settings2, History, PackageCheck } from 'lucide-react';
import ServerAvatar from './ServerAvatar';
export default function ServerSidebar({ servers, activeServerId, onSelectServer, onOpenNewServerModal, onOpenLibrary, onOpenSettings, onOpenMicTest, onOpenHistory, onOpenPatcher, hasLauncherUpdate }) {
  return <aside className="nav-rail" aria-label="เมนู Launcher">
    <button className="rail-brand estra-brand" onClick={onOpenLibrary} aria-label="เมืองของฉัน" title="Estra FiveM Launcher"><img src="/brand/estra-mark.svg" alt="Estra" /></button>
    <div className="rail-main">
      <button className="rail-button rail-overview" onClick={onOpenLibrary} aria-label="ดูรายการเมืองทั้งหมด" title="เมืองของฉัน"><Gamepad2 size={23} /></button>
      <div className="rail-divider" />
      <div className="rail-servers">{servers.map(server => <button key={server.id} className={`rail-button server-shortcut ${server.id === activeServerId ? 'selected' : ''}`} aria-label={`เลือกเมือง ${server.name}`} aria-pressed={server.id === activeServerId} title={server.name} onClick={() => onSelectServer(server.id)}><ServerAvatar server={server} /></button>)}</div>
      <button className="rail-button add-server" onClick={onOpenNewServerModal} aria-label="+ NEW" title="เพิ่มเมือง"><Plus size={20} /></button>
    </div>
    <div className="rail-bottom"><button className={`rail-button${hasLauncherUpdate ? ' has-update-badge' : ''}`} onClick={onOpenPatcher} aria-label="ศูนย์แพตช์และอัปเดต" title="Patcher & อัปเดต"><PackageCheck size={20} /></button><button className="rail-button" onClick={onOpenHistory} aria-label="ประวัติการเปิดเกม" title="ประวัติการเปิดเกม"><History size={20} /></button><button className="rail-button" onClick={onOpenMicTest} aria-label="เปิดห้องทดสอบเสียง" title="ทดสอบเสียง"><Headphones size={20} /></button><button className="rail-button" onClick={onOpenSettings} aria-label="การตั้งค่า" title="การตั้งค่า"><Settings2 size={20} /></button><span className="rail-version">2.0</span></div>
  </aside>;
}




