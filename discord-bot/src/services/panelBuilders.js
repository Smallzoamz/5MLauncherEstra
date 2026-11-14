import fs from 'node:fs';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { BRAND_ASSETS, ESTRA_THEME } from '../config.js';
import { formatBytes, formatThaiDateTime } from './telemetryService.js';

export const PATCH_MANIFEST_TEMPLATE = JSON.stringify({
  version: '1.0.0',
  name: 'Estra City Patch',
  notes: '- อัปเดตไฟล์เสียงและเมนูในเมือง\n- แก้ไขไฟล์คอนฟิกหลัก',
  publishedAt: '2026-11-15T12:00:00Z',
  files: [
    {
      path: 'citizen/common/data/example.meta',
      url: 'https://github.com/OWNER/REPO/releases/download/patch-1.0.0/example.meta',
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      size: 1024,
    },
  ],
}, null, 2);

export const TICKET_CATEGORIES = {
  bug: {
    key: 'bug',
    label: 'แจ้งบั๊ก / ปัญหาใช้งาน',
    shortPrefix: 'bug',
    emoji: '🐛',
    color: ESTRA_THEME.ERROR,
    subjectPlaceholder: 'เช่น เปิดเกมแล้วขึ้น Build ไม่ตรง / จอค้างหน้า Splash',
  },
  partner: {
    key: 'partner',
    label: 'Partner / Sponsor / City Patcher',
    shortPrefix: 'partner',
    emoji: '🤝',
    color: ESTRA_THEME.WARN,
    subjectPlaceholder: 'เช่น สมัคร Server Partner / FiveM Partner (เสื้อผ้า, พรอบ) / Sponsor',
  },
  idea: {
    key: 'idea',
    label: 'เสนอฟีเจอร์ / ติดต่อทีมงาน',
    shortPrefix: 'idea',
    emoji: '💡',
    color: ESTRA_THEME.CYAN,
    subjectPlaceholder: 'เช่น อยากให้เพิ่มฟีเจอร์ใหม่หรือสอบถามเรื่องทั่วไป',
  },
};

