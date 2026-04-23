/**
 * Database setup — Turso (libsql) cloud-native SQLite.
 *
 * Uses TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for cloud deployment.
 * Falls back to local file:local.db for local development.
 */
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");

let client = null;

function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (url && authToken) {
      client = createClient({ url, authToken });
    } else {
      client = createClient({ url: "file:local.db" });
    }
  }
  return client;
}

async function initDb() {
  const db = getDb();

  await db.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    UNIQUE NOT NULL,
        email         TEXT    UNIQUE,
        password_hash TEXT    NOT NULL,
        role          TEXT    NOT NULL DEFAULT 'user',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        is_active     INTEGER NOT NULL DEFAULT 1
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS memberships (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        plan           TEXT    NOT NULL,
        amount_cents   INTEGER NOT NULL,
        currency       TEXT    NOT NULL DEFAULT 'USD',
        payment_method TEXT    NOT NULL,
        payment_ref    TEXT,
        status         TEXT    NOT NULL DEFAULT 'pending',
        starts_at      TEXT,
        expires_at     TEXT,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS conversations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        title         TEXT    NOT NULL DEFAULT 'New Chat',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        role            TEXT    NOT NULL,
        content         TEXT    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },
  ]);

  // Support tickets table
  try {
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS support_tickets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        subject    TEXT    NOT NULL,
        message    TEXT    NOT NULL,
        status     TEXT    NOT NULL DEFAULT 'open',
        admin_reply TEXT,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    });
  } catch {}

  // User memories table (per-user memory system)
  try {
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS user_memories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id),
        memory_text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    });
  } catch {}

  // Add summary column to conversations for long-chat summarization
  try { await db.execute({ sql: "ALTER TABLE conversations ADD COLUMN summary TEXT", args: [] }); } catch {}

  // Add trial columns if missing (safe for existing DBs)
  try { await db.execute({ sql: "ALTER TABLE users ADD COLUMN free_prompt_used INTEGER NOT NULL DEFAULT 0", args: [] }); } catch {}
  try { await db.execute({ sql: "ALTER TABLE users ADD COLUMN has_seen_store INTEGER NOT NULL DEFAULT 0", args: [] }); } catch {}

  // Seed admin account
  const adminUser = process.env.ADMIN_USERNAME || "DAVIDALLEY";
  const adminPass = process.env.ADMIN_PASSWORD || "Passwerd1";

  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE username = ?",
    args: [adminUser],
  });

  if (!existing.rows.length) {
    const hash = bcrypt.hashSync(adminPass, 12);
    await db.execute({
      sql: "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
      args: [adminUser, hash],
    });
    console.log(`Admin account '${adminUser}' created.`);
  }
}

module.exports = { getDb, initDb };
