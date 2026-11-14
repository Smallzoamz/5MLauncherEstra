import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { PATCH_MANIFEST_TEMPLATE } from '../services/panelBuilders.js';

export const data = new SlashCommandBuilder()
  .setName('patch-template')
  .setDescription('รับเทมเพลต patch-manifest.json สำหรับเจ้าของเซิร์ฟเวอร์ที่ต้องการเชื่อม Estra City Patcher');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.CYAN)
    .setTitle('🛠️ เทมเพลต Estra City Patcher (`patch-manifest.json`)')
    .setDescription([
      'เจ้าของเซิร์ฟเวอร์ FiveM สามารถอัปโหลดไฟล์ JSON นี้ขึ้น GitHub Releases / HTTPS CDN แล้วนำลิงก์มาใส่ใน **ตั้งค่ารายละเอียดเมือง → Patch Manifest URL** ของ Estra Launcher ได้เลย',
      '',
      '```json',
      PATCH_MANIFEST_TEMPLATE,
      '```',
      '• ไฟล์แพตช์ทั้งหมดจะถูกโหลดเข้า `FiveM.app/estra-patches/<serverId>/` พร้อมตรวจ **SHA-256** ทุกไฟล์ก่อนเริ่มเกม',
      '• ต้องการเชื่อมเมืองแบบเต็มรูปแบบ? เปิด Ticket หมวด **เจ้าของเซิร์ฟเวอร์ / City Patcher** ได้เลย',
    ].join('\n'));

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}