export const FAQ_TOPICS = {
  install: {
    label: 'วิธีติดตั้ง & ผ่าน SmartScreen',
    description: 'ติดตั้งใน 1 คลิก, ตรวจ SHA-256 และแก้หน้าต่างเตือน Windows',
    emoji: '⬇️',
    title: 'วิธีติดตั้ง Estra FiveM Launcher & SmartScreen',
    body: [
      '• **ไม่ต้องลง Node.js หรือโปรแกรมเสริม** — ตัวติดตั้งรุ่น v2.x พัฒนาด้วย **Rust + Tauri v2** บน Windows 10/11 (64-bit) ขนาดประมาณ 7 MB',
      '• **ทำไม Windows SmartScreen ถึงเตือน?** — ตัวติดตั้งรุ่นแรกยังไม่ได้ซื้อ EV Code Signing เชิงพาณิชย์ จึงอาจขึ้นหน้าต่างสีน้ำเงินเมื่อรันครั้งแรก',
      '• **วิธีใช้งานอย่างปลอดภัย:**',
      '  1. กด **More info → Run anyway** หลังตรวจสอบแล้วว่าโหลดจากเว็บหรือ Discord ทางการของ Estra',
      '  2. ใช้คำสั่ง `/verify-hash` ใน Discord นี้ หรือรัน PowerShell:',
      '     `Get-FileHash .\\Estra.FiveM.Launcher_<version>_x64-setup.exe -Algorithm SHA256`',
      '     เพื่อเทียบกับค่า SHA-256 บนหน้าดาวน์โหลด',
    ].join('\n'),
  },
  preflight: {
    label: 'Smart Preflight, Build/Pure Mode & CL2',
    description: 'เปิดเกม 2 จอและส่งค่า -b / -pure_ แบบไม่เขียนทับ CitizenFX.ini',
    emoji: '⚡',
    title: 'Smart Preflight & การเปิด 2 จอ (CL2)',
    body: [
      '• **Smart Preflight:** ก่อนกดเข้าเล่นทุกครั้ง Estra จะดึงค่า `sv_enforceGameBuild` และ `sv_pureLevel` สดจากเซิร์ฟเวอร์เป้าหมาย แล้วส่งพารามิเตอร์ `-b<build>` และ `-pure_<level>` เข้า `FiveM.exe` โดยตรง',
      '• **ไม่ทับไฟล์ระบบ:** Estra **ไม่เขียนทับ `CitizenFX.ini`** ของคุณ จึงไม่ทำให้ค่าจากเมืองเก่าค้างไปตีกับเมืองใหม่',
      '• **Process Guard & CL2:** ถ้าเปิด FiveM อยู่แล้ว ปุ่มเข้าเมืองจะป้องกันการเปิดซ้อนโดยไม่ตั้งใจ ยกเว้นเมื่อเปิดโหมด **CL2** (สำหรับ Legacy ส่ง `-cl2` อัตโนมัติ)',
      '• **ทดสอบจาก Discord:** ลองพิมพ์ `/fivem-check` แล้วใส่ `cfx.re/join/code` หรือ `ip:port` เพื่อดูค่า Build และ Pure ที่ Estra จะใช้เปิดเกมให้คุณ!',
    ].join('\n'),
  },
  patcher: {
    label: 'City Patcher & Auto-Update (Minisign)',
    description: 'ระบบซิงก์แพตช์เมืองตรวจ SHA-256 และอัปเดตตัวลันเชอร์อัตโนมัติ',
    emoji: '🛡️',
    title: 'Pre-Launch City Patcher & Minisign Auto-Update',
    body: [
      '• **Auto-Update ปลอดภัย:** ตัวลันเชอร์ตรวจอัปเดตอัตโนมัติผ่าน `latest.json` ที่ลงนาม **Minisign Public Key** ป้องกันการปลอมแปลงไฟล์อัปเดต',
      '• **City Resource Patcher:** เจ้าของเซิร์ฟเวอร์ FiveM สามารถวาง `patch-manifest.json` ผ่าน HTTPS ให้ Estra ซิงก์ไฟล์เข้า `FiveM.app/estra-patches/<serverId>/` พร้อมตรวจ **SHA-256 ทุกไฟล์** ก่อนเข้าเมือง',
      '• เจ้าของเมืองที่อยากลองสร้าง Manifest พิมพ์ `/patch-template` เพื่อรับโครงสร้าง JSON พร้อมตัวอย่างได้เลย หรือเปิด Ticket หมวด **City Patcher** ได้ตลอด!',
    ].join('\n'),
  },
  social: {
    label: 'ระบบเพื่อนออนไลน์ ESTRA-XXXX & ชวนเข้าเมือง',
    description: 'แอดเพื่อนด้วยโค้ดและชวนเข้าเซิร์ฟเวอร์แบบ Real-time',
    emoji: '👥',
    title: 'Online Social (ESTRA-XXXX) & Real-time Invite',
    body: [
      '• **Friend Code ส่วนตัว:** ทุกบัญชีในลันเชอร์มีรหัส `ESTRA-XXXX` ใช้แอดเพื่อนและเห็นสถานะออนไลน์ / ชื่อเมืองที่เพื่อนกำลังเล่นแบบ Real-time ผ่าน Supabase',
      '• **ชวนเข้าเมืองในคลิกเดียว:** กดส่ง Game Invite ให้เพื่อนเข้าตามเข้าเซิร์ฟเวอร์เดียวกันได้ทันที',
      '• **Privacy-First:** สามารถสลับเป็น **Offline / Invisible** ในลันเชอร์ได้ตลอดเวลา และระบบนับสถิติหน้าเว็บคัดกรองบัญชีทดสอบออกทั้งหมดโดยไม่เปิดเผยข้อมูลส่วนตัว (Zero PII)',
    ].join('\n'),
  },
  cleaner: {
    label: 'Safe Cache Cleaner, ทดสอบไมค์ & ประวัติ 50 ครั้ง',
    description: 'ล้างแคชปลอดภัย ไม่ยุ่ง game-storage พร้อมระบบเช็กไมค์ในตัว',
    emoji: '🧹',
    title: 'Safe Maintenance, Mic Check & Launch History',
    body: [
      '• **Safe Cache Cleaner:** ล้างเฉพาะ `server-cache`, `server-cache-priv`, `cache/subprocess` (รวมถึงตัวเลือก Log / Crash / Shader) โดย **เก็บ `game-storage` และ `cache/game` ไว้** และปฏิเสธ symbolic link / junction เพื่อความปลอดภัย',
      '• **Auto Mic Check:** ทดสอบอุปกรณ์รับเสียงและสิทธิ์ไมโครโฟนได้ในตัวก่อนเข้าเมือง',
      '• **Launch History & Tray:** บันทึกประวัติการเข้าเมือง 50 ครั้งล่าสุด พร้อมเมนู System Tray กดเข้าเมืองล่าสุดได้ทันที',
    ].join('\n'),
  },
};

