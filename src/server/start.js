import { spawn } from 'node:child_process';
import { startLocalServer } from './localServer.js';
try {
  const server = await startLocalServer({ port: Number(process.env.PORT || 5199) });
  console.log(`Estra FiveM Launcher: ${server.url}`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('explorer.exe', [server.url], { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    browser.on('error', () => console.log(`เปิดเบราว์เซอร์ด้วยตนเองที่ ${server.url}`)); browser.unref();
  }
  const stop = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? 'พอร์ตถูกใช้อยู่ กรุณาปิด Launcher เดิมหรือเปลี่ยน PORT' : error.message);
  process.exitCode = 1;
}


