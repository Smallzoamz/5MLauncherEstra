import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { ROLE_SPECS, SETUP_NAMES } from '../config.js';
import {
  buildDownloadPanel,
  buildFaqPanel,
  buildFindCityPanel,
  buildFindFriendsPanel,
  buildFivemPartnersPanel,
  buildFriendCodesPanel,
  buildReleaseAnnouncement,
  buildServerPartnersPanel,
  buildSponsorsPanel,
  buildTicketHubPanel,
  buildWelcomePanel,
} from './panelBuilders.js';
import { fetchEstraTelemetry } from './telemetryService.js';

function resolvePermissionFlags(names = []) {
  return names.map(name => PermissionFlagsBits[name]).filter(Boolean);
}

export async function reconcileRoles(guild, store) {
  const existingConfig = store.getGuildConfig(guild.id);
  const allRoles = await guild.roles.fetch();
  const botMember = await guild.members.fetchMe();
  const botHighest = botMember.roles.highest;

  const result = {};
  const warnings = [];

  for (const spec of ROLE_SPECS) {
    let role = existingConfig[spec.key] ? allRoles.get(existingConfig[spec.key]) : null;
    if (!role) {
      const candidateNames = [spec.name, ...(spec.previousNames || [])].map(n => n.toLowerCase());
      role = allRoles.find(r => !r.managed && candidateNames.includes(r.name.toLowerCase())) || null;
    }

    const perms = resolvePermissionFlags(spec.permissions);
    if (!role) {
      role = await guild.roles.create({
        name: spec.name,
        colors: { primaryColor: spec.color },
        hoist: spec.hoist,
        mentionable: spec.mentionable,
        permissions: perms,
        reason: 'Estra Launcher Discord Bot initial role setup',
      });
    } else if (botHighest.comparePositionTo(role) > 0) {
      await role.edit({
        name: spec.name,
        colors: { primaryColor: spec.color },
        hoist: spec.hoist,
        mentionable: spec.mentionable,
        permissions: perms,
        reason: 'Estra Launcher Discord Bot role reconciliation',
      });
    } else {
      warnings.push(`Role "${role.name}" อยู่สูงกว่าบอท จึงข้ามการปรับแต่ง`);
    }

    result[spec.key] = role.id;
  }

  // Ensure visual hierarchy in role list (Owner -> Estra Team -> Partners/Supporter -> Member, directly below Estra Bot)
  try {
    await guild.roles.fetch(undefined, { force: true });
    const refreshedBot = await guild.members.fetchMe({ force: true });
    const botPos = refreshedBot.roles.highest.position;
    const eligibleRoles = [...ROLE_SPECS]
      .reverse()
      .map(s => guild.roles.cache.get(result[s.key]))
      .filter(r => r && refreshedBot.roles.highest.comparePositionTo(r) > 0);
    const maxSlots = Math.max(0, botPos - 1);
    const orderedRoles = eligibleRoles.slice(-maxSlots);
    let nextPos = Math.max(1, botPos - orderedRoles.length);
    const positionUpdates = [];
    let needsSort = false;
    for (const r of orderedRoles) {
      if (r.position !== nextPos) needsSort = true;
      positionUpdates.push({ role: r.id, position: nextPos++ });
    }
    if (needsSort && positionUpdates.length > 0) {
      if ((refreshedBot.roles.highest.rawPosition ?? botPos) < botPos) {
        // Freshly created Discord roles share tied rawPosition=1; normalize guild role indices via a bottom-slot move first.
        await guild.roles.setPositions([{ role: positionUpdates[0].role, position: 1 }]);
      }
      await guild.roles.setPositions(positionUpdates);
    }
  } catch (err) {
    warnings.push(`จัดเรียงลำดับยศไม่สำเร็จ: ${err.message}`);
  }

  // Ensure owner-only role is assigned cleanly to guild owner
  for (const spec of ROLE_SPECS.filter(s => s.assignToOwner)) {
    const roleId = result[spec.key];
    if (!roleId || !guild.ownerId) continue;
    try {
      const ownerMember = await guild.members.fetch(guild.ownerId);
      if (ownerMember && !ownerMember.roles.cache.has(roleId)) {
        await ownerMember.roles.add(roleId, 'Assign hoisted Estra Owner role to server owner');
      }
    } catch (err) {
      warnings.push(`มอบยศ "${spec.name}" ให้เจ้าของเซิร์ฟเวอร์ไม่สำเร็จ: ${err.message}`);
    }
  }

  store.saveGuildConfig(guild.id, result);
  return { roles: result, warnings };
}

