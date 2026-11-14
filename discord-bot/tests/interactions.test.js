import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Collection, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { BRAND_ASSETS, ROLE_SPECS } from '../src/config.js';
import { upsertPanelMessage } from '../src/services/setupService.js';
import { getCommandJsonDefinitions } from '../src/commands/index.js';
import {
  buildDownloadPanel,
  buildFaqPanel,
  buildFindCityPanel,
  buildFindFriendsPanel,
  buildFivemPartnersPanel,
  buildFriendCodesPanel,
  buildReleaseAnnouncement,
  buildServerPartnersPanel,
  buildSponsorsPanel,
  buildTicketHubPanel,
  buildTicketWelcomeMessage,
  buildWelcomePanel,
} from '../src/services/panelBuilders.js';
import { createInteractionHandler } from '../src/handlers/interactionCreate.js';
import { BotStore } from '../src/store/sqliteStore.js';

const TEST_CONFIG = {
  token: 'test-token',
  clientId: '1571242974271119432',
  guildId: '1571239076701409451',
  telemetryApiUrl: 'https://estralauncher.vercel.app/api/stats',
  githubRepo: 'Smallzoamz/5MLauncherEstra',
  websiteUrl: 'https://estralauncher.vercel.app/',
  downloadUrl: 'https://estralauncher.vercel.app/api/download?source=discord',
  discordInviteUrl: 'https://discord.gg/WYjfK6FWgB',
  facebookUrl: 'https://www.facebook.com/estralauncher',
  syncIntervalMs: 180_000,
  channelRenameCooldownMs: 660_000,
  maxOpenTicketsPerUser: 2,
};

function makeInteraction(overrides = {}) {
  const replies = [];
  const interaction = {
    guildId: 'guild-1',
    channelId: 'ch-1',
    user: { id: 'user-1', tag: 'user#0001', username: 'user1' },
    member: { id: 'user-1', roles: { cache: new Map() }, permissions: { has: () => false } },
    memberPermissions: { has: () => false },
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    async reply(payload) {
      this.replied = true;
      replies.push({ type: 'reply', payload });
    },
    async deferReply(opts) {
      this.deferred = true;
      replies.push({ type: 'deferReply', payload: opts });
    },
    async editReply(payload) {
      this.replied = true;
      replies.push({ type: 'editReply', payload });
    },
    async showModal(modal) {
      this.replied = true;
      replies.push({ type: 'showModal', payload: modal });
    },
    _replies: replies,
    ...overrides,
  };
  return interaction;
}

test('setup command rejects non-admin user cleanly without side effects', async () => {
  const store = new BotStore(':memory:');
  const handler = createInteractionHandler({ config: TEST_CONFIG, store });

  const interaction = makeInteraction({
    isChatInputCommand: () => true,
    commandName: 'setup',
    guild: { id: 'guild-1' },
    memberPermissions: { has: () => false },
    options: { getSubcommand: () => 'server' },
  });

  await handler(interaction);
  assert.equal(interaction._replies.length, 1);
  assert.equal(interaction._replies[0].type, 'reply');
  assert.equal(interaction._replies[0].payload.flags, MessageFlags.Ephemeral);
  assert.match(interaction._replies[0].payload.content, /Manage Server/);
  store.close();
});

test('FAQ select menu responds ephemerally with selected topic content', async () => {
  const store = new BotStore(':memory:');
  const handler = createInteractionHandler({ config: TEST_CONFIG, store });

  const interaction = makeInteraction({
    isStringSelectMenu: () => true,
    customId: 'faq:topic',
    values: ['preflight'],
  });

  await handler(interaction);
  assert.equal(interaction._replies.length, 1);
  assert.equal(interaction._replies[0].payload.flags, MessageFlags.Ephemeral);
  assert.match(interaction._replies[0].payload.embeds[0].data.title, /Smart Preflight/);
  store.close();
});

