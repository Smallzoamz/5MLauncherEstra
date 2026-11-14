import { EmbedBuilder } from 'discord.js';
import { ESTRA_THEME } from '../config.js';
import { postBotLog } from '../services/ticketService.js';

export function registerGuildMemberHandlers(client, { store, config }) {
  client.on('guildMemberAdd', async member => {
    try {
      const cfg = store.getGuildConfig(member.guild.id);
      const createdTs = Math.floor(member.user.createdTimestamp / 1000);

      await postBotLog(member.guild, cfg, {
        title: '👋 สมาชิกใหม่เข้าร่วมเซิร์ฟเวอร์',
        description: `<@${member.id}> (${member.user.tag})`,
        color: ESTRA_THEME.CYAN,
        fields: [
          { name: 'User ID', value: `\`${member.id}\``, inline: true },
          { name: 'สร้างบัญชีเมื่อ', value: `<t:${createdTs}:R>`, inline: true },
          { name: 'สมาชิกทั้งหมด', value: `${member.guild.memberCount} คน`, inline: true },
        ],
      });

      if (cfg.generalChannelId) {
        const ch = await member.guild.channels.fetch(cfg.generalChannelId).catch(() => null);
        if (ch && ch.isTextBased()) {
          const welcomeLink = cfg.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : 'ห้อง Welcome';
          const dlLink = cfg.downloadChannelId ? `<#${cfg.downloadChannelId}>` : 'ห้อง Download';
          const embed = new EmbedBuilder()
            .setColor(ESTRA_THEME.CYAN)
            .setAuthor({
              name: `${member.user.username} เข้าร่วม Estra Community`,
              iconURL: member.user.displayAvatarURL({ size: 128 }),
            })
            .setDescription([
              `ยินดีต้อนรับคุณ <@${member.id}> สู่ **Estra FiveM Launcher**!`,
              `• กดยืนยันตัวตนได้ที่ ${welcomeLink} เพื่อเริ่มแชทและเปิด Ticket`,
              `• ดาวน์โหลดตัวติดตั้งตรง (.exe) ล่าสุดได้ที่ ${dlLink} หรือ [เว็บไซต์ทางการ](${config.websiteUrl})`,
            ].join('\n'))
            .setFooter({ text: `สมาชิกคนที่ #${member.guild.memberCount}` })
            .setTimestamp();

          await ch.send({
            embeds: [embed],
            allowedMentions: { users: [member.id] },
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[guildMemberAdd] error:', err?.message || err);
    }
  });

  client.on('guildMemberRemove', async member => {
    try {
      const cfg = store.getGuildConfig(member.guild.id);
      await postBotLog(member.guild, cfg, {
        title: '🚪 สมาชิกออกจากเซิร์ฟเวอร์',
        description: `${member.user?.tag || member.id} (\`${member.id}\`)`,
        color: ESTRA_THEME.WARN,
        fields: [{ name: 'สมาชิกคงเหลือ', value: `${member.guild.memberCount} คน`, inline: true }],
      });
    } catch (err) {
      console.error('[guildMemberRemove] error:', err?.message || err);
    }
  });
}
