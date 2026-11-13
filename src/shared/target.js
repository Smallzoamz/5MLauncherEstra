export function parseTarget(value) {
  if (typeof value !== 'string' || value.length > 253) throw new Error('กรุณาระบุ IP:port, โดเมน หรือ cfx.re/join/code');
  const input = value.trim();
  const join = input.match(/^(?:https:\/\/)?cfx\.re\/join\/([a-z0-9]{4,16})\/?$/i);
  if (join) return { kind: 'join', code: join[1].toLowerCase(), address: `cfx.re/join/${join[1].toLowerCase()}` };
  const match = input.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i);
  if (!match) throw new Error('รูปแบบที่อยู่ไม่ถูกต้อง ใช้ IP:port หรือ cfx.re/join/code');
  const host = match[1].toLowerCase();
  const port = Number(match[2] || 30120);
  if (port < 1 || port > 65535 || host.split('.').some(p => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))) throw new Error('โดเมนหรือพอร์ตไม่ถูกต้อง');
  if (/^[0-9.]+$/.test(host) && (host.split('.').length !== 4 || host.split('.').some(p => Number(p) > 255 || (p.length > 1 && p[0] === '0')))) throw new Error('IPv4 ไม่ถูกต้อง');
  return { kind: 'direct', host, port, address: `${host}:${port}` };
}

