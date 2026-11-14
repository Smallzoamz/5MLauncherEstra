import { AttachmentBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { buildTicketWelcomeMessage, TICKET_CATEGORIES } from './panelBuilders.js';

export function isStaffMember(member, guildConfig = {}) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  if (guildConfig.staffRoleId && member.roles?.cache?.has(guildConfig.staffRoleId)) return true;
  return false;
}

export function canCloseTicket(member, ticket, guildConfig = {}) {
  if (!member || !ticket) return false;
  if (String(member.id) === String(ticket.creatorId)) return true;
  return isStaffMember(member, guildConfig);
}

export function sanitizeChannelSlug(username) {
  const clean = String(username || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 18);
  return clean || 'user';
}

export function formatTranscriptText(ticket, messages = []) {
  const header = [
    '============================================================',
    `ESTRA FIVEM LAUNCHER - TICKET TRANSCRIPT #${String(ticket.ticketNumber).padStart(4, '0')}`,
    `Category : ${TICKET_CATEGORIES[ticket.categoryKey]?.label || ticket.categoryKey}`,
    `Creator  : ${ticket.creatorId}`,
    `Claimed  : ${ticket.claimedBy || 'Unclaimed'}`,
    `Subject  : ${ticket.subject}`,
    `Opened   : ${ticket.createdAt}`,
    `Closed   : ${new Date().toISOString()}`,
    '============================================================',
    '',
  ];

  const lines = [...messages]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(m => {
      const time = new Date(m.createdTimestamp).toISOString();
      const author = `${m.author?.tag || m.author?.username || 'Unknown'} (${m.author?.id || '?'})`;
      const content = m.content ? m.content.replace(/\r?\n/g, '\n  ') : '';
      const attachments = m.attachments?.size
        ? ` [Attachments: ${[...m.attachments.values()].map(a => a.url).join(', ')}]`
        : '';
      const embedsNote = !content && m.embeds?.length ? ' [Embed Message]' : '';
      return `[${time}] ${author}: ${content}${embedsNote}${attachments}`;
    });

  return [...header, ...lines].join('\n');
}

