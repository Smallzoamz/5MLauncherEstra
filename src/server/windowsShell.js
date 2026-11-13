import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
// Execute through the existing Explorer desktop. A direct child of Node/Electron
// does not have the same launch context as a user opening FiveM from Windows.
export async function launchThroughExplorer(installation, args, execute = run) {
  const script = await fs.readFile(new URL('./windowsShell.ps1', import.meta.url), 'utf8');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const payload = Buffer.from(JSON.stringify({ exe: installation.exe, cwd: installation.root, args })).toString('base64');
  try {
    await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 15000, maxBuffer: 32768,
      env: { ...process.env, ESTRA_LAUNCH_PAYLOAD: payload }
    });
  } catch (cause) {
    throw Object.assign(new Error('Windows Explorer เปิด FiveM ไม่สำเร็จ กรุณาตรวจพาธ FiveM และลองเปิดใหม่', { cause }), { status: 503 });
  }
}
