import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ONLINE_WINDOW_MS = 45_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_STATUS_PREFS = new Set(['online', 'away', 'invisible', 'offline']);
const AVATAR_PALETTE = ['#2b6bf3', '#0ea5e9', '#6366f1', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899'];

export function defaultSocialDbPath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.estra-launcher');
  return path.join(base, 'EstraFiveMLauncher', 'social.db');
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(username) {
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
    throw Object.assign(new Error('ชื่อผู้ใช้ต้องยาว 3-24 ตัวอักษร (a-z, 0-9, _, ., -)'), { status: 400 });
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw Object.assign(new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร (สูงสุด 128 ตัวอักษร)'), { status: 400 });
  }
}

function validateDisplayName(displayName, fallback) {
  const cleaned = String(displayName ?? fallback ?? '').trim();
  if (!cleaned || cleaned.length > 40) {
    throw Object.assign(new Error('ชื่อที่แสดงต้องยาว 1-40 ตัวอักษร'), { status: 400 });
  }
  return cleaned;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function randomFriendCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[crypto.randomInt(chars.length)];
  }
  return `ESTRA-${suffix}`;
}

function computePresence(row, now = Date.now()) {
  if (row.is_demo) {
    if (row.status_pref === 'offline' || row.status_pref === 'away') return row.status_pref;
    return row.current_server_name ? 'in-game' : 'online';
  }
  if (row.status_pref === 'offline' || row.status_pref === 'invisible') return 'offline';
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (!Number.isFinite(lastSeen) || now - lastSeen > ONLINE_WINDOW_MS) return 'offline';
  if (row.status_pref === 'away') return 'away';
  if (row.current_server_name) return 'in-game';
  return 'online';
}

function toPublicUser(row, now = Date.now(), includePrivate = false) {
  if (!row) return null;
  const presence = computePresence(row, now);
  const user = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    friendCode: row.friend_code,
    avatarColor: row.avatar_color,
    presence,
    isDemo: !!row.is_demo,
    lastSeenAt: row.last_seen_at || null,
    currentServer: presence !== 'offline' && row.current_server_name ? {
      id: row.current_server_id || '',
      name: row.current_server_name,
      ip: row.current_server_ip || ''
    } : null
  };
  if (includePrivate) {
    user.statusPref = row.status_pref || 'online';
  }
  return user;
}