test('Ticket open button shows modal below limit and blocks at max open tickets', async () => {
  const store = new BotStore(':memory:');
  const handler = createInteractionHandler({ config: TEST_CONFIG, store });

  const i1 = makeInteraction({ isButton: () => true, customId: 'ticket:open:bug' });
  await handler(i1);
  assert.equal(i1._replies[0].type, 'showModal');
  // Verify serialization of every ticket category modal stays valid
  for (const catKey of ['bug', 'partner', 'idea']) {
    const iCat = makeInteraction({ isButton: () => true, customId: `ticket:open:${catKey}` });
    await handler(iCat);
    assert.equal(iCat._replies[0].type, 'showModal');
    assert.ok(iCat._replies[0].payload.toJSON().title.length <= 45);
  }

  // Create 2 open tickets for user-1
  store.createTicket({
    guildId: 'guild-1', ticketNumber: 1, channelId: 't-1', creatorId: 'user-1',
    categoryKey: 'bug', subject: 'A', details: 'B',
  });
  store.createTicket({
    guildId: 'guild-1', ticketNumber: 2, channelId: 't-2', creatorId: 'user-1',
    categoryKey: 'bug', subject: 'C', details: 'D',
  });

  const i2 = makeInteraction({ isButton: () => true, customId: 'ticket:open:bug' });
  await handler(i2);
  assert.equal(i2._replies[0].type, 'reply');
  assert.equal(i2._replies[0].payload.flags, MessageFlags.Ephemeral);
  assert.match(i2._replies[0].payload.content, /สูงสุด 2 ห้อง/);
  store.close();
});

test('verify:member rejects safely if bot role hierarchy is lower than member role', async () => {
  const store = new BotStore(':memory:');
  store.saveGuildConfig('guild-1', { memberRoleId: 'role-member' });
  const handler = createInteractionHandler({ config: TEST_CONFIG, store });

  const mockRole = { id: 'role-member', name: 'Estra Member' };
  const interaction = makeInteraction({
    isButton: () => true,
    customId: 'verify:member',
    guild: {
      id: 'guild-1',
      roles: { async fetch(id) { return id === 'role-member' ? mockRole : null; } },
      members: {
        async fetchMe() {
          return {
            permissions: { has: flag => flag === PermissionFlagsBits.ManageRoles },
            roles: { highest: { comparePositionTo: () => -1 } },
          };
        },
      },
    },
  });

  await handler(interaction);
  assert.equal(interaction._replies[0].type, 'deferReply');
  assert.match(interaction._replies[1].payload, /ยศบอทอยู่ต่ำกว่า/);
  store.close();
});

test('ticket:claim and ticket:close enforce cross-guild isolation and actor permissions', async () => {
  const store = new BotStore(':memory:');
  store.saveGuildConfig('guild-1', { staffRoleId: 'staff-role' });
  store.createTicket({
    guildId: 'guild-1', ticketNumber: 1, channelId: 'ch-ticket-1', creatorId: 'owner-user',
    categoryKey: 'bug', subject: 'Bug', details: 'Details',
  });
  const handler = createInteractionHandler({ config: TEST_CONFIG, store });

  // Non-staff user tries to claim -> denied
  const claimDenied = makeInteraction({
    isButton: () => true,
    customId: 'ticket:claim',
    guildId: 'guild-1',
    channelId: 'ch-ticket-1',
    user: { id: 'owner-user' },
    member: { id: 'owner-user', permissions: { has: () => false }, roles: { cache: new Map() } },
  });
  await handler(claimDenied);
  assert.match(claimDenied._replies[1].payload, /สำหรับทีมงาน/);

  // Unrelated non-staff user tries to close -> denied
  const closeDenied = makeInteraction({
    isButton: () => true,
    customId: 'ticket:close',
    guildId: 'guild-1',
    channelId: 'ch-ticket-1',
    user: { id: 'intruder-user' },
    member: { id: 'intruder-user', permissions: { has: () => false }, roles: { cache: new Map() } },
  });
  await handler(closeDenied);
  assert.match(closeDenied._replies[1].payload, /เฉพาะเจ้าของ Ticket หรือทีมงาน/);

  // Cross-guild attempt -> denied
  const crossGuild = makeInteraction({
    isButton: () => true,
    customId: 'ticket:close',
    guildId: 'other-guild',
    channelId: 'ch-ticket-1',
    user: { id: 'owner-user' },
    member: { id: 'owner-user', permissions: { has: () => true }, roles: { cache: new Map() } },
  });
  await handler(crossGuild);
  assert.match(crossGuild._replies[1].payload, /ไม่ใช่ Ticket/);

  store.close();
});

