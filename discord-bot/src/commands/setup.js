import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { syncGuildTelemetryAndReleases } from '../services/releaseWatcher.js';
import { runFullGuildSetup, syncAllPanels } from '../services/setupService.js';
import { fetchEstraTelemetry } from '../services/telemetryService.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('ตั้งค่าห้อง ยศ พาเนล และซิงก์ข้อมูลของ Estra Launcher (เฉพาะผู้ดูแลเซิร์ฟเวอร์)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('server').setDescription('สร้าง/จัดระเบียบยศ หมวดหมู่ ห้องทั้งหมด และวางพาเนลใหม่อัตโนมัติ (Idempotent)'),
  )
  .addSubcommand(sub =>
    sub.setName('panels').setDescription('อัปเดตข้อความพาเนล Welcome / Download / FAQ / Ticket ให้เป็นข้อมูลล่าสุด'),
  )
  .addSubcommand(sub =>
    sub.setName('release-sync').setDescription('บังคับดึงสถิติและ Release ล่าสุดมาอัปเดตหน้าห้องและช่องสถิติทันที'),
  );

export async function execute(interaction, { store, config }) {
  if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: '❌ คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลที่มีสิทธิ์ `Manage Server` ภายในเซิร์ฟเวอร์เท่านั้น',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand(true);

  if (sub === 'server') {
    const botMember = await interaction.guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels) || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply('❌ บอทต้องมีสิทธิ์ `Manage Channels` และ `Manage Roles` (หรือ `Administrator`) จึงจะตั้งค่าเซิร์ฟเวอร์ได้');
      return;
    }

    const res = await runFullGuildSetup(interaction.guild, store, config);
    const telemetryRes = await syncGuildTelemetryAndReleases(
      interaction.guild,
      store,
      config,
      res.telemetry,
      { announceNewRelease: false },
    );

    const warnLine = res.warnings.length > 0 ? `\n⚠️ **หมายเหตุ:** ${res.warnings.join('; ')}` : '';
    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.ONLINE)
      .setTitle('✅ ตั้งค่าเซิร์ฟเวอร์ Estra Launcher เรียบร้อยแล้ว')
      .setDescription([
        `• **ยศที่จัดเตรียม:** <@&${res.roles.ownerRoleId}> · <@&${res.roles.staffRoleId}> · <@&${res.roles.sponsorRoleId}> · <@&${res.roles.partnerRoleId}> · <@&${res.roles.fivemPartnerRoleId}> · <@&${res.roles.supporterRoleId}> · <@&${res.roles.releasePingRoleId}> · <@&${res.roles.memberRoleId}>`,
        `• **ห้องหลัก:** <#${res.channels.welcomeChannelId}> · <#${res.channels.downloadChannelId}> · <#${res.channels.updatesChannelId}> · <#${res.channels.faqChannelId}>`,
        `• **Partner & Sponsor:** <#${res.channels.sponsorChannelId}> · <#${res.channels.serverPartnerChannelId}> · <#${res.channels.fivemPartnerChannelId}>`,
        `• **คอมมูนิตี้ & ซัพพอร์ต:** <#${res.channels.generalChannelId}> · <#${res.channels.findCityChannelId}> · <#${res.channels.findFriendsChannelId}> · <#${res.channels.friendCodesChannelId}> · <#${res.channels.ticketHubChannelId}> · <#${res.channels.logChannelId}>`,
        `• **เวอร์ชันที่ซิงก์:** \`${res.telemetry.latest.tag}\` (สถิติช่องออนไลน์: \`${telemetryRes.onlineSync.status}\`)${warnLine}`,
      ].join('\n'))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'panels') {
    const res = await syncAllPanels(interaction.guild, store, config);
    const summary = Object.entries(res.panels)
      .map(([k, v]) => `• \`${k}\`: ${v.action} (<#${v.channelId}>)`)
      .join('\n') || 'ไม่พบห้องที่ตั้งค่าไว้ กรุณารัน `/setup server` ก่อน';
    await interaction.editReply(`✅ อัปเดตพาเนลเรียบร้อยแล้ว:\n${summary}`);
    return;
  }

  if (sub === 'release-sync') {
    const telemetry = await fetchEstraTelemetry(config);
    const syncRes = await syncGuildTelemetryAndReleases(interaction.guild, store, config, telemetry);
    await syncAllPanels(interaction.guild, store, config, telemetry);
    await interaction.editReply(
      `✅ ซิงก์ข้อมูลล่าสุดสำเร็จ: **${telemetry.latest.tag}** · ดาวน์โหลดสะสม **${telemetry.downloads.total}** · ออนไลน์ **${telemetry.users.online}** · Release Status: \`${syncRes.releaseAction}\``,
    );
  }
}
