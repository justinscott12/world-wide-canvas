/**
 * Durable storage behind a narrow interface, so the in-memory game logic
 * never touches the database directly. v1 ships a SQLite adapter; Redis +
 * Postgres can implement the same interface later for multi-node scale.
 */
import Database from "better-sqlite3";
import { chunkKey } from "@shared/chunk.js";

export interface EditRecord {
  session: string;
  x: number;
  y: number;
  color: number;
  ts: number;
}

export interface StorageAdapter {
  /** Full chunk bytes, or null if the chunk has never been painted. */
  loadChunk(cx: number, cy: number): Uint8Array | null;
  /** Persist a chunk's current bytes. */
  saveChunk(cx: number, cy: number, data: Uint8Array): void;
  /** Append to the moderation/replay edit log. */
  appendEdits(edits: EditRecord[]): void;
  close(): void;
}

/** SQLite-backed storage (synchronous — matches better-sqlite3). */
export class SqliteStorage implements StorageAdapter {
  private db: Database.Database;
  private selectChunk: Database.Statement;
  private upsertChunk: Database.Statement;
  private insertEdit: Database.Statement;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        key  TEXT PRIMARY KEY,
        cx   INTEGER NOT NULL,
        cy   INTEGER NOT NULL,
        data BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS edits (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        x       INTEGER NOT NULL,
        y       INTEGER NOT NULL,
        color   INTEGER NOT NULL,
        ts      INTEGER NOT NULL
      );
    `);
    this.selectChunk = this.db.prepare("SELECT data FROM chunks WHERE key = ?");
    this.upsertChunk = this.db.prepare(
      `INSERT INTO chunks (key, cx, cy, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data`,
    );
    this.insertEdit = this.db.prepare(
      "INSERT INTO edits (session, x, y, color, ts) VALUES (?, ?, ?, ?, ?)",
    );
  }

  loadChunk(cx: number, cy: number): Uint8Array | null {
    const row = this.selectChunk.get(chunkKey(cx, cy)) as { data: Buffer } | undefined;
    return row ? new Uint8Array(row.data) : null;
  }

  saveChunk(cx: number, cy: number, data: Uint8Array): void {
    this.upsertChunk.run(chunkKey(cx, cy), cx, cy, Buffer.from(data));
  }

  appendEdits(edits: EditRecord[]): void {
    const tx = this.db.transaction((rows: EditRecord[]) => {
      for (const e of rows) this.insertEdit.run(e.session, e.x, e.y, e.color, e.ts);
    });
    tx(edits);
  }

  close(): void {
    this.db.close();
  }
}

/** Volatile storage — used by tests and an optional `--no-db` mode. */
export class MemoryStorage implements StorageAdapter {
  private chunks = new Map<string, Uint8Array>();
  edits: EditRecord[] = [];

  loadChunk(cx: number, cy: number): Uint8Array | null {
    const data = this.chunks.get(chunkKey(cx, cy));
    return data ? new Uint8Array(data) : null;
  }
  saveChunk(cx: number, cy: number, data: Uint8Array): void {
    this.chunks.set(chunkKey(cx, cy), new Uint8Array(data));
  }
  appendEdits(edits: EditRecord[]): void {
    this.edits.push(...edits);
  }
  close(): void {}
}
