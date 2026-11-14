import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildDownloadPanel } from '../services/panelBuilders.js';
import { fetchEstraTelemetry } from '../services/telemetryService.js';

export const data = new SlashCommandBuilder()
  .setName('estra')
  .setDescription('แสดงข้อมูล Estra FiveM Launcher เวอร์ชันล่าสุด ลิงก์ดาวน์โหลดตรง และสถิติจริง')
  .addBooleanOption(opt =>
    opt
      .setName('private')
      .setDescription('แสดงผลเฉพาะตัวคุณ (ไม่แสดงในห้องแชท)')
      .setRequired(false),
  );

export async function execute(interaction, { config }) {
  const isPrivate = interaction.options.getBoolean('private') ?? false;
  await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

  const telemetry = await fetchEstraTelemetry(config);
  const payload = buildDownloadPanel(config, telemetry);
  await interaction.editReply({
    ...payload,
    allowedMentions: { parse: [] },
  });
}