function loadBrandAttachments({ includeBanner = true, includeMark = true } = {}) {
  const files = [];
  if (includeBanner && fs.existsSync(BRAND_ASSETS.bannerPath)) {
    files.push(new AttachmentBuilder(BRAND_ASSETS.bannerPath, { name: 'og-banner.png' }));
  }
  if (includeMark && fs.existsSync(BRAND_ASSETS.markPath)) {
    files.push(new AttachmentBuilder(BRAND_ASSETS.markPath, { name: 'estra-mark.png' }));
  }
  return files;
}

export function buildWelcomePanel(config, guildConfig = {}) {
  const files = loadBrandAttachments({ includeBanner: true, includeMark: true });
  const hasBanner = files.some(f => f.name === 'og-banner.png');
  const hasMark = files.some(f => f.name === 'estra-mark.png');
  const dlMention = guildConfig.downloadChannelId ? `<#${guildConfig.downloadChannelId}>` : '`⚡・download-estra`';
  const faqMention = guildConfig.faqChannelId ? `<#${guildConfig.faqChannelId}>` : '`❓・faq-howto`';
  const ticketMention = guildConfig.ticketHubChannelId ? `<#${guildConfig.ticketHubChannelId}>` : '`🎫・open-ticket`';
  const friendCodesMention = guildConfig.friendCodesChannelId ? `<#${guildConfig.friendCodesChannelId}>` : '`🆔・friend-codes`';

  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.CYAN)
    .setAuthor({
      name: 'ESTRA FIVEM LAUNCHER · OFFICIAL DISCORD',
      ...(hasMark ? { iconURL: 'attachment://estra-mark.png' } : {}),
    })
    .setTitle('เปิดเกม FiveM เร็ว ลื่น ปลอดภัย — ครบในลันเชอร์เดียว')
    .setDescription([
      'ยินดีต้อนรับสู่คอมมูนิตี้อย่างเป็นทางการของ **Estra FiveM Launcher** (Windows x64 · Rust + Tauri v2)',
      '',
      '🧭 **เริ่มต้นใช้งานใน 10 วินาที**',
      `> • โหลดไฟล์ติดตั้งตรง (.exe) + เช็ก SHA-256 ที่ ${dlMention}`,
      `> • พิมพ์ \`/register id:ไอดีของคุณ\` เพื่อสมัครบัญชี Estra ทันที (เห็นข้อความเฉพาะคุณ) แล้วนำโค้ดไปหาเพื่อนใน ${friendCodesMention}`,
      `> • อ่านคู่มือ Smart Preflight / CL2 / Patcher ที่ ${faqMention}`,
      `> • แจ้งปัญหา หรือสมัคร Partner / Sponsor / City Patcher ที่ ${ticketMention}`,
      '',
      '📜 **กติกาประจำเซิร์ฟเวอร์ (กระชับ 4 ข้อ)**',
      '```txt\n1. พูดคุยอย่างสุภาพ ให้เกียรติสมาชิกและทีมงานทุกคน\n2. ห้ามส่งลิงก์ปลอม ไฟล์อันตราย ม็อดโกง (Cheat/Spoofer) หรือสแปม\n3. ห้ามโฆษณาเซิร์ฟเวอร์/ร้านค้าอื่นนอกพื้นที่ที่กำหนด\n4. แจ้งบั๊กหรือขอความช่วยเหลือกรุณาเปิด Ticket เพื่อความรวดเร็ว\n```',
      'กด **✅ ยืนยันตัวตน** ด้านล่างเพื่อปลดล็อกห้องแชทและ Ticket และสามารถกด **🔔 รับแจ้งเตือนอัปเดต** เฉพาะตอนปล่อยเวอร์ชันใหม่ได้เลย',
    ].join('\n'))
    .setFooter({ text: 'Estra FiveM Launcher · ไม่ใช่ซอฟต์แวร์อย่างเป็นทางการของ Cfx.re / Rockstar Games' });

  if (hasBanner) embed.setImage('attachment://og-banner.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:member')
      .setLabel('ยืนยันตัวตน (Estra Member)')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('verify:release_ping')
      .setLabel('รับ/ปิด แจ้งเตือนอัปเดต')
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('เว็บไซต์ทางการ')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Link)
      .setURL(config.websiteUrl),
  );

  return { embeds: [embed], components: [row], files };
}

