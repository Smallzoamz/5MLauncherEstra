import { REST, Routes } from 'discord.js';
import { getCommandJsonDefinitions } from '../commands/index.js';
import { loadConfig } from '../config.js';

export async function deployCommands(config, { global = false } = {}) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = getCommandJsonDefinitions();

  if (!global && config.guildId) {
    const res = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    return { scope: 'guild', guildId: config.guildId, count: Array.isArray(res) ? res.length : body.length };
  }

  const res = await rest.put(Routes.applicationCommands(config.clientId), { body });
  return { scope: 'global', count: Array.isArray(res) ? res.length : body.length };
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isDirectRun) {
  const globalFlag = process.argv.includes('--global');
  const config = loadConfig();
  deployCommands(config, { global: globalFlag })
    .then(res => {
      console.log(`[deploy-commands] Registered ${res.count} command(s) (scope=${res.scope}${res.guildId ? `, guild=${res.guildId}` : ''}).`);
    })
    .catch(err => {
      console.error('[deploy-commands] Failed:', err?.message || err);
      process.exit(1);
    });
}
