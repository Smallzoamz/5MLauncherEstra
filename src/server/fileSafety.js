import fs from 'node:fs/promises';
import path from 'node:path';
export function assertWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('พาธอยู่นอกขอบเขตที่อนุญาต');
}
export async function assertNoLinks(absolute) {
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error('ไม่ดำเนินการผ่าน symbolic link หรือ junction');
  }
}
export async function assertTreeNoLinks(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('พบ symbolic link/junction กรุณาจัดการด้วยตนเอง');
    if (entry.isDirectory()) await assertTreeNoLinks(path.join(directory, entry.name));
  }
}