export async function postBotLog(guild, guildConfig, { title, description, color = ESTRA_THEME.SKY, fields = [], files = [] }) {
  if (!guildConfig?.logChannelId) return;
  const logChannel = await guild.channels.fetch(guildConfig.logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  if (fields.length > 0) embed.addFields(fields);

  await logChannel.send({
    embeds: [embed],
    files,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

export async function createTicketFromModal(interaction, categoryKey, store, config) {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member) {
    return { ok: false, message: 'คำสั่งนี้ใช้ได้เฉพาะภายในเซิร์ฟเวอร์เท่านั้น' };
  }

  const cat = TICKET_CATEGORIES[categoryKey] || TICKET_CATEGORIES.bug;
  const guildConfig = store.getGuildConfig(guild.id);
  const openCount = store.countOpenTicketsByCreator(guild.id, member.id);
  if (openCount >= config.maxOpenTicketsPerUser) {
    return {
      ok: false,
      message: `คุณมี Ticket ที่ยังเปิดอยู่แล้ว ${openCount} ห้อง (สูงสุด ${config.maxOpenTicketsPerUser} ห้องต่อคน) กรุณาปิดเคสเดิมก่อนเปิดใหม่`,
    };
  }

  const categoryChannel = guildConfig.ticketCategoryId
    ? await guild.channels.fetch(guildConfig.ticketCategoryId).catch(() => null)
    : null;
  if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
    return {
      ok: false,
      message: 'ยังไม่ได้ตั้งค่าหมวดหมู่ Ticket ในเซิร์ฟเวอร์ กรุณาแจ้งทีมงานรัน `/setup server`',
    };
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissionsIn(categoryChannel).has(PermissionFlagsBits.ManageChannels)) {
    return {
      ok: false,
      message: 'บอทไม่มีสิทธิ์ `Manage Channels` ในหมวดหมู่ Ticket จึงสร้างห้องไม่ได้',
    };
  }

  const subject = interaction.fields.getTextInputValue('ticket_subject').trim().slice(0, 120);
  const details = interaction.fields.getTextInputValue('ticket_details').trim().slice(0, 1200);
  const ticketNumber = store.reserveNextTicketNumber(guild.id);
  const numStr = String(ticketNumber).padStart(4, '0');
  const channelName = `${cat.shortPrefix}-${numStr}-${sanitizeChannelSlug(interaction.user.username)}`;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  if (guildConfig.staffRoleId && guild.roles.cache.has(guildConfig.staffRoleId)) {
    overwrites.push({
      id: guildConfig.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryChannel.id,
    topic: `Ticket #${numStr} | ${cat.label} | Creator: ${interaction.user.tag}`,
    permissionOverwrites: overwrites,
    reason: `Estra Ticket #${numStr} opened by ${interaction.user.tag}`,
  });

  try {
    const ticket = store.createTicket({
      guildId: guild.id,
      ticketNumber,
      channelId: channel.id,
      creatorId: member.id,
      categoryKey: cat.key,
      subject,
      details,
    });

    const welcomePayload = buildTicketWelcomeMessage(ticket);
    await channel.send(welcomePayload);

    await postBotLog(guild, guildConfig, {
      title: `🎫 เปิด Ticket #${numStr}`,
      description: `ผู้เปิด: <@${member.id}> · ห้อง <#${channel.id}>`,
      color: cat.color,
      fields: [
        { name: 'หมวดหมู่', value: cat.label, inline: true },
        { name: 'หัวข้อ', value: subject, inline: true },
      ],
    });

    return { ok: true, channel, ticket };
  } catch (err) {
    await channel.delete('Rollback failed ticket creation').catch(() => {});
    throw err;
  }
}

export async function claimTicketAction(interaction, store) {
  const guildConfig = store.getGuildConfig(interaction.guildId);
  if (!isStaffMember(interaction.member, guildConfig)) {
    return { ok: false, message: 'ปุ่มนี้สำหรับทีมงาน (`Estra Team` หรือผู้มีสิทธิ์จัดการห้อง) เท่านั้น' };
  }

  const ticket = store.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.guildId !== interaction.guildId || ticket.status !== 'open') {
    return { ok: false, message: 'ไม่พบข้อมูล Ticket ที่เปิดอยู่ในห้องนี้' };
  }

  if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
    return { ok: false, message: `เคสนี้ถูกรับเรื่องโดย <@${ticket.claimedBy}> ไปแล้ว` };
  }

  const res = store.claimTicket(interaction.channelId, interaction.user.id);
  if (!res.updated) {
    return { ok: false, message: 'ไม่สามารถรับเรื่องซ้ำได้' };
  }

  const updatedPayload = buildTicketWelcomeMessage(res.ticket);
  await interaction.message.edit({
    embeds: updatedPayload.embeds,
    components: updatedPayload.components,
  }).catch(() => {});

  return { ok: true, ticket: res.ticket };
}

export async function closeTicketAction(interaction, store) {
  const guildConfig = store.getGuildConfig(interaction.guildId);
  const ticket = store.getTicketByChannel(interaction.channelId);

  if (!ticket || ticket.guildId !== interaction.guildId || ticket.status !== 'open') {
    return { ok: false, message: 'ห้องนี้ไม่ใช่ Ticket ที่เปิดอยู่ หรือถูกปิดไปแล้ว' };
  }

  if (!canCloseTicket(interaction.member, ticket, guildConfig)) {
    return { ok: false, message: 'เฉพาะเจ้าของ Ticket หรือทีมงานเท่านั้นที่ปิดเคสนี้ได้' };
  }

  const botMember = await interaction.guild.members.fetchMe();
  if (!botMember.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, message: 'บอทไม่มีสิทธิ์ `Manage Channels` ในการปิดและลบห้อง Ticket นี้' };
  }

  const res = store.closeTicket(interaction.channelId, interaction.user.id);
  if (!res.closed) {
    return { ok: false, message: 'Ticket นี้กำลังถูกปิดหรือปิดไปแล้ว' };
  }

  const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => new Map());
  const transcriptText = formatTranscriptText(res.ticket, [...fetchedMessages.values()]);
  const numStr = String(ticket.ticketNumber).padStart(4, '0');
  const transcriptFile = new AttachmentBuilder(Buffer.from(transcriptText, 'utf8'), {
    name: `ticket-${numStr}-transcript.txt`,
  });

  await postBotLog(interaction.guild, guildConfig, {
    title: `🔒 ปิด Ticket #${numStr}`,
    description: `ปิดโดย <@${interaction.user.id}>`,
    color: ESTRA_THEME.WARN,
    fields: [
      { name: 'ผู้เปิดเคส', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'ผู้รับเรื่อง', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
      { name: 'หัวข้อ', value: ticket.subject, inline: false },
    ],
    files: [transcriptFile],
  });

  return { ok: true, ticket: res.ticket };
}
