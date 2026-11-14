import React, { useEffect, useRef } from 'react';
import { Ellipsis, Minus, Maximize2, Power } from 'lucide-react';
import { APP_VERSION } from '../shared/patcherConfig';

export default function WindowMenu() {
  const menu = useRef(null);
  useEffect(() => {
    const pointer = event => { if (menu.current && !menu.current.contains(event.target)) menu.current.open = false; };
    const keyboard = event => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false; menu.current.querySelector('summary').focus();
      }
    };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', keyboard); };
  }, []);
  if (!window.estraWindow) return null;
  const act = action => { menu.current.open = false; window.estraWindow[action](); };
  return <details className="window-menu" ref={menu}>
    <summary aria-label="เมนูหน้าต่าง Estra" title="เมนูหน้าต่าง Estra"><Ellipsis size={20} /></summary>
    <div className="window-menu-panel" aria-label="ควบคุมหน้าต่าง">
      <img src="/brand/estra-logo.png" alt="Estra FiveM Launcher" />
      <button onClick={() => act('minimize')}><Minus size={16} />ย่อหน้าต่าง</button>
      <button onClick={() => act('hideToTray')}><Minus size={16} />ซ่อนลง System Tray</button>
      <button onClick={() => act('toggleMaximize')}><Maximize2 size={16} />ขยาย / คืนขนาดหน้าต่าง</button>
      <button className="window-close" onClick={() => act('close')}><Power size={16} />ปิดโปรแกรม</button>
      <small>ESTRA FIVEM LAUNCHER · {APP_VERSION}</small>
    </div>
  </details>;
}
