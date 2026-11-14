import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { registerAccountViaDiscord } from '../services/accountService.js';
import { postBotLog } from '../services/ticketService.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('สมัครบัญชี Estra Launcher ผ่าน Discord (ตอบกลับเห็นเฉพาะคุณ)')
  .addStringOption(opt =>
    opt
      .setName('id')
      .setDescription('Estra ID สำหรับ Login (a-z, 0-9, _, ., - ความยาว 3-24 ตัว)')
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(24),
  )
  .addStringOption(opt =>
    opt
      .setName('display_name')
      .setDescription('ชื่อที่จะแสดงในโปรแกรม (ถ้าไม่กรอกจะใช้ชื่อ Discord หรือ ID)')
      .setRequired(false)
      .setMaxLength(32),
  );

export async function execute(interaction, { store, config }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requestedId = interaction.options.getString('id', true);
  const customDisplay = interaction.options.getString('display_name');
  const displayName = (
    customDisplay
    || interaction.member?.displayName
    || interaction.user?.globalName
    || interaction.user?.username
    || requestedId
  ).trim().slice(0, 32);

  const res = await registerAccountViaDiscord(
    {
      username: requestedId,
      displayName,
      discordUserId: interaction.user.id,
    },
    config,
  );

  if (!res.ok) {
    const errEmbed = new EmbedBuilder()
      .setColor(ESTRA_THEME.ERROR)
      .setTitle('❌ สมัครบัญชี Estra Launcher ไม่สำเร็จ')
      .setDescription(res.message || 'ไม่สามารถสร้างบัญชีได้ กรุณาลองใหม่อีกครั้ง')
      .setFooter({ text: 'ตัวอย่าง ID ที่ใช้ได้: estra_player99 หรือ somchai.rp' });

    await interaction.editReply({
      embeds: [errEmbed],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const { account, initialPassword } = res;
  const guildConfig = interaction.guildId ? store?.getGuildConfig?.(interaction.guildId) || {} : {};
  const friendCodesMention = guildConfig.friendCodesChannelId
    ? `<#${guildConfig.friendCodesChannelId}>`
    : '`🆔・friend-codes`';
  const downloadMention = guildConfig.downloadChannelId
    ? `<#${guildConfig.downloadChannelId}>`
    : '`⚡・download-estra`';

  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.ONLINE)
    .setTitle('✅ สมัครสมาชิก Estra Launcher เรียบร้อยแล้ว!')
    .setDescription([
      '🔒 **ข้อความนี้มองเห็นได้เฉพาะคุณคนเดียวเท่านั้น** กรุณาเก็บรหัสผ่านด้านล่างไว้เป็นความลับ',
      '',
      `👤 **Estra ID (ใช้เข้าสู่ระบบ):** \`${account.username}\``,
      `🏷️ **Display Name:** **${account.displayName || account.username}**`,
      `🆔 **Friend Code:** \`${account.friendCode || 'กำลังซิงก์'}\``,
      '',
      '🔑 **รหัสผ่านสำหรับ Login ครั้งแรก:**',
      `\`\`\`txt\n${initialPassword}\n\`\`\``,
      '⚠️ **แจ้งเตือนสำคัญ: กรุณาเปลี่ยนรหัสผ่านทันทีหลัง Login ครั้งแรก!**',
      `> 1. เปิดโปรแกรม **Estra FiveM Launcher** (ดาวน์โหลดที่ ${downloadMention})`,
      '> 2. เข้าสู่ระบบด้วย **Estra ID** และ **รหัสผ่านชั่วคราว** ด้านบน',
      '> 3. หลัง Login ครั้งแรก ระบบจะแจ้งเตือนให้ตั้งรหัสผ่านใหม่ทันทีเพื่อความปลอดภัย',
      `> 4. นำ Friend Code \`${account.friendCode || ''}\` ไปวางหาเพื่อนได้ที่ ${friendCodesMention}`,
    ].join('\n'))
    .setFooter({ text: 'Estra Account Provisioning · บันทึกข้อมูลลงฐานข้อมูลจริงแล้ว' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });

  if (interaction.guild) {
    await postBotLog(interaction.guild, guildConfig, {
      title: '📝 สมัครบัญชี Estra ผ่าน /register',
      description: `<@${interaction.user.id}> สร้างบัญชี \`${account.username}\` (${account.friendCode || '—'})`,
      color: ESTRA_THEME.CYAN,
    });
  }
}
