import { createDiscordBot } from './bot.js';
import { loadConfig } from './config.js';
import { BotStore } from './store/sqliteStore.js';

const config = loadConfig();
const store = new BotStore(config.sqlitePath);
const bot = createDiscordBot({ config, store });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[estra-bot] Received ${signal}, shutting down gracefully...`);
  await bot.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

bot.start().catch(err => {
  console.error('[estra-bot] Failed to start:', err?.message || err);
  store.close();
  process.exit(1);
});
