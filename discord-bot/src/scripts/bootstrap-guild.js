import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from '../config.js';
import { syncGuildTelemetryAndReleases } from '../services/releaseWatcher.js';
import { runFullGuildSetup } from '../services/setupService.js';
import { BotStore } from '../store/sqliteStore.js';
import { deployCommands } from './deploy-commands.js';

async function main() {
  const config = loadConfig();
  if (!config.guildId) {
    throw new Error('DISCORD_GUILD_ID is required in .env to run guild setup.');
  }

  const store = new BotStore(config.sqlitePath);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  try {
    await new Promise((resolve, reject) => {
      client.once(Events.ClientReady, resolve);
      client.once(Events.Error, reject);
      client.login(config.token).catch(reject);
    });

    const guild = await client.guilds.fetch(config.guildId);
    const setupRes = await runFullGuildSetup(guild, store, config);
    const syncRes = await syncGuildTelemetryAndReleases(
      guild,
      store,
      config,
      setupRes.telemetry,
      { announceNewRelease: false },
    );
    const cmdRes = await deployCommands(config, { global: false });

    console.log(JSON.stringify({
      guild: { id: guild.id, name: guild.name },
      roles: setupRes.roles,
      channels: setupRes.channels,
      panels: setupRes.panels,
      telemetry: {
        source: setupRes.telemetry.source,
        latestTag: setupRes.telemetry.latest.tag,
        users: setupRes.telemetry.users,
        downloads: setupRes.telemetry.downloads,
        onlineSync: syncRes.onlineSync,
        downloadsSync: syncRes.downloadsSync,
      },
      commands: cmdRes,
      warnings: setupRes.warnings,
    }, null, 2));
  } finally {
    client.destroy();
    store.close();
  }
}

main().catch(err => {
  console.error('[bootstrap-guild] Failed:', err?.message || err);
  process.exit(1);
});
