import { randomInt } from 'node:crypto';

const PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PW_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PW_DIGIT = '23456789';
const PW_ALL = PW_UPPER + PW_LOWER + PW_DIGIT;

export const USERNAME_REGEX = /^[a-z0-9_.-]{3,24}$/;
export const DISCORD_ID_REGEX = /^\d{15,22}$/;

export function normalizeRegisterUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function validateRegisterInput({ username, discordUserId }) {
  const cleanUsername = normalizeRegisterUsername(username);
  if (!USERNAME_REGEX.test(cleanUsername)) {
    return {
      ok: false,
      status: 400,
      message: 'Estra ID ต้องใช้เฉพาะตัวอักษร `a-z`, ตัวเลข `0-9`, `_`, `.`, `-` และมีความยาว 3–24 ตัวอักษรเท่านั้น',
    };
  }
  const cleanDiscordId = String(discordUserId || '').trim();
  if (!DISCORD_ID_REGEX.test(cleanDiscordId)) {
    return {
      ok: false,
      status: 400,
      message: 'ไม่พบข้อมูล Discord User ID ที่ถูกต้อง',
    };
  }
  return { ok: true, username: cleanUsername, discordUserId: cleanDiscordId };
}

export function generateInitialPassword() {
  const chars = [
    PW_UPPER[randomInt(PW_UPPER.length)],
    PW_LOWER[randomInt(PW_LOWER.length)],
    PW_DIGIT[randomInt(PW_DIGIT.length)],
  ];
  while (chars.length < 12) {
    chars.push(PW_ALL[randomInt(PW_ALL.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

async function postJson(fetchImpl, url, headers, payload, timeoutMs = 20_000) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    return { ok: true, res, data };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      message: isTimeout
        ? 'ระบบฐานข้อมูล Estra ตอบสนองช้าเกินกำหนด กรุณาลอง `/register` ใหม่อีกครั้ง'
        : 'ไม่สามารถเชื่อมต่อระบบฐานข้อมูล Estra ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    };
  }
}

export async function registerAccountViaDiscord(
  { username, displayName, discordUserId },
  config,
  { fetchImpl = fetch } = {},
) {
  const checked = validateRegisterInput({ username, discordUserId });
  if (!checked.ok) return checked;

  if (!config?.botProvisionKey) {
    return {
      ok: false,
      status: 500,
      message: 'ระบบสมัครบัญชีผ่าน Discord ยังไม่ได้ตั้งค่า Provision Key กรุณาแจ้งทีมงาน',
    };
  }

  const cleanDisplayName = String(displayName || checked.username).trim().slice(0, 32) || checked.username;
  const gatewayBase = String(config.socialGatewayUrl || '').replace(/\/+$/, '');
  const supabaseOrigin = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const apikey = String(config.supabasePublishableKey || '');
  const baseHeaders = apikey ? { apikey } : {};

  // Try dedicated v3 Edge Function route first
  const v3Call = await postJson(
    fetchImpl,
    `${gatewayBase}/api/social/discord-register`,
    { ...baseHeaders, 'x-bot-provision-key': config.botProvisionKey },
    {
      username: checked.username,
      displayName: cleanDisplayName,
      discordUserId: checked.discordUserId,
    },
  );
  if (!v3Call.ok) return v3Call;
  const { res: v3Res, data: v3Data } = v3Call;

  if (v3Res.ok && v3Data?.success && v3Data?.account && v3Data?.initialPassword) {
    return {
      ok: true,
      account: v3Data.account,
      initialPassword: v3Data.initialPassword,
      via: 'edge-v3',
    };
  }

  // Edge Function v2 falls through to auth() and returns 401 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' on unknown paths
  const isV2FallbackEligible = v3Res.status === 401
    && typeof v3Data?.error === 'string'
    && v3Data.error.includes('กรุณาเข้าสู่ระบบ');

  if (!isV2FallbackEligible) {
    return {
      ok: false,
      status: v3Res.status,
      code: v3Data?.code,
      message: v3Data?.error || 'สมัครบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    };
  }

  const initialPassword = generateInitialPassword();
  const regCall = await postJson(
    fetchImpl,
    `${gatewayBase}/api/social/register`,
    baseHeaders,
    {
      username: checked.username,
      displayName: cleanDisplayName,
      password: initialPassword,
    },
  );
  if (!regCall.ok) return regCall;
  const { res: regRes, data: regData } = regCall;

  if (!regRes.ok || !regData?.success || !regData?.token) {
    return {
      ok: false,
      status: regRes.status,
      code: regData?.code,
      message: regData?.error || 'สมัครบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    };
  }

  const markCall = await postJson(
    fetchImpl,
    `${supabaseOrigin}/rest/v1/rpc/launcher_discord_provision_mark`,
    { ...baseHeaders, Authorization: `Bearer ${regData.token}` },
    {
      p_provision_key: config.botProvisionKey,
      p_discord_user_id: checked.discordUserId,
    },
  );
  if (!markCall.ok) return markCall;
  const { res: markRes, data: markData } = markCall;

  if (!markRes.ok || !markData?.success) {
    return {
      ok: false,
      status: markRes.status || 500,
      message: markData?.error || 'บันทึกสถานะเปลี่ยนรหัสผ่านครั้งแรกไม่สำเร็จ กรุณาติดต่อทีมงาน',
    };
  }

  return {
    ok: true,
    account: markData.user || { ...regData.user, mustChangePassword: true },
    initialPassword,
    via: 'rpc-provision',
  };
}
