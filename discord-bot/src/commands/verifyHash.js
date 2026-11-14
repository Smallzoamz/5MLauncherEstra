import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { fetchEstraTelemetry, formatBytes, formatThaiDateTime, verifyReleaseSha256 } from '../services/telemetryService.js';

export const data = new SlashCommandBuilder()
  .setName('verify-hash')
  .setDescription('ตรวจสอบค่า SHA-256 ของไฟล์ติดตั้ง .exe ว่าตรงกับรุ่นทางการของ Estra หรือไม่')
  .addStringOption(opt =>
    opt
      .setName('sha256')
      .setDescription('ค่า SHA-256 (64 ตัวอักษร) เช่น ผลจากคำสั่ง Get-FileHash ใน PowerShell')
      .setRequired(true)
      .setMinLength(64)
      .setMaxLength(80),
  )
  .addStringOption(opt =>
    opt
      .setName('version')
      .setDescription('ระบุเวอร์ชันที่ต้องการเทียบเพิ่มเติม (เช่น 2.1.7)')
      .setRequired(false)
      .setMaxLength(20),
  );

export async function execute(interaction, { config }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const shaInput = interaction.options.getString('sha256', true);
  const versionInput = interaction.options.getString('version') || '';
  const telemetry = await fetchEstraTelemetry(config);
  const result = verifyReleaseSha256(shaInput, telemetry, versionInput);

  if (!result.validFormat) {
    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.ERROR)
      .setTitle('❌ รูปแบบค่า SHA-256 ไม่ถูกต้อง')
      .setDescription(`${result.reason}\n\nตัวอย่างคำสั่ง PowerShell สำหรับหา Hash:\n\`\`\`powershell\nGet-FileHash .\\Estra.FiveM.Launcher_${telemetry.latest.version}_x64-setup.exe -Algorithm SHA256\n\`\`\``);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (!result.matched) {
    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.ERROR)
      .setTitle('⚠️ ไม่พบ SHA-256 นี้ในรุ่นทางการของ Estra')
      .setDescription([
        'ค่า Hash ที่ระบุ **ไม่ตรงกับไฟล์ติดตั้งใดๆ** จาก GitHub Release อย่างเป็นทางการของ Estra',
        '',
        '• แนะนำให้ลบไฟล์ดังกล่าวและดาวน์โหลดใหม่จากเว็บไซต์หรือห้องดาวน์โหลดทางการเท่านั้น',
        `• รุ่นล่าสุดในระบบตอนนี้คือ **${telemetry.latest.tag}** (\`${telemetry.latest.sha256 || '—'}\`)`,
      ].join('\n'));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const rel = result.matchedRelease;
  const mismatchVersionNote = !result.versionMatch
    ? `\n⚠️ **หมายเหตุ:** ค่า Hash นี้เป็นของจริง แต่เป็นรุ่น **${rel.tag}** (ไม่ใช่รุ่น \`v${result.requestedVersion}\` ที่คุณระบุ)`
    : '';

  const embed = new EmbedBuilder()
    .setColor(result.versionMatch ? ESTRA_THEME.ONLINE : ESTRA_THEME.WARN)
    .setTitle(`✅ ยืนยันไฟล์ติดตั้งทางการ — ${rel.tag}`)
    .setDescription([
      `ค่า SHA-256 นี้ **ตรงกับไฟล์ติดตั้งทางการของ Estra 100%**${result.isLatest ? ' (เป็นเวอร์ชันล่าสุด)' : ' (เวอร์ชันเก่า — แนะนำอัปเดตเป็นรุ่นล่าสุด)'}${mismatchVersionNote}`,
      '',
      `📦 **ไฟล์:** \`${rel.assetName}\``,
      `📏 **ขนาด:** \`${formatBytes(rel.size)}\``,
      `🕒 **เผยแพร่เมื่อ:** ${formatThaiDateTime(rel.publishedAt)}`,
      `🔐 **SHA-256:** \`${rel.sha256}\``,
    ].join('\n'));

  await interaction.editReply({ embeds: [embed] });
}