export function buildDownloadPanel(config, telemetry) {
  const files = loadBrandAttachments({ includeBanner: true, includeMark: true });
  const hasBanner = files.some(f => f.name === 'og-banner.png');
  const hasMark = files.some(f => f.name === 'estra-mark.png');

  const latest = telemetry.latest || {};
  const sha = latest.sha256 || 'กำลังซิงก์จาก Release...';
  const sizeText = formatBytes(latest.size);
  const pubText = formatThaiDateTime(latest.publishedAt);
  const assetName = latest.assetName || `Estra.FiveM.Launcher_${latest.version || 'latest'}_x64-setup.exe`;

  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.COBALT)
    .setAuthor({
      name: `DIRECT DOWNLOAD HUB · V${latest.version || '—'}`,
      ...(hasMark ? { iconURL: 'attachment://estra-mark.png' } : {}),
    })
    .setTitle(`Estra FiveM Launcher v${latest.version || '—'} (Windows 10/11 x64)`)
    .setDescription([
      'ดาวน์โหลดตัวติดตั้งตรงจากเซิร์ฟเวอร์ทางการของ Estra ในคลิกเดียว พร้อมตรวจ **Minisign Auto-Updater** และ **SHA-256 Checksum** ครบถ้วน',
      '',
      `📦 **ไฟล์ติดตั้ง:** \`${assetName}\``,
      `🔐 **SHA-256 Checksum:**\n\`\`\`txt\n${sha}\n\`\`\``,
    ].join('\n'))
    .addFields(
      {
        name: '📏 ขนาดไฟล์ & เผยแพร่',
        value: `\`${sizeText}\`\n${pubText}`,
        inline: true,
      },
      {
        name: '📊 สถิติจริง (Real-Time)',
        value: `ผู้ใช้งาน: **${telemetry.users.total}** · ออนไลน์: **${telemetry.users.online}**\nดาวน์โหลดสะสม: **${telemetry.downloads.total.toLocaleString('en-US')} ครั้ง**`,
        inline: true,
      },
      {
        name: '✨ จุดเด่นสำคัญ',
        value: '• Rust + Tauri v2 Native (~7 MB)\n• Smart Preflight (`-b` / `-pure_`) + CL2 2 จอ\n• Pre-Launch City Patcher + Safe Cleaner',
        inline: false,
      },
    )
    .setFooter({ text: 'คลิกปุ่ม "ตรวจ SHA-256 & SmartScreen" เพื่อดูคำสั่ง PowerShell ตรวจสอบไฟล์' })
    .setTimestamp(new Date(telemetry.syncedAt || Date.now()));

  if (hasBanner) embed.setImage('attachment://og-banner.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(`ดาวน์โหลดตรง (.exe · ${sizeText})`)
      .setEmoji('⬇️')
      .setStyle(ButtonStyle.Link)
      .setURL(config.downloadUrl),
    new ButtonBuilder()
      .setCustomId('dl:sha256')
      .setLabel('ตรวจ SHA-256 & SmartScreen')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('dl:stats')
      .setLabel('สถิติ Real-Time')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('GitHub Releases')
      .setEmoji('📦')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://github.com/${config.githubRepo}/releases`),
  );

  return { embeds: [embed], components: [row], files };
}

export function buildReleaseAnnouncement(config, telemetry, { rolePingId = null } = {}) {
  const files = loadBrandAttachments({ includeBanner: false, includeMark: true });
  const hasMark = files.some(f => f.name === 'estra-mark.png');
  const latest = telemetry.latest || {};
  const sizeText = formatBytes(latest.size);
  const notes = latest.notes && latest.notes.length > 0
    ? latest.notes.slice(0, 1200)
    : '• ปรับปรุงประสิทธิภาพและความเสถียรในการเปิดใช้งาน FiveM';

  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.ONLINE)
    .setAuthor({
      name: 'NEW LAUNCHER RELEASE',
      ...(hasMark ? { iconURL: 'attachment://estra-mark.png' } : {}),
    })
    .setTitle(`🚀 Estra FiveM Launcher ${latest.tag || `v${latest.version}`} พร้อมดาวน์โหลดแล้ว!`)
    .setDescription([
      notes,
      '',
      `📦 **ไฟล์:** \`${latest.assetName || `Estra.FiveM.Launcher_${latest.version}_x64-setup.exe`}\` (${sizeText})`,
      `🔐 **SHA-256:** \`${latest.sha256 || '—'}\``,
      '',
      'ผู้ที่ติดตั้งไว้แล้วสามารถเปิดโปรแกรมเพื่อให้ **Minisign Auto-Updater** อัปเดตให้อัตโนมัติ หรือกดดาวน์โหลดตรงด้านล่างได้ทันที',
    ].join('\n'))
    .setFooter({ text: `เผยแพร่เมื่อ ${formatThaiDateTime(latest.publishedAt)}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(`ดาวน์โหลด v${latest.version}`)
      .setEmoji('⬇️')
      .setStyle(ButtonStyle.Link)
      .setURL(config.downloadUrl),
    new ButtonBuilder()
      .setLabel('Release Notes บน GitHub')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://github.com/${config.githubRepo}/releases/tag/${encodeURIComponent(latest.tag || `v${latest.version}`)}`),
  );

  const payload = {
    embeds: [embed],
    components: [row],
    files,
    allowedMentions: rolePingId ? { roles: [rolePingId] } : { parse: [] },
  };
  if (rolePingId) {
    payload.content = `🔔 <@&${rolePingId}> อัปเดตใหม่ **${latest.tag || `v${latest.version}`}** พร้อมใช้งานแล้ว!`;
  }
  return payload;
}

