import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { closeTicketAction, isStaffMember } from '../services/ticketService.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('จัดการห้อง Ticket ปัจจุบัน (เพิ่ม/ลบสมาชิก หรือปิดเคส)')
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription('เพิ่มสมาชิกเข้าร่วมห้อง Ticket นี้ (เฉพาะทีมงาน)')
      .addUserOption(opt => opt.setName('user').setDescription('สมาชิกที่ต้องการเพิ่ม').setRequired(true)),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription('นำสมาชิกออกจากห้อง Ticket นี้ (เฉพาะทีมงาน)')
      .addUserOption(opt => opt.setName('user').setDescription('สมาชิกที่ต้องการนำออก').setRequired(true)),
  )
  .addSubcommand(sub =>
    sub.setName('close').setDescription('ปิด Ticket นี้และบันทึก Transcript เข้า Log'),
  );

export async function execute(interaction, { store }) {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์เท่านั้น', flags: MessageFlags.Ephemeral });
    return;
  }

  const guildConfig = store.getGuildConfig(interaction.guildId);
  const ticket = store.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.guildId !== interaction.guildId || ticket.status !== 'open') {
    await interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะภายในห้อง Ticket ที่เปิดอยู่เท่านั้น', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand(true);

  if (sub === 'close') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await closeTicketAction(interaction, store);
    if (!res.ok) {
      await interaction.editReply(`❌ ${res.message}`);
      return;
    }
    await interaction.editReply('🔒 บันทึก Transcript แล้ว ห้องนี้จะถูกลบใน 3 วินาที...');
    await interaction.channel.send(`🔒 Ticket ถูกปิดโดย <@${interaction.user.id}> กำลังลบห้อง...`).catch(() => {});
    setTimeout(() => {
      interaction.channel.delete(`Ticket #${ticket.ticketNumber} closed by ${interaction.user.tag}`).catch(() => {});
    }, 3000);
    return;
  }

  if (!isStaffMember(interaction.member, guildConfig)) {
    await interaction.reply({ content: '❌ เฉพาะทีมงานเท่านั้นที่เพิ่มหรือนำสมาชิกออกจาก Ticket ได้', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const botMember = await interaction.guild.members.fetchMe();
  if (!botMember.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ บอทไม่มีสิทธิ์ `Manage Channels` ในห้องนี้', flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'add') {
    await interaction.channel.permissionOverwrites.edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
    await interaction.reply({
      content: `✅ เพิ่ม <@${targetUser.id}> เข้าสู่ Ticket นี้แล้ว`,
      allowedMentions: { users: [targetUser.id] },
    });
    return;
  }

  if (sub === 'remove') {
    if (targetUser.id === ticket.creatorId) {
      await interaction.reply({ content: '❌ ไม่สามารถนำเจ้าของ Ticket ออกจากห้องของตัวเองได้', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
    await interaction.reply({
      content: `✅ นำ <@${targetUser.id}> ออกจาก Ticket นี้แล้ว`,
      allowedMentions: { parse: [] },
    });
  }
}
