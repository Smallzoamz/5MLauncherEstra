import { ActivityType, PermissionFlagsBits } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { buildDownloadPanel, buildReleaseAnnouncement } from './panelBuilders.js';
import { upsertPanelMessage } from './setupService.js';
import { fetchEstraTelemetry } from './telemetryService.js';
import { postBotLog } from './ticketService.js';

export function formatTelemetryLabels(telemetry) {
  const online = Number(telemetry?.users?.online ?? 0).toLocaleString('en-US');
  const inGame = Number(telemetry?.users?.inGame ?? 0).toLocaleString('en-US');
  const downloads = Number(telemetry?.downloads?.total ?? 0).toLocaleString('en-US');

  return {
    onlineLabel: `🟢 ออนไลน์: ${online} | ในเมือง: ${inGame}`,
    downloadsLabel: `⬇️ ดาวน์โหลด: ${downloads} ครั้ง`,
  };
}

export async function updateTelemetryChannelIfDue(
  guild,
  store,
  channelId,
  counterKey,
  nextLabel,
  cooldownMs,
  now = Date.now(),
) {
  if (!channelId) return { status: 'missing-id' };
  const guard = store.getTelemetryRenameGuard(guild.id, counterKey);
  if (guard && guard.lastLabel === nextLabel) {
    return { status: 'unchanged' };
  }
  if (guard && now - guard.lastRenamedAt < cooldownMs) {
    return { status: 'cooldown', waitMs: cooldownMs - (now - guard.lastRenamedAt) };
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { status: 'missing-channel' };
  if (channel.name === nextLabel) {
    store.saveTelemetryRenameGuard(guild.id, counterKey, nextLabel, now);
    return { status: 'unchanged' };
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels)) {
    return { status: 'missing-permission' };
  }

  await channel.setName(nextLabel, 'Estra live telemetry update');
  store.saveTelemetryRenameGuard(guild.id, counterKey, nextLabel, now);
  return { status: 'renamed', label: nextLabel };
}

export async function syncGuildTelemetryAndReleases(
  guild,
  store,
  config,
  telemetry,
  { announceNewRelease = true } = {},
) {
  const cfg = store.getGuildConfig(guild.id);
  const labels = formatTelemetryLabels(telemetry);

  const onlineSync = await updateTelemetryChannelIfDue(
    guild,
    store,
    cfg.statsOnlineChannelId,
    'online',
    labels.onlineLabel,
    config.channelRenameCooldownMs,
  ).catch(err => ({ status: 'error', error: err.message }));

  const downloadsSync = await updateTelemetryChannelIfDue(
    guild,
    store,
    cfg.statsDownloadsChannelId,
    'downloads',
    labels.downloadsLabel,
    config.channelRenameCooldownMs,
  ).catch(err => ({ status: 'error', error: err.message }));

  const relState = store.getReleaseState(guild.id);
  const latestTag = telemetry?.latest?.tag || null;
  let releaseAction = 'unchanged';

  if (announceNewRelease && latestTag && relState?.lastAnnouncedTag && relState.lastAnnouncedTag !== latestTag) {
    if (cfg.updatesChannelId) {
      const updatesChannel = await guild.channels.fetch(cfg.updatesChannelId).catch(() => null);
      if (updatesChannel && updatesChannel.isTextBased()) {
        const rolePingId = cfg.releasePingRoleId || null;
        const payload = buildReleaseAnnouncement(config, telemetry, { rolePingId });
        const sent = await updatesChannel.send(payload);
        store.savePanelMessage(guild.id, `release:${latestTag}`, updatesChannel.id, sent.id);
      }
    }

    if (cfg.downloadChannelId) {
      await upsertPanelMessage(
        guild,
        store,
        'download',
        cfg.downloadChannelId,
        buildDownloadPanel(config, telemetry),
      ).catch(() => {});
    }

    store.saveReleaseState(guild.id, {
      lastAnnouncedTag: latestTag,
      lastDownloadPanelTag: latestTag,
    });

    await postBotLog(guild, cfg, {
      title: `🚀 ประกาศเวอร์ชันใหม่ ${latestTag}`,
      description: `อัปเดต Download Hub และส่งแจ้งเตือนใน <#${cfg.updatesChannelId || ''}> เรียบร้อยแล้ว`,
      color: ESTRA_THEME.ONLINE,
    });
    releaseAction = 'announced';
  }

  return { onlineSync, downloadsSync, releaseAction, latestTag };
}

export function startTelemetryWatcher(client, store, config) {
  let active = false;
  let timer = null;

  const tick = async () => {
    if (active || !client.isReady()) return;
    active = true;
    try {
      const telemetry = await fetchEstraTelemetry(config);
      const version = telemetry.latest?.version || '2.1.7';
      const dlCount = Number(telemetry.downloads?.total ?? 0).toLocaleString('en-US');
      const online = Number(telemetry.users?.online ?? 0);

      client.user.setPresence({
        status: 'online',
        activities: [
          {
            name: `Estra v${version} • ${dlCount} โหลด • ${online} ออนไลน์`,
            type: ActivityType.Playing,
          },
        ],
      });

      for (const guild of client.guilds.cache.values()) {
        await syncGuildTelemetryAndReleases(guild, store, config, telemetry).catch(err => {
          console.error(`[watcher] guild ${guild.id} sync error:`, err.message);
        });
      }
    } catch (err) {
      console.error('[watcher] telemetry tick failed:', err.message);
    } finally {
      active = false;
    }
  };

  // Run initial sync shortly after login, then repeat on interval
  const initialDelay = setTimeout(tick, 4000);
  timer = setInterval(tick, config.syncIntervalMs);

  return {
    tick,
    stop() {
      clearTimeout(initialDelay);
      clearInterval(timer);
    },
  };
}
