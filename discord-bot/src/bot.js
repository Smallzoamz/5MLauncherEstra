import { Client, Events, GatewayIntentBits } from 'discord.js';
import { registerGuildMemberHandlers } from './handlers/guildMemberEvents.js';
import { createInteractionHandler } from './handlers/interactionCreate.js';
import { startTelemetryWatcher } from './services/releaseWatcher.js';
import { runFullGuildSetup } from './services/setupService.js';

export function createDiscordBot({ config, store }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const onInteraction = createInteractionHandler({ config, store });
  client.on(Events.InteractionCreate, onInteraction);
  registerGuildMemberHandlers(client, { store, config });

  let watcher = null;
  let stopped = false;

  client.once(Events.ClientReady, async readyClient => {
    console.log(`[estra-bot] Logged in as ${readyClient.user.tag} across ${readyClient.guilds.cache.size} guild(s).`);

    for (const guild of readyClient.guilds.cache.values()) {
      if (config.guildId && guild.id !== config.guildId) continue;
      const saved = store.getGuildConfig(guild.id);
      const isHydrated = Boolean(
        saved?.memberRoleId
        && saved?.ticketHubChannelId
        && saved?.friendCodesChannelId
        && saved?.logChannelId,
      );
      if (!isHydrated) {
        try {
          await runFullGuildSetup(guild, store, config);
          console.log(`[estra-bot] Auto-hydrated guild config & panels for ${guild.name} (${guild.id}).`);
        } catch (err) {
          console.error(`[estra-bot] Guild hydration warning (${guild.id}):`, err?.message || err);
        }
      }
    }

    if (!stopped) {
      watcher = startTelemetryWatcher(readyClient, store, config);
    }
  });

  client.on(Events.Error, err => {
    console.error('[estra-bot] client error:', err?.message || err);
  });

  return {
    client,
    async start() {
      await client.login(config.token);
      return client;
    },
    async stop() {
      stopped = true;
      watcher?.stop();
      client.destroy();
      store.close();
    },
  };
}