test('all slash commands, roles, and panels serialize cleanly within Discord limits', () => {
  assert.equal(ROLE_SPECS[0].key, 'ownerRoleId');
  assert.equal(ROLE_SPECS[0].hoist, true);
  assert.equal(ROLE_SPECS[0].assignToOwner, true);
  const hoistedKeys = ROLE_SPECS.filter(r => r.hoist).map(r => r.key);
  assert.deepEqual(hoistedKeys, [
    'ownerRoleId',
    'staffRoleId',
    'sponsorRoleId',
    'partnerRoleId',
    'fivemPartnerRoleId',
    'supporterRoleId',
  ]);

  const cmds = getCommandJsonDefinitions();
  assert.equal(cmds.length, 7);
  assert.ok(cmds.some(c => c.name === 'register'));
  for (const c of cmds) {
    assert.ok(c.name.length >= 1 && c.name.length <= 32);
    assert.ok(c.description.length >= 1 && c.description.length <= 100);
  }

  const sampleTelemetry = {
    source: 'estra-telemetry',
    users: { total: 10, online: 3, inGame: 1, active24h: 8 },
    downloads: { total: 42, githubVerified: 40, webDirect: 2 },
    latest: {
      version: '2.1.7',
      tag: 'v2.1.7',
      publishedAt: '2026-11-14T19:21:57Z',
      notes: 'Bug fixes & stability',
      assetName: 'Estra.FiveM.Launcher_2.1.7_x64-setup.exe',
      size: 7292565,
      sha256: '6be81d4278f91c13ec94f6e505cdb662c568059d41470708fab29a8132e7d02b',
    },
    releases: [],
    syncedAt: '2026-11-14T19:23:36Z',
  };

  const panels = [
    buildWelcomePanel(TEST_CONFIG, { downloadChannelId: '1', faqChannelId: '2', ticketHubChannelId: '3', friendCodesChannelId: '4' }),
    buildDownloadPanel(TEST_CONFIG, sampleTelemetry),
    buildReleaseAnnouncement(TEST_CONFIG, sampleTelemetry, { rolePingId: '999' }),
    buildFaqPanel(TEST_CONFIG),
    buildTicketHubPanel(),
    buildSponsorsPanel(),
    buildServerPartnersPanel(),
    buildFivemPartnersPanel(),
    buildFindCityPanel({ serverPartnerChannelId: '5', fivemPartnerChannelId: '6' }),
    buildFindFriendsPanel({ friendCodesChannelId: '4' }),
    buildFriendCodesPanel({ downloadChannelId: '1' }),
    buildTicketWelcomeMessage({
      ticketNumber: 1,
      categoryKey: 'bug',
      creatorId: '123',
      subject: 'Test subject',
      details: 'Test details',
    }),
  ];

  for (const p of panels) {
    for (const emb of p.embeds) {
      const json = emb.toJSON();
      assert.ok((json.title || '').length <= 256);
      assert.ok((json.description || '').length <= 4096);
    }
    for (const row of p.components) {
      row.toJSON();
    }
  }
});

test('BRAND_ASSETS resolve locally and upsertPanelMessage recovers panels when SQLite starts blank', async () => {
  assert.equal(fs.existsSync(BRAND_ASSETS.bannerPath), true);
  assert.equal(fs.existsSync(BRAND_ASSETS.markPath), true);
  assert.match(BRAND_ASSETS.bannerPath.replace(/\\/g, '/'), /discord-bot\/assets\/og-banner\.png$/);
  assert.match(BRAND_ASSETS.markPath.replace(/\\/g, '/'), /discord-bot\/assets\/estra-mark\.png$/);

  const store = new BotStore(':memory:');
  let sentCount = 0;
  let editedPayload = null;
  const existingMsg = {
    id: 'msg-existing-1',
    author: { id: 'bot-user-1' },
    embeds: [{ title: '💎 โซนผู้สนับสนุนอย่างเป็นทางการ (Sponsor)' }],
    async edit(payload) {
      editedPayload = payload;
      return { id: 'msg-existing-1' };
    },
  };
  const channel = {
    id: 'ch-sponsors',
    isTextBased: () => true,
    messages: {
      fetch: async () => new Collection([['msg-existing-1', existingMsg]]),
    },
    async send() {
      sentCount += 1;
      return { id: 'msg-duplicate' };
    },
  };
  const guild = {
    id: 'guild-1',
    client: { user: { id: 'bot-user-1' } },
    channels: { fetch: async id => (id === 'ch-sponsors' ? channel : null) },
  };

  const result = await upsertPanelMessage(guild, store, 'sponsors', 'ch-sponsors', buildSponsorsPanel());
  assert.equal(result.action, 'updated');
  assert.equal(result.messageId, 'msg-existing-1');
  assert.equal(sentCount, 0);
  assert.ok(editedPayload);
  assert.equal(store.getPanelMessage('guild-1', 'sponsors').messageId, 'msg-existing-1');
  store.close();
});
