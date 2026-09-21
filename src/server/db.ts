import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite persistence. One file, WAL mode. Kits are stored as their full JSON
 * payload (the document the UI renders), with queryable columns for listing
 * and status. Generation events and per-card practice stats get their own
 * tables so a kit can be reopened and continued at any time.
 */

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = process.env.DATABASE_PATH ?? "./data/prepmind.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS kits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      company_url TEXT NOT NULL,
      days INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      payload TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_kits_user ON kits(user_id);

    CREATE TABLE IF NOT EXISTS generation_events (
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      stage TEXT NOT NULL,
      message TEXT NOT NULL,
      percent INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (kit_id, seq)
    );

    CREATE TABLE IF NOT EXISTS practice_cards (
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      repetitions INTEGER NOT NULL DEFAULT 0,
      interval_days INTEGER NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 2.3,
      due_at TEXT NOT NULL,
      last_confidence INTEGER,
      reviews INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (kit_id, card_id)
    );
  `);
}

export interface KitRow {
  id: string;
  user_id: string;
  status: string;
  stage: string;
  title: string;
  company_url: string;
  days: number;
  fingerprint: string;
  payload: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const kitQueries = {
  insert: (row: KitRow) =>
    getDb()
      .prepare(
        `INSERT INTO kits (id, user_id, status, stage, title, company_url, days, fingerprint, payload, error, created_at, updated_at)
         VALUES (@id, @user_id, @status, @stage, @title, @company_url, @days, @fingerprint, @payload, @error, @created_at, @updated_at)`
      )
      .run(row),
  getById: (id: string) =>
    getDb().prepare(`SELECT * FROM kits WHERE id = ?`).get(id) as KitRow | undefined,
  getByUser: (userId: string) =>
    getDb()
      .prepare(`SELECT * FROM kits WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as KitRow[],
  getByFingerprint: (userId: string, fingerprint: string) =>
    getDb()
      .prepare(`SELECT * FROM kits WHERE user_id = ? AND fingerprint = ?`)
      .get(userId, fingerprint) as KitRow | undefined,
  delete: (id: string) => getDb().prepare(`DELETE FROM kits WHERE id = ?`).run(id),
  setStatus: (id: string, status: string, stage: string, error?: string | null) =>
    getDb()
      .prepare(
        `UPDATE kits SET status = ?, stage = ?, error = ?, updated_at = ? WHERE id = ?`
      )
      .run(status, stage, error ?? null, new Date().toISOString(), id),
  setPayload: (id: string, payload: string, title: string) =>
    getDb()
      .prepare(`UPDATE kits SET payload = ?, title = ?, updated_at = ? WHERE id = ?`)
      .run(payload, title, new Date().toISOString(), id),
  setTaskRunning: (id: string, status: string, stage: string) =>
    getDb()
      .prepare(`UPDATE kits SET status = ?, stage = ?, error = NULL, updated_at = ? WHERE id = ?`)
      .run(status, stage, new Date().toISOString(), id),
};

export const eventQueries = {
  append: (kitId: string, seq: number, stage: string, message: string, percent: number) =>
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO generation_events (kit_id, seq, stage, message, percent, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(kitId, seq, stage, message, percent, new Date().toISOString()),
  list: (kitId: string) =>
    getDb()
      .prepare(`SELECT * FROM generation_events WHERE kit_id = ? ORDER BY seq ASC`)
      .all(kitId) as {
      kit_id: string;
      seq: number;
      stage: string;
      message: string;
      percent: number;
      created_at: string;
    }[],
  deleteForKit: (kitId: string) =>
    getDb().prepare(`DELETE FROM generation_events WHERE kit_id = ?`).run(kitId),
};

export const practiceQueries = {
  upsert: (kitId: string, stat: {
    card_id: string;
    repetitions: number;
    interval_days: number;
    ease: number;
    due_at: string;
    last_confidence: number | null;
    reviews: number;
  }) =>
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO practice_cards
         (kit_id, card_id, repetitions, interval_days, ease, due_at, last_confidence, reviews, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        kitId,
        stat.card_id,
        stat.repetitions,
        stat.interval_days,
        stat.ease,
        stat.due_at,
        stat.last_confidence,
        stat.reviews,
        new Date().toISOString()
      ),
  listForKit: (kitId: string) =>
    getDb()
      .prepare(`SELECT * FROM practice_cards WHERE kit_id = ?`)
      .all(kitId) as {
      kit_id: string;
      card_id: string;
      repetitions: number;
      interval_days: number;
      ease: number;
      due_at: string;
      last_confidence: number | null;
      reviews: number;
      updated_at: string;
    }[],
};

export function createFingerprint(jd: string, companyUrl: string, days: number): string {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  let url = companyUrl.trim().toLowerCase();
  try {
    const parsed = new URL(companyUrl);
    url = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    // keep raw
  }
  return crypto
    .createHash("sha256")
    .update(`${normalise(jd)}|${url}|${days}`)
    .digest("hex");
}
