import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const BOT_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(BOT_ROOT, '..');

export const ESTRA_THEME = {
  COBALT: 0x2b6bf3,
  CYAN: 0x00a8ff,
  SKY: 0x7db4ff,
  SURFACE: 0x0e1629,
  ONLINE: 0x22c55e,
  WARN: 0xf59e0b,
  ERROR: 0xef4444,
};

function resolveBrandAsset(localRelPath, repoFallbackRelPath) {
  const localPath = path.resolve(BOT_ROOT, localRelPath);
  if (fs.existsSync(localPath)) return localPath;
  return path.resolve(REPO_ROOT, repoFallbackRelPath);
}

export const BRAND_ASSETS = {
  bannerPath: resolveBrandAsset('assets/og-banner.png', 'website/public/brand/og-banner.png'),
  markPath: resolveBrandAsset('assets/estra-mark.png', 'public/brand/estra-mark.png'),
};

export const ROLE_SPECS = [
  {
    key: 'ownerRoleId',
    name: '👑 เจ้าของร้าน',
    previousNames: ['Owner', 'Estra Owner'],
    color: 0xfbbf24,
    hoist: true,
    mentionable: false,
    permissions: ['Administrator'],
    assignToOwner: true,
  },
  {
    key: 'staffRoleId',
    name: 'Estra Team',
    color: ESTRA_THEME.COBALT,
    hoist: true,
    mentionable: false,
    permissions: ['ManageMessages', 'ManageThreads', 'KickMembers', 'ModerateMembers'],
  },
  {
    key: 'sponsorRoleId',
    name: '💎 Sponsor',
    previousNames: ['Sponsor'],
    color: 0x38bdf8,
    hoist: true,
    mentionable: false,
    permissions: [],
  },
  {
    key: 'partnerRoleId',
    name: '🏙️ Server Partner',
    previousNames: ['City Partner', 'Server Partner'],
    color: 0xf97316,
    hoist: true,
    mentionable: false,
    permissions: [],
  },
  {
    key: 'fivemPartnerRoleId',
    name: '🛍️ FiveM Partner',
    previousNames: ['FiveM Partner'],
    color: ESTRA_THEME.ONLINE,
    hoist: true,
    mentionable: false,
    permissions: [],
  },
  {
    key: 'supporterRoleId',
    name: 'Supporter',
    color: ESTRA_THEME.CYAN,
    hoist: true,
    mentionable: false,
    permissions: [],
  },
  {
    key: 'releasePingRoleId',
    name: 'Release Ping',
    color: ESTRA_THEME.SKY,
    hoist: false,
    mentionable: false,
    permissions: [],
  },
  {
    key: 'memberRoleId',
    name: 'Estra Member',
    color: ESTRA_THEME.ONLINE,
    hoist: false,
    mentionable: false,
    permissions: [],
  },
];

export const SETUP_NAMES = {
  categories: {
    telemetry: '📊・LIVE TELEMETRY',
    startHere: '🧭・START HERE',
    partners: '🤝・PARTNERS & SPONSORS',
    community: '💬・COMMUNITY',
    support: '🎫・SUPPORT',
    tickets: '🔒・ACTIVE TICKETS',
    staff: '🛡️・STAFF & LOGS',
  },
  channels: {
    statsOnline: '🟢 ออนไลน์: — | ในเมือง: —',
    statsDownloads: '⬇️ ดาวน์โหลด: — ครั้ง',
    welcome: '✦・welcome-rules',
    download: '⚡・download-estra',
    updates: '🚀・updates-changelog',
    faq: '❓・faq-howto',
    sponsors: '💎・sponsors',
    serverPartners: '🏙️・server-partners',
    fivemPartners: '🛍️・fivem-partners',
    general: '💬・general-chat',
    showcase: '📸・showcase-feedback',
    findCity: '🏙️・find-city',
    findFriends: '👥・find-friends',
    friendCodes: '🆔・friend-codes',
    voice: '🔊・Estra Voice',
    ticketHub: '🎫・open-ticket',
    botLogs: '📋・bot-logs',
  },
};

