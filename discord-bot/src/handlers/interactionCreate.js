import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { COMMAND_MAP } from '../commands/index.js';
import { ESTRA_THEME } from '../config.js';
import { buildTicketModal, FAQ_TOPICS, TICKET_CATEGORIES } from '../services/panelBuilders.js';
import { fetchEstraTelemetry, formatBytes, formatThaiDateTime } from '../services/telemetryService.js';
import {
  claimTicketAction,
  closeTicketAction,
  createTicketFromModal,
  postBotLog,
} from '../services/ticketService.js';

async function safeErrorReply(interaction, message) {
  const payload = {
    content: `❌ ${message}`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => {});
  } else if (interaction.isRepliable()) {
    await interaction.reply(payload).catch(() => {});
  }
}

async function handleVerifyButton(interaction, mode, store) {
  if (!interaction.guild || !interaction.member) {
    await safeErrorReply(interaction, 'ปุ่มนี้ใช้ได้เฉพาะภายในเซิร์ฟเวอร์เท่านั้น');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = store.getGuildConfig(interaction.guildId);
  const roleId = mode === 'member' ? cfg.memberRoleId : cfg.releasePingRoleId;

  if (!roleId) {
    await interaction.editReply('❌ ยังไม่ได้ตั้งค่ายศในเซิร์ฟเวอร์ กรุณาแจ้งทีมงานรัน `/setup server`');
    return;
  }

  const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.editReply('❌ ไม่พบยศเป้าหมายในเซิร์ฟเวอร์ กรุณาแจ้งทีมงานรัน `/setup server`');
    return;
  }

  const botMember = await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.editReply('❌ บอทไม่มีสิทธิ์ `Manage Roles` กรุณาตรวจสอบสิทธิ์ของบอท');
    return;
  }
  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    await interaction.editReply(`❌ ยศบอทอยู่ต่ำกว่า \`${role.name}\` กรุณาลากยศบอทขึ้นไปสูงกว่าก่อนครับ`);
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const hasRole = member.roles.cache.has(role.id);

  if (mode === 'member') {
    if (hasRole) {
      await interaction.editReply('✅ คุณยืนยันตัวตนเรียบร้อยแล้วและมียศ `Estra Member` อยู่แล้วครับ');
      return;
    }
    await member.roles.add(role, 'Estra member self-verification');
    await postBotLog(interaction.guild, cfg, {
      title: '✅ สมาชิกยืนยันตัวตนสำเร็จ',
      description: `<@${member.id}> (${member.user.tag}) กดปุ่มรับยศ <@&${role.id}>`,
      color: ESTRA_THEME.ONLINE,
    });
    await interaction.editReply({
      content: `✅ ยืนยันตัวตนสำเร็จ! คุณได้รับยศ <@&${role.id}> และปลดล็อกห้องแชท + Ticket แล้ว`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (hasRole) {
    await member.roles.remove(role, 'Opted out of Release Ping');
    await interaction.editReply({
      content: `🔕 ปิดรับการแจ้งเตือน <@&${role.id}> เรียบร้อยแล้ว`,
      allowedMentions: { parse: [] },
    });
  } else {
    await member.roles.add(role, 'Opted in to Release Ping');
    await interaction.editReply({
      content: `🔔 เปิดรับการแจ้งเตือน <@&${role.id}> แล้ว! บอทจะแท็กเฉพาะตอนมีเวอร์ชันใหม่ออกเท่านั้น`,
      allowedMentions: { parse: [] },
    });
  }
}

async function handleDownloadButtons(interaction, action, config) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const telemetry = await fetchEstraTelemetry(config);
  const latest = telemetry.latest || {};
  const assetName = latest.assetName || `Estra.FiveM.Launcher_${latest.version || 'latest'}_x64-setup.exe`;

  if (action === 'sha256') {
    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.CYAN)
      .setTitle(`🔍 ตรวจสอบไฟล์ติดตั้ง v${latest.version} & Windows SmartScreen`)
      .setDescription([
        `📦 **ไฟล์ล่าสุด:** \`${assetName}\` (${formatBytes(latest.size)})`,
        `🔐 **SHA-256 ทางการ:**\n\`\`\`txt\n${latest.sha256 || 'ไม่พบค่า SHA-256'}\n\`\`\``,
        '**1) วิธีเช็ก Hash บนเครื่องของคุณ (PowerShell):**',
        `\`\`\`powershell\nGet-FileHash "$env:USERPROFILE\\Downloads\\${assetName}" -Algorithm SHA256\n\`\`\``,
        'หรือคัดลอกผล Hash แล้วใช้คำสั่ง `/verify-hash` ใน Discord เพื่อให้บอทยืนยันให้ทันที',
        '',
        '**2) หาก Windows Defender SmartScreen แจ้งเตือน:**',
        'ตัวติดตั้งรุ่นแรกยังไม่ได้ลงนาม EV Code Signing เชิงพาณิชย์ หาก Hash ตรงกับด้านบนแล้วสามารถกด **More info → Run anyway** เพื่อติดตั้งได้อย่างปลอดภัย',
      ].join('\n'));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (action === 'stats') {
    const recent = [...(telemetry.releases || [])]
      .reverse()
      .slice(0, 5)
      .map(r => `• **${r.tag}** — ${r.downloads.toLocaleString('en-US')} โหลด · \`${formatBytes(r.size)}\``)
      .join('\n') || '• ไม่มีข้อมูล Release ย้อนหลัง';

    const embed = new EmbedBuilder()
      .setColor(ESTRA_THEME.COBALT)
      .setTitle('📊 สถิติการใช้งานและดาวน์โหลดจริงของ Estra')
      .setDescription([
        `ซิงก์ล่าสุด: ${formatThaiDateTime(telemetry.syncedAt)} (\`${telemetry.source}\`)`,
      ].join('\n'))
      .addFields(
        {
          name: '👥 ผู้ใช้งานในระบบ (Zero PII)',
          value: [
            `บัญชีจริงทั้งหมด: **${telemetry.users.total.toLocaleString('en-US')}**`,
            `ออนไลน์ตอนนี้: **${telemetry.users.online.toLocaleString('en-US')}**`,
            `กำลังเล่นในเมือง: **${telemetry.users.inGame.toLocaleString('en-US')}**`,
            `Active 24 ชม.: **${telemetry.users.active24h.toLocaleString('en-US')}**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '⬇️ ยอดดาวน์โหลดสะสม',
          value: [
            `รวมทั้งหมด: **${telemetry.downloads.total.toLocaleString('en-US')} ครั้ง**`,
            `GitHub Verified: **${telemetry.downloads.githubVerified.toLocaleString('en-US')}**`,
            `Direct Web: **${telemetry.downloads.webDirect.toLocaleString('en-US')}**`,
            `รุ่นล่าสุด: **${latest.tag}**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '📦 5 เวอร์ชันล่าสุด',
          value: recent,
          inline: false,
        },
      );
    await interaction.editReply({ embeds: [embed] });
  }
}

export function createInteractionHandler({ config, store }) {
  return async function onInteractionCreate(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = COMMAND_MAP.get(interaction.commandName);
        if (!command) {
          await safeErrorReply(interaction, 'ไม่พบคำสั่งนี้ในระบบ');
          return;
        }
        await command.execute(interaction, { config, store });
        return;
      }

      if (interaction.isButton()) {
        const id = interaction.customId;

        if (id === 'verify:member') {
          await handleVerifyButton(interaction, 'member', store);
          return;
        }
        if (id === 'verify:release_ping') {
          await handleVerifyButton(interaction, 'release_ping', store);
          return;
        }
        if (id === 'dl:sha256') {
          await handleDownloadButtons(interaction, 'sha256', config);
          return;
        }
        if (id === 'dl:stats') {
          await handleDownloadButtons(interaction, 'stats', config);
          return;
        }

        if (id.startsWith('ticket:open:')) {
          const catKey = id.slice('ticket:open:'.length);
          if (!TICKET_CATEGORIES[catKey]) {
            await safeErrorReply(interaction, 'หมวดหมู่ Ticket ไม่ถูกต้อง');
            return;
          }
          if (!interaction.guildId) {
            await safeErrorReply(interaction, 'เปิด Ticket ได้เฉพาะภายในเซิร์ฟเวอร์เท่านั้น');
            return;
          }
          const openCount = store.countOpenTicketsByCreator(interaction.guildId, interaction.user.id);
          if (openCount >= config.maxOpenTicketsPerUser) {
            await safeErrorReply(
              interaction,
              `คุณมี Ticket เปิดอยู่แล้ว ${openCount} ห้อง (สูงสุด ${config.maxOpenTicketsPerUser} ห้อง) กรุณาปิดเคสเดิมก่อน`,
            );
            return;
          }
          // Modal MUST be the initial response — do not defer before showModal
          await interaction.showModal(buildTicketModal(catKey));
          return;
        }

        if (id === 'ticket:claim') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const res = await claimTicketAction(interaction, store);
          if (!res.ok) {
            await interaction.editReply(`❌ ${res.message}`);
            return;
          }
          await interaction.editReply(`✅ คุณรับเรื่อง Ticket #${String(res.ticket.ticketNumber).padStart(4, '0')} เรียบร้อยแล้ว`);
          await interaction.channel.send({
            content: `🙋 <@${interaction.user.id}> เข้ารับเรื่องดูแล Ticket นี้แล้วครับ`,
            allowedMentions: { users: [interaction.user.id] },
          }).catch(() => {});
          return;
        }

        if (id === 'ticket:close') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const res = await closeTicketAction(interaction, store);
          if (!res.ok) {
            await interaction.editReply(`❌ ${res.message}`);
            return;
          }
          await interaction.editReply('🔒 บันทึก Transcript เรียบร้อยแล้ว กำลังลบห้องใน 3 วินาที...');
          await interaction.channel.send(`🔒 Ticket ถูกปิดโดย <@${interaction.user.id}> กำลังลบห้อง...`).catch(() => {});
          setTimeout(() => {
            interaction.channel.delete(`Ticket #${res.ticket.ticketNumber} closed`).catch(() => {});
          }, 3000);
          return;
        }

        await safeErrorReply(interaction, 'ปุ่มนี้หมดอายุหรือไม่รองรับแล้ว');
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'faq:topic') {
        const key = interaction.values?.[0];
        const topic = FAQ_TOPICS[key];
        if (!topic) {
          await safeErrorReply(interaction, 'ไม่พบหัวข้อคู่มือที่เลือก');
          return;
        }
        const embed = new EmbedBuilder()
          .setColor(ESTRA_THEME.CYAN)
          .setTitle(`${topic.emoji} ${topic.title}`)
          .setDescription(topic.body);
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:modal:')) {
        const catKey = interaction.customId.slice('ticket:modal:'.length);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const res = await createTicketFromModal(interaction, catKey, store, config);
        if (!res.ok) {
          await interaction.editReply(`❌ ${res.message}`);
          return;
        }
        await interaction.editReply({
          content: `✅ เปิดห้อง Ticket เรียบร้อยแล้ว: <#${res.channel.id}>`,
          allowedMentions: { parse: [] },
        });
      }
    } catch (err) {
      console.error('[interactionCreate] error:', err?.message || err);
      await safeErrorReply(interaction, 'เกิดข้อผิดพลาดระหว่างประมวลผล กรุณาลองใหม่อีกครั้ง');
    }
  };
}
