import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NormalizedPage } from './types.js';

export class SnapshotStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        page_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  seenEvent(eventId: string): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO events (id) VALUES (?)')
      .run(eventId);
    return res.changes === 0;
  }

  getSnapshot(pageId: string): NormalizedPage | null {
    const row = this.db
      .prepare('SELECT payload FROM snapshots WHERE page_id = ?')
      .get(pageId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as NormalizedPage) : null;
  }

  saveSnapshot(page: NormalizedPage): void {
    // Explicit fields: people carry e-mails, which must not land on disk.
    const snapshot = { id: page.id, url: page.url, title: page.title, properties: page.properties };
    this.db
      .prepare(
        `INSERT INTO snapshots (page_id, payload, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(page_id) DO UPDATE SET payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
      .run(page.id, JSON.stringify(snapshot));
  }

  close(): void {
    this.db.close();
  }
}
