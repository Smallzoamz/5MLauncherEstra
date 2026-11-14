import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { queryFiveMServerForDiscord } from '../services/fivemService.js';

export const data = new SlashCommandBuilder()
  .setName('fivem-check')
  .setDescription('ตรวจสถานะเซิร์ฟเวอร์ FiveM, Game Build และ Pure Mode แบบเดียวกับ Estra Smart Preflight')
  .addStringOption(opt =>
    opt
      .setName('target')
      .setDescription('ระบุ cfx.re/join/code หรือ IP:port ของเซิร์ฟเวอร์ FiveM')
      .setRequired(true)
      .setMaxLength(200),
  );

export async function execute(interaction) {
  await interaction.deferReply();
  const target = interaction.options.getString('target', true);

  try {
    const info = await queryFiveMServerForDiscord(target);
    const playersText = info.clients !== null && info.maxClients !== null
      ? `**${info.clients}** / ${info.maxClients} คน`
      : info.clients !== null
        ? `**${info.clients}** คน`
        : '—';

    const buildText = info.gameBuild ? `\`b${info.gameBuild}\`` : 'ไม่ระบุใน Info';
    const pureText = info.lockPure !== null ? `\`Pure ${info.lockPure}\`` : 'ไม่ระบุใน Info';

    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.ONLINE)
      .setTitle(`🟢 ${info.hostname || info.address}`)
      .setDescription(`ตรวจสอบด้วยระบบ **Estra Smart Preflight** สำเร็จ (${info.requirementsSource})`)
      .addFields(
        { name: 'ที่อยู่เชื่อมต่อ', value: `\`${info.address}\``, inline: true },
        { name: 'ผู้เล่นออนไลน์', value: playersText, inline: true },
        { name: 'เวลาตอบสนอง', value: `\`${info.pingMs} ms\``, inline: true },
        { name: 'Game Build', value: buildText, inline: true },
        { name: 'Pure Mode', value: pureText, inline: true },
        { name: 'พารามิเตอร์ที่ Estra ส่งเข้า FiveM', value: `\`\`\`txt\n${info.launchArgsPreview}\n\`\`\``, inline: false },
      )
      .setFooter({ text: 'Estra ส่ง -b และ -pure_ เข้า FiveM โดยตรงโดยไม่เขียนทับ CitizenFX.ini' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.ERROR)
      .setTitle('🔴 ตรวจสอบเซิร์ฟเวอร์ไม่สำเร็จ')
      .setDescription(err.message || 'เซิร์ฟเวอร์ไม่ตอบกลับหรือรูปแบบที่อยู่ไม่ถูกต้อง');
    await interaction.editReply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}
