import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import { execute as executeRegister } from '../src/commands/register.js';
import {
  generateInitialPassword,
  registerAccountViaDiscord,
  validateRegisterInput,
} from '../src/services/accountService.js';
import { BotStore } from '../src/store/sqliteStore.js';

const BASE_CONFIG = {
  socialGatewayUrl: 'https://hcynletyqztbbouwlcsg.supabase.co/functions/v1/social-gateway',
  supabaseUrl: 'https://hcynletyqztbbouwlcsg.supabase.co',
  supabasePublishableKey: 'sb_publishable_test',
  botProvisionKey: 'estra_bot_secret_key',
};

test('validateRegisterInput and generateInitialPassword enforce account security constraints', () => {
  assert.equal(validateRegisterInput({ username: 'AB', discordUserId: '956866340474478642' }).ok, false);
  assert.equal(validateRegisterInput({ username: 'bad space!', discordUserId: '956866340474478642' }).ok, false);
  const valid = validateRegisterInput({ username: '  OHM_Estra.01  ', discordUserId: '956866340474478642' });
  assert.equal(valid.ok, true);
  assert.equal(valid.username, 'ohm_estra.01');

  for (let i = 0; i < 20; i += 1) {
    const pw = generateInitialPassword();
    assert.match(pw, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[2-9]/);
    assert.equal(/[0O1lI]/.test(pw), false);
  }
});

test('registerAccountViaDiscord handles v3 route, v2 register+RPC fallback, and conflict errors', async () => {
  // 1) Edge Function v3 path
  const v3Res = await registerAccountViaDiscord(
    { username: 'player_v3', displayName: 'Player V3', discordUserId: '956866340474478642' },
    BASE_CONFIG,
    {
      fetchImpl: async (url, init) => {
        assert.match(url, /\/api\/social\/discord-register$/);
        assert.equal(init.headers['x-bot-provision-key'], 'estra_bot_secret_key');
        return new Response(
          JSON.stringify({
            success: true,
            account: {
              id: 'u-1',
              username: 'player_v3',
              displayName: 'Player V3',
              friendCode: 'ESTRA-AB12',
              mustChangePassword: true,
            },
            initialPassword: 'Km7P-9xRq-4TnW',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  );
  assert.equal(v3Res.ok, true);
  assert.equal(v3Res.via, 'edge-v3');
  assert.equal(v3Res.initialPassword, 'Km7P-9xRq-4TnW');

  // 2) Edge Function v2 fallback path (/register + RPC launcher_discord_provision_mark)
  const calls = [];
  const v2Res = await registerAccountViaDiscord(
    { username: 'Player_V2', displayName: 'Player V2', discordUserId: '956866340474478642' },
    BASE_CONFIG,
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        if (url.endsWith('/api/social/discord-register')) {
          return new Response(
            JSON.stringify({ success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith('/api/social/register')) {
          return new Response(
            JSON.stringify({
              success: true,
              authenticated: true,
              token: 'ephemeral-jwt',
              user: { id: 'u-2', username: 'player_v2', displayName: 'Player V2', friendCode: 'ESTRA-CD34' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith('/rest/v1/rpc/launcher_discord_provision_mark')) {
          assert.equal(init.headers.Authorization, 'Bearer ephemeral-jwt');
          return new Response(
            JSON.stringify({
              success: true,
              user: {
                id: 'u-2',
                username: 'player_v2',
                displayName: 'Player V2',
                friendCode: 'ESTRA-CD34',
                mustChangePassword: true,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    },
  );
  assert.equal(v2Res.ok, true);
  assert.equal(v2Res.via, 'rpc-provision');
  assert.equal(v2Res.account.username, 'player_v2');
  assert.equal(v2Res.account.mustChangePassword, true);
  assert.equal(v2Res.account.friendCode, 'ESTRA-CD34');
  assert.equal(calls.length, 3);
  assert.equal('token' in v2Res, false);

  // 3) Duplicate username rejection
  const conflictRes = await registerAccountViaDiscord(
    { username: 'taken_user', displayName: 'Taken', discordUserId: '956866340474478642' },
    BASE_CONFIG,
    {
      fetchImpl: async () => new Response(
        JSON.stringify({ success: false, error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    },
  );
  assert.equal(conflictRes.ok, false);
  assert.equal(conflictRes.status, 409);

  // 4) Timeout / upstream lag handling returns clean 504 without throwing
  const timeoutRes = await registerAccountViaDiscord(
    { username: 'slow_user', displayName: 'Slow', discordUserId: '956866340474478642' },
    BASE_CONFIG,
    {
      fetchImpl: async () => {
        const err = new Error('aborted');
        err.name = 'TimeoutError';
        throw err;
      },
    },
  );
  assert.equal(timeoutRes.ok, false);
  assert.equal(timeoutRes.status, 504);
  assert.match(timeoutRes.message, /ช้าเกินกำหนด/);
});

test('/register slash command replies ephemerally with password & warning and keeps bot logs clean of secrets', async t => {
  const origFetch = global.fetch;
  t.after(() => {
    global.fetch = origFetch;
  });

  global.fetch = async () => new Response(
    JSON.stringify({
      success: true,
      account: {
        id: 'u-live',
        username: 'ohm_tester',
        displayName: 'OHM',
        friendCode: 'ESTRA-XY89',
        mustChangePassword: true,
      },
      initialPassword: 'Temp-9AbC-4DeF',
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );

  const store = new BotStore(':memory:');
  t.after(() => store.close());
  store.saveGuildConfig('guild-1', {
    logChannelId: 'log-ch-1',
    friendCodesChannelId: 'fc-ch-1',
    downloadChannelId: 'dl-ch-1',
  });

  const sentLogs = [];
  const replies = [];
  const interaction = {
    guildId: 'guild-1',
    guild: {
      channels: {
        fetch: async id => (id === 'log-ch-1'
          ? {
              isTextBased: () => true,
              send: async payload => { sentLogs.push(payload); },
            }
          : null),
      },
    },
    user: { id: '956866340474478642', globalName: 'OHM', username: 'ohmphieng_' },
    member: { displayName: 'OHM' },
    options: {
      getString: name => (name === 'id' ? 'ohm_tester' : null),
    },
    async deferReply(opts) {
      replies.push({ type: 'deferReply', opts });
    },
    async editReply(payload) {
      replies.push({ type: 'editReply', payload });
    },
  };

  await executeRegister(interaction, { store, config: BASE_CONFIG });
  assert.equal(replies[0].type, 'deferReply');
  assert.equal(replies[0].opts.flags, MessageFlags.Ephemeral);

  const embedJson = replies[1].payload.embeds[0].toJSON();
  assert.match(embedJson.description, /เห็นได้เฉพาะคุณคนเดียว/);
  assert.match(embedJson.description, /ohm_tester/);
  assert.match(embedJson.description, /Temp-9AbC-4DeF/);
  assert.match(embedJson.description, /ESTRA-XY89/);
  assert.match(embedJson.description, /เปลี่ยนรหัสผ่านทันทีหลัง Login ครั้งแรก/);

  assert.equal(sentLogs.length, 1);
  const logDesc = sentLogs[0].embeds[0].toJSON().description;
  assert.match(logDesc, /ohm_tester/);
  assert.equal(logDesc.includes('Temp-9AbC-4DeF'), false);
});