export function buildFaqPanel(config) {
  const files = loadBrandAttachments({ includeBanner: false, includeMark: true });
  const hasMark = files.some(f => f.name === 'estra-mark.png');

  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.SKY)
    .setAuthor({
      name: 'ESTRA KNOWLEDGE BASE & FAQ',
      ...(hasMark ? { iconURL: 'attachment://estra-mark.png' } : {}),
    })
    .setTitle('❓ คู่มือการใช้งาน & คำถามที่พบบ่อย')
    .setDescription([
      'เลือกหัวข้อจากเมนูด้านล่างเพื่อดูรายละเอียดแบบเจาะลึก (แสดงผลแบบส่วนตัวเฉพาะคุณ ไม่รกหน้าห้อง)',
      '',
      '**คำสั่งบอทที่ใช้ได้ทันทีในคอมมูนิตี้:**',
      '• `/register` — สมัครสมาชิก Estra Launcher ทันทีจากใน Discord (ตอบกลับส่วนตัว พร้อมรหัสผ่านครั้งแรกและแจ้งเตือนให้เปลี่ยนหลัง Login)',
      '• `/estra` — แสดงการ์ดดาวน์โหลดและสถานะเวอร์ชันล่าสุด',
      '• `/verify-hash` — ตรวจสอบค่า SHA-256 ของไฟล์ `.exe` ที่โหลดมาว่าตรงรุ่นจริงหรือไม่',
      '• `/fivem-check` — เช็กสถานะเซิร์ฟเวอร์ FiveM + ดูค่า Game Build & Pure Mode ที่ Estra จะใช้เปิดเกม',
      '• `/patch-template` — รับเทมเพลต `patch-manifest.json` สำหรับเจ้าของเมืองที่ต้องการเชื่อม City Patcher',
    ].join('\n'))
    .setFooter({ text: `Website: ${config.websiteUrl} · Facebook: @estralauncher` });

  const select = new StringSelectMenuBuilder()
    .setCustomId('faq:topic')
    .setPlaceholder('เลือกหัวข้อคู่มือที่ต้องการอ่าน...')
    .addOptions(
      Object.entries(FAQ_TOPICS).map(([value, item]) => ({
        label: item.label,
        description: item.description.slice(0, 100),
        value,
        emoji: item.emoji,
      })),
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    files,
  };
}