export function createSocialStore(options = {}) {
  const dbPath = options.dbPath || defaultSocialDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      friend_code TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      status_pref TEXT NOT NULL DEFAULT 'online',
      is_demo INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      current_server_id TEXT,
      current_server_name TEXT,
      current_server_ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, friend_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_user_id, status);
    CREATE TABLE IF NOT EXISTS favorite_servers (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      server_ip TEXT NOT NULL,
      server_tag TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, server_id)
    );
    CREATE TABLE IF NOT EXISTS game_invites (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      server_ip TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_invites_to ON game_invites(to_user_id, status, expires_at);
  `);

  function createSessionForUser(userId) {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), userId, now + SESSION_TTL_MS, new Date(now).toISOString());
    return token;
  }

  function getUserFavoriteServers(userId) {
    return db.prepare(
      'SELECT server_id AS id, server_name AS name, server_ip AS ip, server_tag AS tag, created_at AS createdAt FROM favorite_servers WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId);
  }

  function resolveSession(token) {
    if (!token || typeof token !== 'string') return null;
    const now = Date.now();
    const row = db.prepare(`
      SELECT u.* FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), now);
    if (!row) return null;
    return {
      user: toPublicUser(row, now, true),
      favoriteServers: getUserFavoriteServers(row.id)
    };
  }

  function register({ username, password, displayName }) {
    const cleanUsername = normalizeUsername(username);
    validateUsername(cleanUsername);
    validatePassword(password);
    const cleanDisplay = validateDisplayName(displayName, cleanUsername);
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      throw Object.assign(new Error('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว'), { status: 409 });
    }
    let friendCode = randomFriendCode();
    while (db.prepare('SELECT id FROM users WHERE friend_code = ?').get(friendCode)) {
      friendCode = randomFriendCode();
    }
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const color = AVATAR_PALETTE[crypto.randomInt(AVATAR_PALETTE.length)];
    db.prepare(`
      INSERT INTO users (id, username, display_name, friend_code, password_hash, avatar_color, status_pref, is_demo, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'online', 0, ?, ?)
    `).run(id, cleanUsername, cleanDisplay, friendCode, hashPassword(password), color, nowIso, nowIso);

    const token = createSessionForUser(id);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return {
      token,
      user: toPublicUser(row, Date.now(), true),
      favoriteServers: []
    };
  }

  function login({ username, password }) {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername || typeof password !== 'string') {
      throw Object.assign(new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'), { status: 400 });
    }
    const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_demo = 0').get(cleanUsername);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw Object.assign(new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'), { status: 401 });
    }
    const nowIso = new Date().toISOString();
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso, row.id);
    const token = createSessionForUser(row.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    return {
      token,
      user: toPublicUser(updated, Date.now(), true),
      favoriteServers: getUserFavoriteServers(row.id)
    };
  }

  function logout(token) {
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    return { success: true };
  }

  function updateHeartbeat(userId, payload = {}) {
    const nowIso = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!existing) throw Object.assign(new Error('ไม่พบบัญชีผู้ใช้'), { status: 404 });

    let nextPref = existing.status_pref;
    if (payload.statusPref !== undefined) {
      if (!VALID_STATUS_PREFS.has(payload.statusPref)) {
        throw Object.assign(new Error('สถานะออนไลน์ไม่ถูกต้อง'), { status: 400 });
      }
      nextPref = payload.statusPref;
    }

    const displayName = payload.displayName !== undefined
      ? validateDisplayName(payload.displayName, existing.display_name)
      : existing.display_name;

    const server = payload.activeServer;
    const srvId = server && typeof server.id === 'string' ? server.id.slice(0, 100) : '';
    const srvName = server && typeof server.name === 'string' ? server.name.trim().slice(0, 100) : '';
    const srvIp = server && typeof server.ip === 'string' ? server.ip.trim().slice(0, 253) : '';

    db.prepare(`
      UPDATE users
      SET status_pref = ?, display_name = ?, last_seen_at = ?,
          current_server_id = ?, current_server_name = ?, current_server_ip = ?
      WHERE id = ?
    `).run(nextPref, displayName, nowIso, srvId || null, srvName || null, srvIp || null, userId);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return { user: toPublicUser(updated, Date.now(), true) };
  }

  function getSocialState(userId) {
    const now = Date.now();
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!userRow) throw Object.assign(new Error('ไม่พบบัญชีผู้ใช้'), { status: 404 });

    const friendRows = db.prepare(`
      SELECT u.*, f.is_favorite
      FROM friendships f
      JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ?
    `).all(userId);

    const friends = friendRows.map(row => ({
      ...toPublicUser(row, now, false),
      isFavorite: !!row.is_favorite
    })).sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      const rank = p => (p === 'in-game' ? 0 : p === 'online' ? 1 : p === 'away' ? 2 : 3);
      if (rank(a.presence) !== rank(b.presence)) return rank(a.presence) - rank(b.presence);
      return a.displayName.localeCompare(b.displayName, 'th');
    });

    const incomingRows = db.prepare(`
      SELECT fr.id AS request_id, fr.created_at AS requested_at, u.*
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(userId);

    const outgoingRows = db.prepare(`
      SELECT fr.id AS request_id, fr.created_at AS requested_at, u.*
      FROM friend_requests fr
      JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(userId);

    const incomingInviteRows = db.prepare(`
      SELECT gi.id AS invite_id, gi.server_id, gi.server_name, gi.server_ip, gi.created_at AS invite_created_at, gi.expires_at, u.*
      FROM game_invites gi
      JOIN users u ON u.id = gi.from_user_id
      WHERE gi.to_user_id = ? AND gi.status = 'pending' AND gi.expires_at > ?
      ORDER BY gi.created_at DESC
    `).all(userId, now);

    const outgoingInviteRows = db.prepare(`
      SELECT gi.id AS invite_id, gi.server_id, gi.server_name, gi.server_ip, gi.created_at AS invite_created_at, gi.expires_at, u.*
      FROM game_invites gi
      JOIN users u ON u.id = gi.to_user_id
      WHERE gi.from_user_id = ? AND gi.status = 'pending' AND gi.expires_at > ?
      ORDER BY gi.created_at DESC
    `).all(userId, now);

    return {
      user: toPublicUser(userRow, now, true),
      favoriteServers: getUserFavoriteServers(userId),
      friends,
      incomingRequests: incomingRows.map(r => ({
        id: r.request_id,
        createdAt: r.requested_at,
        user: toPublicUser(r, now, false)
      })),
      outgoingRequests: outgoingRows.map(r => ({
        id: r.request_id,
        createdAt: r.requested_at,
        user: toPublicUser(r, now, false)
      })),
      incomingInvites: incomingInviteRows.map(r => ({
        id: r.invite_id,
        createdAt: r.invite_created_at,
        expiresAt: new Date(r.expires_at).toISOString(),
        server: { id: r.server_id, name: r.server_name, ip: r.server_ip },
        fromUser: toPublicUser(r, now, false)
      })),
      outgoingInvites: outgoingInviteRows.map(r => ({
        id: r.invite_id,
        createdAt: r.invite_created_at,
        expiresAt: new Date(r.expires_at).toISOString(),
        server: { id: r.server_id, name: r.server_name, ip: r.server_ip },
        toUser: toPublicUser(r, now, false)
      }))
    };
  }

  function createFriendshipPair(userA, userB) {
    const nowIso = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO friendships (id, user_id, friend_id, is_favorite, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(crypto.randomUUID(), userA, userB, nowIso);
    db.prepare('INSERT OR IGNORE INTO friendships (id, user_id, friend_id, is_favorite, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(crypto.randomUUID(), userB, userA, nowIso);
  }

  function sendFriendRequest(userId, target) {
    const query = String(target || '').trim();
    if (!query) throw Object.assign(new Error('กรุณาระบุชื่อผู้ใช้หรือรหัสเพื่อน (เช่น ESTRA-XXXX)'), { status: 400 });

    const targetUser = db.prepare(
      'SELECT * FROM users WHERE username = ? OR UPPER(friend_code) = UPPER(?)'
    ).get(query.toLowerCase(), query);

    if (!targetUser) {
      throw Object.assign(new Error('ไม่พบบัญชีผู้ใช้นี้ กรุณาตรวจสอบ Username หรือ Friend Code'), { status: 404 });
    }
    if (targetUser.id === userId) {
      throw Object.assign(new Error('ไม่สามารถเพิ่มตัวเองเป็นเพื่อนได้'), { status: 400 });
    }
    const existingFriend = db.prepare('SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?').get(userId, targetUser.id);
    if (existingFriend) {
      throw Object.assign(new Error(`${targetUser.display_name} เป็นเพื่อนของคุณอยู่แล้ว`), { status: 409 });
    }
    const alreadySent = db.prepare(
      "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
    ).get(userId, targetUser.id);
    if (alreadySent) {
      throw Object.assign(new Error('ส่งคำขอเป็นเพื่อนไปแล้ว กรุณารอการตอบรับ'), { status: 409 });
    }

    const reverse = db.prepare(
      "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
    ).get(targetUser.id, userId);

    if (reverse) {
      db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(reverse.id);
      createFriendshipPair(userId, targetUser.id);
      return { status: 'accepted', message: `เป็นเพื่อนกับ ${targetUser.display_name} แล้ว` };
    }

    db.prepare(
      "INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
    ).run(crypto.randomUUID(), userId, targetUser.id, new Date().toISOString());

    return { status: 'pending', message: `ส่งคำขอเป็นเพื่อนไปยัง ${targetUser.display_name} แล้ว` };
  }

  function respondFriendRequest(userId, requestId, action) {
    const reqRow = db.prepare("SELECT * FROM friend_requests WHERE id = ? AND status = 'pending'").get(requestId);
    if (!reqRow) {
      throw Object.assign(new Error('ไม่พบคำขอเป็นเพื่อนหรือถูกจัดการไปแล้ว'), { status: 404 });
    }
    if (action === 'cancel') {
      if (reqRow.from_user_id !== userId) throw Object.assign(new Error('ไม่มีสิทธิ์ยกเลิกคำขอนี้'), { status: 403 });
      db.prepare('DELETE FROM friend_requests WHERE id = ?').run(requestId);
      return { success: true };
    }
    if (reqRow.to_user_id !== userId) {
      throw Object.assign(new Error('ไม่มีสิทธิ์จัดการคำขอนี้'), { status: 403 });
    }
    if (action === 'accept') {
      db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(requestId);
      createFriendshipPair(reqRow.from_user_id, reqRow.to_user_id);
      return { success: true, accepted: true };
    }
    if (action === 'decline') {
      db.prepare("UPDATE friend_requests SET status = 'declined' WHERE id = ?").run(requestId);
      return { success: true, accepted: false };
    }
    throw Object.assign(new Error('คำสั่งไม่ถูกต้อง'), { status: 400 });
  }

  function toggleFavoriteFriend(userId, friendId, favorite) {
    const existing = db.prepare('SELECT id, is_favorite FROM friendships WHERE user_id = ? AND friend_id = ?').get(userId, friendId);
    if (!existing) throw Object.assign(new Error('ไม่พบรายชื่อเพื่อนนี้'), { status: 404 });
    const next = favorite === undefined ? (existing.is_favorite ? 0 : 1) : (favorite ? 1 : 0);
    db.prepare('UPDATE friendships SET is_favorite = ? WHERE id = ?').run(next, existing.id);
    return { success: true, isFavorite: !!next };
  }

  function removeFriend(userId, friendId) {
    const res = db.prepare('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
      .run(userId, friendId, friendId, userId);
    if (!res.changes) throw Object.assign(new Error('ไม่พบรายชื่อเพื่อนนี้'), { status: 404 });
    return { success: true };
  }

  function toggleFavoriteServer(userId, server, favorite) {
    if (!server || typeof server.id !== 'string' || !server.id.trim()) {
      throw Object.assign(new Error('ข้อมูลเซิร์ฟเวอร์ไม่ถูกต้อง'), { status: 400 });
    }
    const serverId = server.id.trim().slice(0, 100);
    const exists = db.prepare('SELECT server_id FROM favorite_servers WHERE user_id = ? AND server_id = ?').get(userId, serverId);
    const shouldFav = favorite === undefined ? !exists : !!favorite;
    if (shouldFav) {
      db.prepare(`
        INSERT INTO favorite_servers (user_id, server_id, server_name, server_ip, server_tag, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, server_id) DO UPDATE SET server_name = excluded.server_name, server_ip = excluded.server_ip, server_tag = excluded.server_tag
      `).run(
        userId,
        serverId,
        String(server.name || serverId).slice(0, 100),
        String(server.ip || '').slice(0, 253),
        String(server.tag || '').slice(0, 40),
        new Date().toISOString()
      );
    } else {
      db.prepare('DELETE FROM favorite_servers WHERE user_id = ? AND server_id = ?').run(userId, serverId);
    }
    return { success: true, favoriteServers: getUserFavoriteServers(userId) };
  }

  function searchUsers(userId, query) {
    const clean = String(query || '').trim();
    if (clean.length < 2) return [];
    const like = `%${clean}%`;
    const rows = db.prepare(`
      SELECT * FROM users
      WHERE id != ? AND (username LIKE ? OR display_name LIKE ? OR UPPER(friend_code) = UPPER(?))
      LIMIT 12
    `).all(userId, like, like, clean);

    const now = Date.now();
    return rows.map(r => {
      const isFriend = !!db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(userId, r.id);
      const outReq = db.prepare("SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'").get(userId, r.id);
      const inReq = db.prepare("SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'").get(r.id, userId);
      return {
        ...toPublicUser(r, now, false),
        relation: isFriend ? 'friend' : outReq ? 'pending_out' : inReq ? 'pending_in' : 'none',
        incomingRequestId: inReq?.id || null
      };
    });
  }

  function seedDemoFriendsForUser(userId) {
    const nowIso = new Date().toISOString();
    const samples = [
      { id: 'demo-sacrig', username: 'sacrig_demo', display: 'Sacrig', code: 'ESTRA-DEMO1', color: '#2b6bf3', pref: 'online', srvId: 'noxtis-legacy', srvName: 'Noxtis Legacy', srvIp: '89.38.101.136:30120', fav: 1 },
      { id: 'demo-octalise', username: 'octalise_demo', display: 'Octalise', code: 'ESTRA-DEMO2', color: '#10b981', pref: 'online', srvId: 'noxtis-legacy', srvName: 'Noxtis Legacy', srvIp: '89.38.101.136:30120', fav: 1 },
      { id: 'demo-aquanova', username: 'aquanova_demo', display: 'AquaNova', code: 'ESTRA-DEMO3', color: '#0ea5e9', pref: 'away', srvId: '', srvName: '', srvIp: '', fav: 0 },
      { id: 'demo-crimson', username: 'crimson_demo', display: 'CrimsonWhisper', code: 'ESTRA-DEMO4', color: '#8b5cf6', pref: 'offline', srvId: '', srvName: '', srvIp: '', fav: 0 }
    ];
    for (const s of samples) {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, display_name, friend_code, password_hash, avatar_color, status_pref, is_demo, last_seen_at, current_server_id, current_server_name, current_server_ip, created_at)
        VALUES (?, ?, ?, ?, 'demo-locked', ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(s.id, s.username, s.display, s.code, s.color, s.pref, nowIso, s.srvId || null, s.srvName || null, s.srvIp || null, nowIso);
      db.prepare('INSERT OR IGNORE INTO friendships (id, user_id, friend_id, is_favorite, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), userId, s.id, s.fav, nowIso);
    }
    return getSocialState(userId);
  }

  function sendGameInvite(userId, friendId, server) {
    if (!friendId || friendId === userId) {
      throw Object.assign(new Error('ไม่พบเพื่อนที่ต้องการชวน'), { status: 400 });
    }
    const isFriend = db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(userId, friendId);
    if (!isFriend) {
      throw Object.assign(new Error('สามารถชวนได้เฉพาะผู้ที่เป็นเพื่อนกันเท่านั้น'), { status: 403 });
    }
    const friendRow = db.prepare('SELECT * FROM users WHERE id = ?').get(friendId);
    if (!friendRow || friendRow.is_demo) {
      throw Object.assign(new Error('ไม่สามารถส่งคำชวนให้บัญชีตัวอย่างได้'), { status: 400 });
    }
    const sid = String(server?.id || '').trim().slice(0, 100);
    const sname = String(server?.name || '').trim().slice(0, 100);
    const sip = String(server?.ip || '').trim().slice(0, 253);
    if (!sid || !sname || !sip) {
      throw Object.assign(new Error('กรุณาเลือกเมืองก่อนชวนเพื่อน'), { status: 400 });
    }
    const now = Date.now();
    db.prepare("UPDATE game_invites SET status = 'cancelled' WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'")
      .run(userId, friendId);
    db.prepare(`
      INSERT INTO game_invites (id, from_user_id, to_user_id, server_id, server_name, server_ip, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(crypto.randomUUID(), userId, friendId, sid, sname, sip, new Date(now).toISOString(), now + 5 * 60_000);
    return {
      ...getSocialState(userId),
      message: `ส่งคำชวนเข้าเล่น ${sname} ไปยัง ${friendRow.display_name} แล้ว`
    };
  }

  function respondGameInvite(userId, inviteId, action) {
    const invite = db.prepare("SELECT * FROM game_invites WHERE id = ? AND status = 'pending'").get(inviteId);
    if (!invite) {
      throw Object.assign(new Error('คำชวนหมดอายุหรือถูกจัดการแล้ว'), { status: 404 });
    }
    if (invite.expires_at <= Date.now()) {
      db.prepare("UPDATE game_invites SET status = 'expired' WHERE id = ?").run(invite.id);
      throw Object.assign(new Error('คำชวนหมดอายุแล้ว'), { status: 410 });
    }
    if (action === 'cancel') {
      if (invite.from_user_id !== userId) throw Object.assign(new Error('ไม่มีสิทธิ์ยกเลิกคำชวนนี้'), { status: 403 });
      db.prepare("UPDATE game_invites SET status = 'cancelled' WHERE id = ?").run(invite.id);
    } else if (action === 'accept' || action === 'decline') {
      if (invite.to_user_id !== userId) throw Object.assign(new Error('ไม่มีสิทธิ์จัดการคำชวนนี้'), { status: 403 });
      db.prepare('UPDATE game_invites SET status = ? WHERE id = ?').run(action === 'accept' ? 'accepted' : 'declined', invite.id);
    } else {
      throw Object.assign(new Error('คำสั่งไม่ถูกต้อง'), { status: 400 });
    }
    return {
      ...getSocialState(userId),
      inviteServer: { id: invite.server_id, name: invite.server_name, ip: invite.server_ip }
    };
  }

  return {
    dbPath,
    register,
    login,
    logout,
    resolveSession,
    updateHeartbeat,
    getSocialState,
    sendFriendRequest,
    respondFriendRequest,
    toggleFavoriteFriend,
    removeFriend,
    toggleFavoriteServer,
    searchUsers,
    seedDemoFriendsForUser,
    sendGameInvite,
    respondGameInvite,
    close: () => db.close()
  };
}
