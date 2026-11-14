import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BotStore } from '../src/store/sqliteStore.js';

test('BotStore persists across restarts and isolates guilds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estra-bot-test-'));
  const dbFile = path.join(dir, 'state.sqlite');

  const store1 = new BotStore(dbFile);
  store1.saveGuildConfig('111111111111111111', { memberRoleId: '222', downloadChannelId: '333' });
  store1.saveGuildConfig('999999999999999999', { memberRoleId: '888' });
  store1.savePanelMessage('111111111111111111', 'download', '333', '444');
  store1.saveReleaseState('111111111111111111', { lastAnnouncedTag: 'v2.1.7' });
  const seq1 = store1.reserveNextTicketNumber('111111111111111111');
  const seq2 = store1.reserveNextTicketNumber('111111111111111111');
  assert.equal(seq1, 1);
  assert.equal(seq2, 2);
  store1.close();

  const store2 = new BotStore(dbFile);
  try {
    const g1 = store2.getGuildConfig('111111111111111111');
    const g2 = store2.getGuildConfig('999999999999999999');
    assert.equal(g1.memberRoleId, '222');
    assert.equal(g1.ticketSeq, 2);
    assert.equal(g2.memberRoleId, '888');
    assert.equal(g2.downloadChannelId, undefined);
    assert.deepEqual(store2.getPanelMessage('111111111111111111', 'download')?.messageId, '444');
    assert.equal(store2.getReleaseState('111111111111111111')?.lastAnnouncedTag, 'v2.1.7');
    assert.equal(store2.getReleaseState('999999999999999999'), null);
  } finally {
    store2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Ticket claim and close enforce single claimant and idempotent closure', () => {
  const store = new BotStore(':memory:');
  try {
    const num = store.reserveNextTicketNumber('g1');
    store.createTicket({
      guildId: 'g1',
      ticketNumber: num,
      channelId: 'ch-101',
      creatorId: 'user-1',
      categoryKey: 'bug',
      subject: 'Splash screen issue',
      details: 'Stuck at 80%',
    });

    assert.equal(store.countOpenTicketsByCreator('g1', 'user-1'), 1);
    assert.equal(store.countOpenTicketsByCreator('g2', 'user-1'), 0);

    const claim1 = store.claimTicket('ch-101', 'staff-1');
    assert.equal(claim1.updated, true);
    assert.equal(claim1.ticket.claimedBy, 'staff-1');

    // Second staff cannot overwrite existing claim
    const claim2 = store.claimTicket('ch-101', 'staff-2');
    assert.equal(claim2.updated, false);
    assert.equal(claim2.ticket.claimedBy, 'staff-1');

    const close1 = store.closeTicket('ch-101', 'staff-1');
    assert.equal(close1.closed, true);
    assert.equal(close1.ticket.status, 'closed');
    assert.equal(store.countOpenTicketsByCreator('g1', 'user-1'), 0);

    // Re-closing does nothing
    const close2 = store.closeTicket('ch-101', 'staff-1');
    assert.equal(close2.closed, false);
  } finally {
    store.close();
  }
});