export function buildTicketHubPanel() {
  const files = loadBrandAttachments({ includeBanner: false, includeMark: true });
  const hasMark = files.some(f => f.name === 'estra-mark.png');

  const embed = new EmbedBuilder()
    .setColor(ESTRA_THEME.COBALT)
    .setAuthor({
      name: 'ESTRA SUPPORT & PARTNER DESK',
      ...(hasMark ? { iconURL: 'attachment://estra-mark.png' } : {}),
    })
    .setTitle('🎫 เปิด Ticket ติดต่อทีมงาน Estra')
    .setDescription([
      'หากพบปัญหาการใช้งาน ต้องการเชื่อม **City Patcher** ให้เซิร์ฟเวอร์ FiveM ของคุณ หรือมีข้อเสนอแนะ สามารถเลือกหมวดหมู่ด้านล่างเพื่อสร้างห้องสนทนาส่วนตัวกับทีมงานได้ทันที',
      '',
      '> 🐛 **แจ้งบั๊ก / ปัญหาใช้งาน** — เปิดเกมไม่ได้, เช็กไมค์, SmartScreen, แพตช์ค้าง',
      '> 🤝 **Partner / Sponsor / City Patcher** — สมัคร Server Partner, FiveM Partner (ร้านเสื้อผ้า พรอบ สคริปต์), Sponsor หรือเชื่อม City Patcher',
      '> 💡 **เสนอฟีเจอร์ / ติดต่อทั่วไป** — แนะนำความสามารถใหม่ๆ หรือสอบถามทีมงาน',
    ].join('\n'))
    .setFooter({ text: 'จำกัดการเปิดพร้อมกันสูงสุด 2 Ticket ต่อบัญชี · มีระบบบันทึก Transcript เมื่อปิดเคส' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:open:bug')
      .setLabel(TICKET_CATEGORIES.bug.label)
      .setEmoji('🐛')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket:open:partner')
      .setLabel(TICKET_CATEGORIES.partner.label)
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket:open:idea')
      .setLabel(TICKET_CATEGORIES.idea.label)
      .setEmoji('💡')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row], files };
}

export function buildTicketModal(categoryKey) {
  const cat = TICKET_CATEGORIES[categoryKey] || TICKET_CATEGORIES.bug;
  const modal = new ModalBuilder()
    .setCustomId(`ticket:modal:${cat.key}`)
    .setTitle(`${cat.emoji} ${cat.label}`.slice(0, 45));

  const subjectInput = new TextInputBuilder()
    .setCustomId('ticket_subject')
    .setLabel('หัวข้อเรื่อง / สรุปสั้นๆ')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(cat.subjectPlaceholder.slice(0, 100))
    .setMinLength(4)
    .setMaxLength(100)
    .setRequired(true);

  const detailsInput = new TextInputBuilder()
    .setCustomId('ticket_details')
    .setLabel('รายละเอียดเพิ่มเติม & เวอร์ชัน Estra')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('อธิบายปัญหา เวอร์ชัน Estra (เช่น v2.1.7) หรือข้อความถึงทีมงาน...')
    .setMinLength(8)
    .setMaxLength(1000)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(detailsInput),
  );
  return modal;
}

export function buildTicketWelcomeMessage({ ticketNumber, categoryKey, creatorId, subject, details, claimedBy = null }) {
  const cat = TICKET_CATEGORIES[categoryKey] || TICKET_CATEGORIES.bug;
  const numStr = String(ticketNumber).padStart(4, '0');

  const embed = new EmbedBuilder()
    .setColor(cat.color)
    .setTitle(`${cat.emoji} Ticket #${numStr} — ${cat.label}`)
    .addFields(
      { name: 'ผู้เปิดเคส', value: `<@${creatorId}>`, inline: true },
      { name: 'ผู้รับเรื่อง (Claim)', value: claimedBy ? `<@${claimedBy}>` : '⏳ รอทีมงานรับเรื่อง', inline: true },
      { name: 'หัวข้อ', value: subject, inline: false },
      { name: 'รายละเอียด', value: details, inline: false },
    )
    .setFooter({ text: 'สามารถส่งภาพหน้าจอหรือไฟล์ Log เพิ่มเติมในห้องนี้ได้เลย' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel(claimedBy ? 'รับเรื่องแล้ว' : 'ทีมงานรับเรื่อง (Claim)')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(claimedBy)),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('ปิด Ticket & บันทึก Transcript')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    content: `<@${creatorId}> เปิด Ticket #${numStr} เรียบร้อยแล้ว ทีมงานจะเข้ามาดูแลโดยเร็วครับ`,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [creatorId] },
  };
}

function buildZoneGuidePanel({
  author,
  title,
  descriptionLines,
  color = ESTRA_THEME.COBALT,
  footer,
  includePartnerTicketButton = false,
}) {
  const files = loadBrandAttachments({ includeBanner: false, includeMark: true });
  const hasMark = files.some(f => f.name === 'estra-mark.png');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: author,
      ...(hasMark ? { iconURL: 'attachment://estra-mark.png' } : {}),
    })
    .setTitle(title)
    .setDescription(descriptionLines.join('\n'));

  if (footer) embed.setFooter({ text: footer });

  const components = [];
  if (includePartnerTicketButton) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:open:partner')
          .setLabel('ติดต่อสมัคร Partner / Sponsor')
          .setEmoji('🤝')
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  return { embeds: [embed], components, files };
}