function parsePositiveInt(raw, fallback) {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : fallback;
}

function validateUrl(raw, fallback) {
  const value = String(raw || fallback || '').trim();
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {
    // ignore invalid URL and fall back
  }
  return fallback;
}

export function loadConfig(env = process.env, { requireToken = true, loadDotEnv = true } = {}) {
  if (loadDotEnv) {
    const envPath = path.join(BOT_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
    }
  }

  const token = String(env.DISCORD_TOKEN || '').trim();
  const clientId = String(env.DISCORD_CLIENT_ID || '').trim();
  const clientSecret = String(env.DISCORD_CLIENT_SECRET || '').trim();
  const guildId = String(env.DISCORD_GUILD_ID || '').trim();

  if (requireToken && !token) {
    throw new Error('Missing DISCORD_TOKEN environment variable (check discord-bot/.env).');
  }
  if (requireToken && !/^\d{17,21}$/.test(clientId)) {
    throw new Error('Missing or invalid DISCORD_CLIENT_ID environment variable.');
  }
  if (guildId && !/^\d{17,21}$/.test(guildId)) {
    throw new Error('Invalid DISCORD_GUILD_ID format; expected Discord snowflake ID.');
  }

  const sqliteRaw = String(env.SQLITE_PATH || './data/estra-bot.sqlite').trim();
  const sqlitePath = sqliteRaw === ':memory:'
    ? ':memory:'
    : path.isAbsolute(sqliteRaw)
      ? sqliteRaw
      : path.resolve(BOT_ROOT, sqliteRaw);

  const githubRepo = String(env.GITHUB_REPO || 'Smallzoamz/5MLauncherEstra').trim();
  const socialGatewayUrl = validateUrl(
    env.ESTRA_SOCIAL_GATEWAY_URL,
    'https://hcynletyqztbbouwlcsg.supabase.co/functions/v1/social-gateway',
  );
  let supabaseUrl = 'https://hcynletyqztbbouwlcsg.supabase.co';
  try {
    supabaseUrl = new URL(socialGatewayUrl).origin;
  } catch {
    // keep default
  }

  return {
    token,
    clientId,
    clientSecret,
    guildId,
    sqlitePath,
    socialGatewayUrl: socialGatewayUrl.replace(/\/+$/, ''),
    supabaseUrl,
    supabasePublishableKey: String(
      env.ESTRA_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_puj9yz5BQ_i3DEmhnpgmww_4fifPu5e',
    ).trim(),
    botProvisionKey: String(env.ESTRA_BOT_PROVISION_KEY || '').trim(),
    telemetryApiUrl: validateUrl(env.TELEMETRY_API_URL, 'https://estralauncher.vercel.app/api/stats'),
    githubRepo: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)
      ? githubRepo
      : 'Smallzoamz/5MLauncherEstra',
    websiteUrl: validateUrl(env.WEBSITE_URL, 'https://estralauncher.vercel.app/'),
    downloadUrl: validateUrl(env.DOWNLOAD_URL, 'https://estralauncher.vercel.app/api/download?source=discord'),
    discordInviteUrl: validateUrl(env.DISCORD_INVITE_URL, 'https://discord.gg/WYjfK6FWgB'),
    facebookUrl: validateUrl(env.FACEBOOK_URL, 'https://www.facebook.com/estralauncher'),
    syncIntervalMs: Math.max(60_000, parsePositiveInt(env.SYNC_INTERVAL_MS, 180_000)),
    channelRenameCooldownMs: Math.max(600_000, parsePositiveInt(env.CHANNEL_RENAME_COOLDOWN_MS, 660_000)),
    maxOpenTicketsPerUser: Math.min(5, parsePositiveInt(env.MAX_OPEN_TICKETS_PER_USER, 2)),
  };
}