async function ensureCategory(guild, existingId, name, position, permissionOverwrites) {
  const all = guild.channels.cache;
  let cat = existingId ? all.get(existingId) : null;
  if (!cat || cat.type !== ChannelType.GuildCategory) {
    cat = all.find(c => c.type === ChannelType.GuildCategory && c.name === name) || null;
  }

  if (!cat) {
    cat = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      position,
      permissionOverwrites,
      reason: 'Estra Launcher Discord Bot category setup',
    });
  } else {
    await cat.edit({
      name,
      position,
      permissionOverwrites,
      reason: 'Estra Launcher Discord Bot category sync',
    });
  }
  return cat;
}

async function ensureChannel(guild, existingId, {
  name,
  type,
  parentId,
  position,
  topic,
  rateLimitPerUser,
  permissionOverwrites,
  adoptNames = [],
  adoptPrefixes = [],
  preserveAdoptedName = false,
}) {
  const all = guild.channels.cache;
  let ch = existingId ? all.get(existingId) : null;
  if (!ch || ch.type !== type) {
    ch = all.find(c => c.type === type && c.name === name) || null;
  }
  if (!ch && adoptNames.length > 0) {
    const lowerSet = new Set(adoptNames.map(n => n.toLowerCase()));
    ch = all.find(c => c.type === type && lowerSet.has(c.name.toLowerCase())) || null;
  }
  if (!ch && adoptPrefixes.length > 0) {
    ch = all.find(
      c => c.type === type
        && (!parentId || c.parentId === parentId)
        && adoptPrefixes.some(prefix => c.name.startsWith(prefix)),
    ) || all.find(
      c => c.type === type && adoptPrefixes.some(prefix => c.name.startsWith(prefix)),
    ) || null;
  }

  const options = {
    name: ch && preserveAdoptedName ? ch.name : name,
    parent: parentId,
    position,
    permissionOverwrites,
    reason: 'Estra Launcher Discord Bot channel sync',
  };
  if (type === ChannelType.GuildText) {
    if (topic !== undefined) options.topic = topic;
    if (rateLimitPerUser !== undefined) options.rateLimitPerUser = rateLimitPerUser;
  }

  if (!ch) {
    ch = await guild.channels.create({
      ...options,
      type,
    });
  } else {
    await ch.edit(options);
  }
  return ch;
}