export function buildSponsorsPanel() {
  return buildZoneGuidePanel({
    author: 'ESTRA OFFICIAL SPONSORS',
    title: '💎 โซนผู้สนับสนุนอย่างเป็นทางการ (Sponsor)',
    color: 0x38bdf8,
    includePartnerTicketButton: true,
    descriptionLines: [
      'พื้นที่สำหรับผู้สนับสนุนและแบรนด์ที่ร่วมผลักดันการพัฒนา **Estra FiveM Launcher**',
      '',
      '• ผู้ที่ได้รับยศ **💎 Sponsor** สามารถโพสต์แนะนำแบรนด์ ลิงก์ติดต่อ และประกาศพิเศษในห้องนี้ได้โดยตรง',
      '• สนใจร่วมเป็น Sponsor ของ Estra Launcher กดปุ่ม **ติดต่อสมัคร Partner / Sponsor** ด้านล่างเพื่อเปิด Ticket คุยรายละเอียดกับเจ้าของร้านได้เลย',
    ],
    footer: 'เฉพาะทีมงานและผู้มียศ 💎 Sponsor เท่านั้นที่โพสต์ในห้องนี้ได้',
  });
}

export function buildServerPartnersPanel() {
  return buildZoneGuidePanel({
    author: 'ESTRA SERVER PARTNERS',
    title: '🏙️ โซนเซิร์ฟเวอร์ FiveM พาร์ทเนอร์ (Server Partner)',
    color: 0xf97316,
    includePartnerTicketButton: true,
    descriptionLines: [
      'รวมเซิร์ฟเวอร์ FiveM คุณภาพที่ร่วมเป็นพาร์ทเนอร์กับ **Estra FiveM Launcher**',
      '',
      '• ผู้ดูแลเมืองที่มียศ **🏙️ Server Partner** สามารถโพสต์แนะนำเมือง ระบบเด่น กิจกรรมเปิดเมือง และลิงก์ `cfx.re` ได้ในห้องนี้',
      '• เมืองที่ต้องการเชื่อมระบบ **City Patcher** (ซิงก์แพตช์เมืองตรวจ SHA-256 อัตโนมัติ) หรือสมัคร Server Partner กดปุ่มเปิด Ticket ด้านล่างได้ทันที',
    ],
    footer: 'เฉพาะทีมงานและผู้มียศ 🏙️ Server Partner เท่านั้นที่โพสต์โปรโมทเมืองได้',
  });
}

export function buildFivemPartnersPanel() {
  return buildZoneGuidePanel({
    author: 'FIVEM CREATOR & SHOP PARTNERS',
    title: '🛍️ โซนพาร์ทเนอร์ร้านค้า & สายสร้างงาน FiveM (FiveM Partner)',
    color: ESTRA_THEME.ONLINE,
    includePartnerTicketButton: true,
    descriptionLines: [
      'พื้นที่โปรโมทร้านค้าและครีเอเตอร์พาร์ทเนอร์ที่เกี่ยวข้องกับเกม **FiveM** โดยเฉพาะ',
      '',
      '• 👕 **ร้านรับทำเสื้อผ้า / ทรงผม / EUP** (Clothing, Ped, Skin Pack)',
      '• 🪑 **ร้านรับทำพรอบ & โมเดล (Props / MLO / Vehicles)**',
      '• 💻 **สคริปต์ / UI / งานกราฟิก & บริการดูแลเซิร์ฟเวอร์ FiveM**',
      '',
      'ผู้ที่มียศ **🛍️ FiveM Partner** สามารถลงผลงาน รูปตัวอย่าง และช่องทางติดต่อร้านค้าในห้องนี้ได้เลย สนใจเข้าร่วมพาร์ทเนอร์กดเปิด Ticket ด้านล่าง',
    ],
    footer: 'เฉพาะทีมงานและผู้มียศ 🛍️ FiveM Partner เท่านั้นที่โพสต์ร้านค้าในห้องนี้ได้',
  });
}

