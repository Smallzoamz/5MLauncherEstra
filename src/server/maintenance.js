import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInstallation } from './fivemBackend.js';
import { getProcessNames, isFiveMProcess } from './systemPresence.js';
import { assertNoLinks, assertWithin } from './fileSafety.js';
const labels = { logs: 'Log', crashes: 'Crash reports', shaders: 'Shader / GPU cache' };
export function validateCategories(categories) {
  if (!Array.isArray(categories) || !categories.length || categories.length > 3 || categories.some(key => !Object.hasOwn(labels, key)) || new Set(categories).size !== categories.length) throw new Error('กรุณาเลือกประเภท Log, Crash หรือ Shader ที่ต้องการล้าง');
  return categories;
}
async function measure(target) {
  let files = 0, bytes = 0, entries = 0;
  async function visit(file) {
    if (++entries > 50000) throw new Error('มีไฟล์มากเกินขอบเขตตรวจสอบ กรุณาจัดการโฟลเดอร์นี้ด้วยตนเอง');
    const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return false;
    if (stat.isSymbolicLink()) throw new Error('พบ symbolic link/junction จึงไม่ล้างไฟล์');
    if (stat.isDirectory()) for (const name of await fs.readdir(file)) await visit(path.join(file, name));
    else if (stat.isFile()) { files++; bytes += stat.size; }
    else throw new Error('ชนิดไฟล์ไม่รองรับการล้าง');
    return true;
  }
  const exists = await visit(target); return { exists, files, bytes };
}
async function plan(options, categories, dependencies) {
  const installation = await (dependencies.resolveInstallation || resolveInstallation)(options.fivemPath);
  await assertNoLinks(installation.app);
  const groups = { logs: ['logs'], crashes: ['crashes'], shaders: ['data/cache/shaders', 'data/cache/shader-cache'] };
  const nui = path.join(installation.app, 'data/nui-storage');
  if (categories.includes('shaders')) {
    await assertNoLinks(nui);
    const contexts = (await fs.readdir(nui, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(entry => /^context-server_\d+$/.test(entry.name));
    for (const entry of contexts) { if (entry.isSymbolicLink()) throw new Error('พบ junction ใน Shader cache'); }
    for (const context of ['', ...contexts.filter(entry => entry.isDirectory()).map(entry => entry.name)]) {
      for (const name of ['GPUCache', 'ShaderCache', 'GrShaderCache', 'DawnGraphiteCache', 'GraphiteDawnCache']) groups.shaders.push(path.join('data/nui-storage', context, name));
    }
  }
  const result = [];
  for (const category of categories) {
    const targets = [];
    for (const relative of groups[category]) {
      const absolute = path.resolve(installation.app, relative);
      assertWithin(installation.app, absolute); await assertNoLinks(absolute);
      const info = await measure(absolute);
      if (info.exists) targets.push({ relative, absolute, ...info });
    }
    result.push({ category, label: labels[category], targets, files: targets.reduce((n, t) => n + t.files, 0), bytes: targets.reduce((n, t) => n + t.bytes, 0) });
  }
  return result;
}
export async function previewMaintenance(options = {}, dependencies = {}) {
  const groups = await plan(options, Object.keys(labels), dependencies);
  return { groups: groups.map(({ targets, ...group }) => ({ ...group, paths: targets.map(t => t.relative) })) };
}
export async function cleanMaintenance(options = {}, dependencies = {}) {
  const categories = validateCategories(options.categories);
  const checkStopped = async () => {
    const names = await (dependencies.getProcessNames || getProcessNames)();
    if (names.some(isFiveMProcess)) throw new Error('กรุณาปิด FiveM ทุกหน้าต่างก่อนล้าง Log, Crash หรือ Shader');
  };
  await checkStopped();
  // Recompute and validate every selected target. Preview paths are never trusted.
  const groups = await plan(options, categories, dependencies);
  await checkStopped();
  const steps = [], errors = []; let deletedFiles = 0, deletedBytes = 0;
  for (const group of groups) {
    if (!group.targets.length) steps.push(`${group.label}: ไม่มีไฟล์ให้ล้าง`);
    for (const target of group.targets) {
      try {
        await assertNoLinks(target.absolute);
        await fs.rm(target.absolute, { recursive: true, force: false });
        deletedFiles += target.files; deletedBytes += target.bytes; steps.push(`${target.relative}: ล้างแล้ว (${target.files} ไฟล์)`);
      } catch (error) { errors.push(`${target.relative}: ${error.code || error.message}`); }
    }
  }
  return { success: !errors.length, deletedFiles, deletedBytes, steps, error: errors.length ? errors.join('; ') : undefined };
}
