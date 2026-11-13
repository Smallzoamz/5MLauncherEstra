import fs from 'node:fs/promises';

const parts = ['Third-party notices for the bundled Estra FiveM Launcher UI.\nElectron and Chromium notices are distributed alongside this file.'];
for (const name of ['react', 'react-dom', 'scheduler', 'lucide-react', 'classic-level', 'abstract-level', 'node-gyp-build', 'module-error', 'level-supports', 'level-transcoder', 'maybe-combine-errors', 'napi-macros', 'buffer', 'base64-js', 'ieee754', 'is-buffer']) {
  const directory = `node_modules/${name}`;
  const license = (await fs.readdir(directory)).find(file => /^licen[sc]e(?:[.-].*)?$/i.test(file));
  if (!license) throw new Error(`Missing license for ${name}`);
  parts.push(`\n===== ${name} =====\n${await fs.readFile(`${directory}/${license}`, 'utf8')}`);
}
await fs.mkdir('build', { recursive: true });
await fs.writeFile('build/THIRD-PARTY-NOTICES.txt', parts.join('\n'));