export function buildFindCityPanel(guildConfig = {}) {
  const fivemPartnersMention = guildConfig.fivemPartnerChannelId ? `<#${guildConfig.fivemPartnerChannelId}>` : '`🛍️・fivem-partners`';
  const serverPartnersMention = guildConfig.serverPartnerChannelId ? `<#${guildConfig.serverPartnerChannelId}>` : '`🏙️・server-partners`';
  return buildZoneGuidePanel({
    author: 'ESTRA COMMUNITY · FIND A CITY',
    title: '🏙️ โพสต์หาเมือง FiveM เล่น',
    color: ESTRA_THEME.CYAN,
    descriptionLines: [
      'กำลังหาเมืองใหม่ลงเล่น หรือชวนคนมาลองเมืองแนวที่คุณชอบ สามารถโพสต์พูดคุยสอบถามกันในห้องนี้ได้เลย! (ดูเมืองพาร์ทเนอร์ได้ที่ ' + serverPartnersMention + ' และร้านสายแต่งตัวละครที่ ' + fivemPartnersMention + ')',
      '',
      '**ตัวอย่างโพสต์แนะนำ:**',
      '```txt\nแนวเมืองที่อยากเล่น : โรลเพลย์เน้นฟาร์ม / สังคมทำงาน / เซิร์ฟแนวซ้อมไฟท์\nช่วงเวลาที่ออนไลน์ : 19:00 - 01:00 น.\nสิ่งที่มองหาเพิ่มเติม : เมืองลื่น มีแก๊งรับคน หรือเล่นคนเดียวได้สบาย\n```',
    ],
    footer: 'กรุณาโพสต์อย่างสุภาพ งดสแปมลิงก์โฆษณาซ้ำถี่ (Cooldown 10 วินาที/ข้อความ)',
  });
}

export function buildFindFriendsPanel(guildConfig = {}) {
  const codesMention = guildConfig.friendCodesChannelId ? `<#${guildConfig.friendCodesChannelId}>` : '`🆔・friend-codes`';
  return buildZoneGuidePanel({
    author: 'ESTRA COMMUNITY · FIND FRIENDS',
    title: '👥 หาเพื่อน หาแก๊ง หาตี้ลงเมือง FiveM',
    color: ESTRA_THEME.SKY,
    descriptionLines: [
      'อยากหาเพื่อนเล่นด้วยกัน หาแก๊ง หาครอบครัว หรือตี้ทำกิจกรรมในเมือง FiveM พิมพ์แนะนำตัวในห้องนี้ได้เลย',
      '',
      '**ตัวอย่างแนะนำตัวแบบสั้น:**',
      '```txt\nชื่อเล่น / นามแฝง : โอม\nเมืองที่เล่น / กำลังหา : ยังไม่มี / เล่นเมือง ...\nช่วงเวลาว่าง & สไตล์ : สายชิล ฟาร์ม ทำคอนเทนต์\nEstra Friend Code : ESTRA-XXXX (วางเพิ่มได้ที่ ' + codesMention + ')\n```',
    ],
    footer: 'รักษาบรรยากาศที่ดีในการหาเพื่อน และระวังข้อมูลส่วนตัวสำคัญ',
  });
}

export function buildFriendCodesPanel(guildConfig = {}) {
  const dlMention = guildConfig.downloadChannelId ? `<#${guildConfig.downloadChannelId}>` : '`⚡・download-estra`';
  return buildZoneGuidePanel({
    author: 'ESTRA SOCIAL · FRIEND CODES',
    title: '🆔 วางรหัสเพิ่มเพื่อน Estra Launcher (`ESTRA-XXXX`)',
    color: ESTRA_THEME.COBALT,
    descriptionLines: [
      'แชร์ **Estra ID** หรือ **Friend Code (`ESTRA-XXXX`)** ของคุณในห้องนี้เพื่อให้เพื่อนกดแอดในโปรแกรม **Estra FiveM Launcher** เห็นสถานะออนไลน์และกดชวนเข้าเมืองในคลิกเดียว!',
      '',
      '**ยังไม่มีบัญชี Estra? สมัครตรงนี้ได้เลยใน 3 วินาที!**',
      '> 1. พิมพ์คำสั่ง `/register id:ชื่อไอดีที่ต้องการ` (ใช้ `a-z`, `0-9`, `_`, `.`, `-` 3–24 ตัว)',
      '> 2. บอทจะตอบกลับแบบ **เห็นเฉพาะคุณคนเดียว** พร้อมรหัสผ่านครั้งแรก + Friend Code `ESTRA-XXXX` ทันที',
      `> 3. เปิด ${dlMention} เพื่อเข้าสู่ระบบด้วยรหัสครั้งแรก แล้วอย่าลืมเปลี่ยนรหัสผ่านใหม่หลัง Login ครั้งแรกนะครับ`,
    ],
    footer: 'ห้ามแชร์รหัสผ่านของตัวเองลงในห้องสาธารณะทุกกรณี',
  });
}