export async function reconcileChannels(guild, roles, store) {
  const cfg = store.getGuildConfig(guild.id);
  await guild.channels.fetch();
  const everyoneId = guild.roles.everyone.id;
  const botId = guild.client.user.id;

  const telemetryOverwrites = [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.Connect],
    },
    {
      id: botId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels],
    },
  ];

  const startHereOverwrites = [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  const communityOverwrites = [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect],
    },
    {
      id: roles.memberRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseVAD,
      ],
    },
    {
      id: roles.staffRoleId,
      allow: [
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.MoveMembers,
      ],
    },
    ...(roles.ownerRoleId
      ? [{
          id: roles.ownerRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageThreads,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.MoveMembers,
          ],
        }]
      : []),
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  const makePartnerOverwrites = allowedRoleId => [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    },
    ...(allowedRoleId
      ? [{
          id: allowedRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        }]
      : []),
    {
      id: roles.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    ...(roles.ownerRoleId
      ? [{
          id: roles.ownerRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageThreads,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        }]
      : []),
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  const supportOverwrites = [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];

  const privateStaffOverwrites = [
    {
      id: everyoneId,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    ...(roles.ownerRoleId
      ? [{
          id: roles.ownerRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ManageMessages,
          ],
        }]
      : []),
    {
      id: roles.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // Categories
  const catTelemetry = await ensureCategory(guild, cfg.telemetryCategoryId, SETUP_NAMES.categories.telemetry, 0, telemetryOverwrites);
  const catStartHere = await ensureCategory(guild, cfg.startHereCategoryId, SETUP_NAMES.categories.startHere, 1, startHereOverwrites);
  const catPartners = await ensureCategory(guild, cfg.partnersCategoryId, SETUP_NAMES.categories.partners, 2, startHereOverwrites);
  const catCommunity = await ensureCategory(guild, cfg.communityCategoryId, SETUP_NAMES.categories.community, 3, communityOverwrites);
  const catSupport = await ensureCategory(guild, cfg.supportCategoryId, SETUP_NAMES.categories.support, 4, supportOverwrites);
  const catTickets = await ensureCategory(guild, cfg.ticketCategoryId, SETUP_NAMES.categories.tickets, 5, privateStaffOverwrites);
  const catStaff = await ensureCategory(guild, cfg.staffCategoryId, SETUP_NAMES.categories.staff, 6, privateStaffOverwrites);

  // Telemetry Counters (Voice channels)
  const existingOnlineCh = cfg.statsOnlineChannelId
    ? guild.channels.cache.get(cfg.statsOnlineChannelId)
    : null;
  const chStatsOnline = await ensureChannel(guild, cfg.statsOnlineChannelId, {
    name: existingOnlineCh?.name || SETUP_NAMES.channels.statsOnline,
    type: ChannelType.GuildVoice,
    parentId: catTelemetry.id,
    position: 0,
    permissionOverwrites: telemetryOverwrites,
    adoptPrefixes: ['🟢 ออนไลน์:'],
    preserveAdoptedName: true,
  });

  const existingDownloadsCh = cfg.statsDownloadsChannelId
    ? guild.channels.cache.get(cfg.statsDownloadsChannelId)
    : null;
  const chStatsDownloads = await ensureChannel(guild, cfg.statsDownloadsChannelId, {
    name: existingDownloadsCh?.name || SETUP_NAMES.channels.statsDownloads,
    type: ChannelType.GuildVoice,
    parentId: catTelemetry.id,
    position: 1,
    permissionOverwrites: telemetryOverwrites,
    adoptPrefixes: ['⬇️ ดาวน์โหลด:'],
    preserveAdoptedName: true,
  });

  // Start Here (Repurpose default #general so discord.gg/WYjfK6FWgB stays intact!)
  const chWelcome = await ensureChannel(guild, cfg.welcomeChannelId, {
    name: SETUP_NAMES.channels.welcome,
    type: ChannelType.GuildText,
    parentId: catStartHere.id,
    position: 0,
    topic: 'ยินดีต้อนรับสู่ Estra FiveM Launcher — กดยืนยันตัวตนเพื่อปลดล็อกห้องแชทและรับแจ้งเตือนอัปเดต',
    permissionOverwrites: startHereOverwrites,
    adoptNames: ['general'],
  });

  const chDownload = await ensureChannel(guild, cfg.downloadChannelId, {
    name: SETUP_NAMES.channels.download,
    type: ChannelType.GuildText,
    parentId: catStartHere.id,
    position: 1,
    topic: 'ดาวน์โหลด Estra FiveM Launcher (.exe) รุ่นล่าสุด พร้อม SHA-256 และสถิติจริง',
    permissionOverwrites: startHereOverwrites,
  });

  const chUpdates = await ensureChannel(guild, cfg.updatesChannelId, {
    name: SETUP_NAMES.channels.updates,
    type: ChannelType.GuildText,
    parentId: catStartHere.id,
    position: 2,
    topic: 'บันทึกอัปเดต (Changelog) และประกาศ Release ใหม่อัตโนมัติจาก GitHub',
    permissionOverwrites: startHereOverwrites,
  });

  const chFaq = await ensureChannel(guild, cfg.faqChannelId, {
    name: SETUP_NAMES.channels.faq,
    type: ChannelType.GuildText,
    parentId: catStartHere.id,
    position: 3,
    topic: 'คู่มือ Smart Preflight, CL2, City Patcher, ระบบเพื่อน ESTRA-XXXX และคำสั่งบอท',
    permissionOverwrites: startHereOverwrites,
  });

  // Partners & Sponsors
  const chSponsors = await ensureChannel(guild, cfg.sponsorChannelId, {
    name: SETUP_NAMES.channels.sponsors,
    type: ChannelType.GuildText,
    parentId: catPartners.id,
    position: 0,
    topic: 'ผู้สนับสนุนอย่างเป็นทางการ (Sponsor) ของ Estra FiveM Launcher — สอบถามร่วมสนับสนุนผ่านระบบ Ticket',
    rateLimitPerUser: 10,
    permissionOverwrites: makePartnerOverwrites(roles.sponsorRoleId),
  });

  const chServerPartners = await ensureChannel(guild, cfg.serverPartnerChannelId, {
    name: SETUP_NAMES.channels.serverPartners,
    type: ChannelType.GuildText,
    parentId: catPartners.id,
    position: 1,
    topic: 'โซนเซิร์ฟเวอร์ FiveM พาร์ทเนอร์ (Server Partner) ที่ร่วมแนะนำกับ Estra Launcher',
    rateLimitPerUser: 10,
    permissionOverwrites: makePartnerOverwrites(roles.partnerRoleId),
  });

  const chFivemPartners = await ensureChannel(guild, cfg.fivemPartnerChannelId, {
    name: SETUP_NAMES.channels.fivemPartners,
    type: ChannelType.GuildText,
    parentId: catPartners.id,
    position: 2,
    topic: 'โซนพาร์ทเนอร์ FiveM — ร้านรับทำเสื้อผ้า พรอบ โมเดล สคริปต์ และงานกราฟิกที่เกี่ยวข้องกับ FiveM',
    rateLimitPerUser: 10,
    permissionOverwrites: makePartnerOverwrites(roles.fivemPartnerRoleId),
  });

  // Community
  const chGeneral = await ensureChannel(guild, cfg.generalChannelId, {
    name: SETUP_NAMES.channels.general,
    type: ChannelType.GuildText,
    parentId: catCommunity.id,
    position: 0,
    topic: 'พูดคุยสอบถามการใช้งาน FiveM และ Estra Launcher (ใช้ /register, /estra, /fivem-check, /verify-hash ได้)',
    rateLimitPerUser: 3,
    permissionOverwrites: communityOverwrites,
  });

  const chShowcase = await ensureChannel(guild, cfg.showcaseChannelId, {
    name: SETUP_NAMES.channels.showcase,
    type: ChannelType.GuildText,
    parentId: catCommunity.id,
    position: 1,
    topic: 'แชร์ภาพการใช้งาน รีวิวเซิร์ฟเวอร์ และเสนอไอเดียสำหรับ Estra Launcher',
    rateLimitPerUser: 5,
    permissionOverwrites: communityOverwrites,
  });

  const chFindCity = await ensureChannel(guild, cfg.findCityChannelId, {
    name: SETUP_NAMES.channels.findCity,
    type: ChannelType.GuildText,
    parentId: catCommunity.id,
    position: 2,
    topic: 'โพสต์หาเมือง FiveM เล่น หรือสอบถามแนะนำเซิร์ฟเวอร์แนวที่ชอบ',
    rateLimitPerUser: 10,
    permissionOverwrites: communityOverwrites,
  });

  const chFindFriends = await ensureChannel(guild, cfg.findFriendsChannelId, {
    name: SETUP_NAMES.channels.findFriends,
    type: ChannelType.GuildText,
    parentId: catCommunity.id,
    position: 3,
    topic: 'หาเพื่อน หาแก๊ง หาตี้ลงเมือง FiveM ด้วยกัน',
    rateLimitPerUser: 10,
    permissionOverwrites: communityOverwrites,
  });

  const chFriendCodes = await ensureChannel(guild, cfg.friendCodesChannelId, {
    name: SETUP_NAMES.channels.friendCodes,
    type: ChannelType.GuildText,
    parentId: catCommunity.id,
    position: 4,
    topic: 'วางรหัสเพิ่มเพื่อน ESTRA-XXXX ของ Estra Launcher (ใช้ /register id:<ชื่อ> เพื่อสมัครรับรหัสทันที)',
    rateLimitPerUser: 5,
    permissionOverwrites: communityOverwrites,
  });

  const chVoice = await ensureChannel(guild, cfg.voiceChannelId, {
    name: SETUP_NAMES.channels.voice,
    type: ChannelType.GuildVoice,
    parentId: catCommunity.id,
    position: 5,
    permissionOverwrites: communityOverwrites,
    adoptNames: ['General'],
  });

  // Support & Staff
  const chTicketHub = await ensureChannel(guild, cfg.ticketHubChannelId, {
    name: SETUP_NAMES.channels.ticketHub,
    type: ChannelType.GuildText,
    parentId: catSupport.id,
    position: 0,
    topic: 'กดปุ่มเพื่อเปิด Ticket แจ้งบั๊ก ปรึกษาการติดตั้ง หรือสอบถามเชื่อม City Patcher',
    permissionOverwrites: supportOverwrites,
  });

  const chBotLogs = await ensureChannel(guild, cfg.logChannelId, {
    name: SETUP_NAMES.channels.botLogs,
    type: ChannelType.GuildText,
    parentId: catStaff.id,
    position: 0,
    topic: 'บันทึกกิจกรรมสำคัญของเซิร์ฟเวอร์ Ticket Transcripts และสถานะซิงก์ Release',
    permissionOverwrites: privateStaffOverwrites,
  });

  // Clean up empty default categories ('Text Channels', 'Voice Channels') if now vacant
  await guild.channels.fetch();
  for (const legacyName of ['Text Channels', 'Voice Channels']) {
    const legacy = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === legacyName,
    );
    if (legacy) {
      const children = guild.channels.cache.filter(c => c.parentId === legacy.id);
      if (children.size === 0) {
        await legacy.delete('Clean up empty default Discord category after Estra setup').catch(() => {});
      }
    }
  }

  // Disable built-in system welcome messages in read-only #welcome-rules
  if (guild.systemChannelId === chWelcome.id) {
    await guild.edit({ systemChannel: null, reason: 'Use custom Estra bot welcome card instead' }).catch(() => {});
  }

  const channelIds = {
    telemetryCategoryId: catTelemetry.id,
    startHereCategoryId: catStartHere.id,
    partnersCategoryId: catPartners.id,
    communityCategoryId: catCommunity.id,
    supportCategoryId: catSupport.id,
    ticketCategoryId: catTickets.id,
    staffCategoryId: catStaff.id,
    statsOnlineChannelId: chStatsOnline.id,
    statsDownloadsChannelId: chStatsDownloads.id,
    welcomeChannelId: chWelcome.id,
    downloadChannelId: chDownload.id,
    updatesChannelId: chUpdates.id,
    faqChannelId: chFaq.id,
    sponsorChannelId: chSponsors.id,
    serverPartnerChannelId: chServerPartners.id,
    fivemPartnerChannelId: chFivemPartners.id,
    generalChannelId: chGeneral.id,
    showcaseChannelId: chShowcase.id,
    findCityChannelId: chFindCity.id,
    findFriendsChannelId: chFindFriends.id,
    friendCodesChannelId: chFriendCodes.id,
    voiceChannelId: chVoice.id,
    ticketHubChannelId: chTicketHub.id,
    logChannelId: chBotLogs.id,
  };

  store.saveGuildConfig(guild.id, channelIds);
  return channelIds;
}

export async function upsertPanelMessage(guild, store, panelKey, channelId, payload) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`ไม่พบช่องข้อความสำหรับพาเนล ${panelKey}`);
  }

  const saved = store.getPanelMessage(guild.id, panelKey);
  let existingMsg = null;
  if (saved && saved.channelId === channelId) {
    existingMsg = await channel.messages.fetch(saved.messageId).catch(() => null);
  }

  // Recover previously posted bot panel if local/volume SQLite started blank
  if (!existingMsg && typeof channel.messages?.fetch === 'function') {
    const targetTitle = payload?.embeds?.[0]?.data?.title || payload?.embeds?.[0]?.title || '';
    const targetAuthor = payload?.embeds?.[0]?.data?.author?.name || payload?.embeds?.[0]?.author?.name || '';
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (recent) {
      const releaseTag = panelKey.startsWith('release:') ? panelKey.slice('release:'.length) : '';
      existingMsg = recent.find(msg => {
        if (msg.author?.id !== guild.client.user.id) return false;
        const msgTitle = msg.embeds?.[0]?.title || msg.embeds?.[0]?.data?.title || '';
        const msgAuthor = msg.embeds?.[0]?.author?.name || msg.embeds?.[0]?.data?.author?.name || '';
        if (releaseTag) return msgTitle.includes(releaseTag) || (targetTitle && msgTitle === targetTitle);
        return (targetTitle && msgTitle === targetTitle) || (targetAuthor && msgAuthor === targetAuthor);
      }) || null;
    }
  }

  if (existingMsg && existingMsg.author?.id === guild.client.user.id) {
    const updated = await existingMsg.edit({
      ...payload,
      attachments: [],
    });
    store.savePanelMessage(guild.id, panelKey, channelId, updated.id);
    return { action: 'updated', messageId: updated.id, channelId };
  }

  const sent = await channel.send(payload);
  store.savePanelMessage(guild.id, panelKey, channelId, sent.id);
  return { action: 'created', messageId: sent.id, channelId };
}

