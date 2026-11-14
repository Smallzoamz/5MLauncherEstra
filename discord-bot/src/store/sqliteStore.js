import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class BotStore {
  /**
   * Persistent SQLite store backed by Node's built-in node:sqlite.
   * All state is scoped strictly by guild_id so multiple guilds remain isolated.
   */
  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.#initSchema();
  }

  #initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL DEFAULT '{}',
        ticket_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS panel_messages (
        guild_id TEXT NOT NULL,
        panel_key TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, panel_key)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        ticket_number INTEGER NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        creator_id TEXT NOT NULL,
        category_key TEXT NOT NULL,
        subject TEXT NOT NULL,
        details TEXT NOT NULL,
        claimed_by TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        closed_at TEXT,
        closed_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_guild_creator_status
        ON tickets (guild_id, creator_id, status);

      CREATE TABLE IF NOT EXISTS release_state (
        guild_id TEXT PRIMARY KEY,
        last_announced_tag TEXT,
        last_download_panel_tag TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_rename_guard (
        guild_id TEXT NOT NULL,
        counter_key TEXT NOT NULL,
        last_label TEXT NOT NULL,
        last_renamed_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, counter_key)
      );
    `);
  }

  #now() {
    return new Date().toISOString();
  }

  getGuildConfig(guildId) {
    if (!guildId) return {};
    const row = this.db
      .prepare('SELECT config_json, ticket_seq FROM guild_configs WHERE guild_id = ?')
      .get(String(guildId));
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.config_json);
      return { ...parsed, ticketSeq: row.ticket_seq };
    } catch {
      return { ticketSeq: row.ticket_seq };
    }
  }

  saveGuildConfig(guildId, patch) {
    const id = String(guildId);
    const existing = this.getGuildConfig(id);
    const merged = { ...existing, ...patch };
    delete merged.ticketSeq;
    const now = this.#now();

    this.db.prepare(`
      INSERT INTO guild_configs (guild_id, config_json, ticket_seq, updated_at)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(id, JSON.stringify(merged), now);

    return this.getGuildConfig(id);
  }

  listConfiguredGuildIds() {
    const rows = this.db.prepare('SELECT guild_id FROM guild_configs').all();
    return rows.map(r => r.guild_id);
  }

  getPanelMessage(guildId, panelKey) {
    return this.db
      .prepare('SELECT channel_id AS channelId, message_id AS messageId, updated_at AS updatedAt FROM panel_messages WHERE guild_id = ? AND panel_key = ?')
      .get(String(guildId), String(panelKey)) || null;
  }

  savePanelMessage(guildId, panelKey, channelId, messageId) {
    const now = this.#now();
    this.db.prepare(`
      INSERT INTO panel_messages (guild_id, panel_key, channel_id, message_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, panel_key) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        updated_at = excluded.updated_at
    `).run(String(guildId), String(panelKey), String(channelId), String(messageId), now);
  }

  reserveNextTicketNumber(guildId) {
    const id = String(guildId);
    const now = this.#now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO guild_configs (guild_id, config_json, ticket_seq, updated_at)
        VALUES (?, '{}', 0, ?)
        ON CONFLICT(guild_id) DO NOTHING
      `).run(id, now);

      const row = this.db.prepare(`
        UPDATE guild_configs
        SET ticket_seq = ticket_seq + 1, updated_at = ?
        WHERE guild_id = ?
        RETURNING ticket_seq
      `).get(now, id);

      this.db.exec('COMMIT');
      return Number(row.ticket_seq);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  countOpenTicketsByCreator(guildId, creatorId) {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM tickets WHERE guild_id = ? AND creator_id = ? AND status = 'open'")
      .get(String(guildId), String(creatorId));
    return Number(row?.cnt || 0);
  }

  createTicket({ guildId, ticketNumber, channelId, creatorId, categoryKey, subject, details }) {
    const now = this.#now();
    this.db.prepare(`
      INSERT INTO tickets (
        guild_id, ticket_number, channel_id, creator_id,
        category_key, subject, details, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(
      String(guildId),
      Number(ticketNumber),
      String(channelId),
      String(creatorId),
      String(categoryKey),
      String(subject),
      String(details),
      now,
    );
    return this.getTicketByChannel(channelId);
  }

  getTicketByChannel(channelId) {
    return this.db
      .prepare(`
        SELECT id, guild_id AS guildId, ticket_number AS ticketNumber, channel_id AS channelId,
               creator_id AS creatorId, category_key AS categoryKey, subject, details,
               claimed_by AS claimedBy, status, created_at AS createdAt,
               closed_at AS closedAt, closed_by AS closedBy
        FROM tickets WHERE channel_id = ?
      `)
      .get(String(channelId)) || null;
  }

  claimTicket(channelId, staffUserId) {
    const info = this.db.prepare(`
      UPDATE tickets
      SET claimed_by = ?
      WHERE channel_id = ? AND status = 'open' AND (claimed_by IS NULL OR claimed_by = ?)
    `).run(String(staffUserId), String(channelId), String(staffUserId));
    return {
      updated: info.changes > 0,
      ticket: this.getTicketByChannel(channelId),
    };
  }

  closeTicket(channelId, closedBy) {
    const now = this.#now();
    const info = this.db.prepare(`
      UPDATE tickets
      SET status = 'closed', closed_at = ?, closed_by = ?
      WHERE channel_id = ? AND status = 'open'
    `).run(now, String(closedBy), String(channelId));
    return {
      closed: info.changes > 0,
      ticket: this.getTicketByChannel(channelId),
    };
  }

  getReleaseState(guildId) {
    return this.db
      .prepare(`
        SELECT guild_id AS guildId, last_announced_tag AS lastAnnouncedTag,
               last_download_panel_tag AS lastDownloadPanelTag, updated_at AS updatedAt
        FROM release_state WHERE guild_id = ?
      `)
      .get(String(guildId)) || null;
  }

  saveReleaseState(guildId, patch) {
    const id = String(guildId);
    const existing = this.getReleaseState(id) || {};
    const lastAnnouncedTag = patch.lastAnnouncedTag !== undefined
      ? patch.lastAnnouncedTag
      : (existing.lastAnnouncedTag ?? null);
    const lastDownloadPanelTag = patch.lastDownloadPanelTag !== undefined
      ? patch.lastDownloadPanelTag
      : (existing.lastDownloadPanelTag ?? null);
    const now = this.#now();

    this.db.prepare(`
      INSERT INTO release_state (guild_id, last_announced_tag, last_download_panel_tag, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        last_announced_tag = excluded.last_announced_tag,
        last_download_panel_tag = excluded.last_download_panel_tag,
        updated_at = excluded.updated_at
    `).run(id, lastAnnouncedTag, lastDownloadPanelTag, now);

    return this.getReleaseState(id);
  }

  getTelemetryRenameGuard(guildId, counterKey) {
    return this.db
      .prepare(`
        SELECT last_label AS lastLabel, last_renamed_at AS lastRenamedAt
        FROM telemetry_rename_guard WHERE guild_id = ? AND counter_key = ?
      `)
      .get(String(guildId), String(counterKey)) || null;
  }

  saveTelemetryRenameGuard(guildId, counterKey, label, renamedAt = Date.now()) {
    this.db.prepare(`
      INSERT INTO telemetry_rename_guard (guild_id, counter_key, last_label, last_renamed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, counter_key) DO UPDATE SET
        last_label = excluded.last_label,
        last_renamed_at = excluded.last_renamed_at
    `).run(String(guildId), String(counterKey), String(label), Number(renamedAt));
  }

  close() {
    this.db.close();
  }
}
