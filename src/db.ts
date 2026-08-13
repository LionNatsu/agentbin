import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionIR } from "./ir";

export interface StoredSession {
  id: string;
  format: string;
  title: string | null;
  cwd: string | null;
  model: string | null;
  sessionId: string | null;
  startedAt: string | null;
  createdAt: number;
  size: number;
  lineCount: number;
  raw: string;
  ir: SessionIR;
}

export function initDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "agentbin.db"), { create: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      format      TEXT NOT NULL,
      title       TEXT,
      cwd         TEXT,
      model       TEXT,
      session_id  TEXT,
      started_at  TEXT,
      created_at  INTEGER NOT NULL,
      size        INTEGER NOT NULL,
      line_count  INTEGER NOT NULL,
      raw         TEXT NOT NULL,
      ir          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
  `);
  return db;
}

export function insertSession(
  db: Database,
  input: { id: string; format: string; raw: string; ir: SessionIR },
): void {
  const { ir } = input;
  db.prepare(
    `INSERT INTO sessions
       (id, format, title, cwd, model, session_id, started_at, created_at, size, line_count, raw, ir)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.format,
    ir.title ?? null,
    ir.cwd ?? null,
    ir.model ?? null,
    ir.sessionId ?? null,
    ir.startedAt ?? null,
    Date.now(),
    Buffer.byteLength(input.raw),
    input.raw.split("\n").filter((l) => l.trim()).length,
    input.raw,
    JSON.stringify(ir),
  );
}

interface Row {
  id: string;
  format: string;
  title: string | null;
  cwd: string | null;
  model: string | null;
  session_id: string | null;
  started_at: string | null;
  created_at: number;
  size: number;
  line_count: number;
  raw: string;
  ir: string;
}

export function getSession(db: Database, id: string): StoredSession | null {
  const row = db.query<Row, [string]>(`SELECT * FROM sessions WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    format: row.format,
    title: row.title,
    cwd: row.cwd,
    model: row.model,
    sessionId: row.session_id,
    startedAt: row.started_at,
    createdAt: row.created_at,
    size: row.size,
    lineCount: row.line_count,
    raw: row.raw,
    ir: JSON.parse(row.ir) as SessionIR,
  };
}