export async function syncAllPanels(guild, store, config, telemetry = null) {
  const cfg = store.getGuildConfig(guild.id);
  const stats = telemetry || (await fetchEstraTelemetry(config));

  const results = {};
  if (cfg.welcomeChannelId) {
    results.welcome = await upsertPanelMessage(
      guild,
      store,
      'welcome',
      cfg.welcomeChannelId,
      buildWelcomePanel(config, cfg),
    );
  }
  if (cfg.downloadChannelId) {
    results.download = await upsertPanelMessage(
      guild,
      store,
      'download',
      cfg.downloadChannelId,
      buildDownloadPanel(config, stats),
    );
  }
  if (cfg.faqChannelId) {
    results.faq = await upsertPanelMessage(
      guild,
      store,
      'faq',
      cfg.faqChannelId,
      buildFaqPanel(config),
    );
  }
  if (cfg.ticketHubChannelId) {
    results.ticketHub = await upsertPanelMessage(
      guild,
      store,
      'ticketHub',
      cfg.ticketHubChannelId,
      buildTicketHubPanel(),
    );
  }
  if (cfg.sponsorChannelId) {
    results.sponsors = await upsertPanelMessage(
      guild,
      store,
      'sponsors',
      cfg.sponsorChannelId,
      buildSponsorsPanel(),
    );
  }
  if (cfg.serverPartnerChannelId) {
    results.serverPartners = await upsertPanelMessage(
      guild,
      store,
      'serverPartners',
      cfg.serverPartnerChannelId,
      buildServerPartnersPanel(),
    );
  }
  if (cfg.fivemPartnerChannelId) {
    results.fivemPartners = await upsertPanelMessage(
      guild,
      store,
      'fivemPartners',
      cfg.fivemPartnerChannelId,
      buildFivemPartnersPanel(),
    );
  }
  if (cfg.findCityChannelId) {
    results.findCity = await upsertPanelMessage(
      guild,
      store,
      'findCity',
      cfg.findCityChannelId,
      buildFindCityPanel(cfg),
    );
  }
  if (cfg.findFriendsChannelId) {
    results.findFriends = await upsertPanelMessage(
      guild,
      store,
      'findFriends',
      cfg.findFriendsChannelId,
      buildFindFriendsPanel(cfg),
    );
  }
  if (cfg.friendCodesChannelId) {
    results.friendCodes = await upsertPanelMessage(
      guild,
      store,
      'friendCodes',
      cfg.friendCodesChannelId,
      buildFriendCodesPanel(cfg),
    );
  }

  // Ensure initial changelog post exists in #updates-changelog without mass pinging on first setup
  const relState = store.getReleaseState(guild.id);
  if (cfg.updatesChannelId && !relState?.lastAnnouncedTag && stats.latest?.tag) {
    const res = await upsertPanelMessage(
      guild,
      store,
      `release:${stats.latest.tag}`,
      cfg.updatesChannelId,
      buildReleaseAnnouncement(config, stats, { rolePingId: null }),
    );
    results.initialRelease = res;
    store.saveReleaseState(guild.id, {
      lastAnnouncedTag: stats.latest.tag,
      lastDownloadPanelTag: stats.latest.tag,
    });
  } else if (stats.latest?.tag) {
    store.saveReleaseState(guild.id, { lastDownloadPanelTag: stats.latest.tag });
  }

  return { telemetry: stats, panels: results };
}

export async function runFullGuildSetup(guild, store, config) {
  const { roles, warnings } = await reconcileRoles(guild, store);
  const channels = await reconcileChannels(guild, roles, store);
  const { telemetry, panels } = await syncAllPanels(guild, store, config);

  return { roles, channels, telemetry, panels, warnings };
}
