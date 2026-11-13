import React, { useState } from 'react';
export default function ServerAvatar({ server, className = '' }) {
  const [failed, setFailed] = useState(null);
  const src = server?.iconSource === 'server-icon-v1' ? server.logoUrl : null;
  return <span className={`server-avatar ${className}`} title={src ? 'ไอคอนจากเซิร์ฟเวอร์ FiveM' : 'เซิร์ฟเวอร์ยังไม่มีไอคอนที่อ่านได้'}>
    {src && failed !== src ? <img key={src} src={src} alt={`โลโก้ ${server.name}`} onError={() => setFailed(src)} /> : <span>{(server?.name || '?').slice(0, 2).toUpperCase()}</span>}
  </span>;
}

