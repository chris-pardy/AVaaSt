import Database from "better-sqlite3";
import { createLogger } from "@avaast/shared";

/**
 * CursorStore persists firehose cursor positions in SQLite so that
 * the watcher can resume from the correct sequence number after a restart.
 * Uses WAL journal mode for concurrent read/write performance.
 */
export class CursorStore {
  private db: Database.Database;
  private logger = createLogger("cursor-store");

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cursors (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.logger.info(`Cursor store initialized at ${dbPath}`);
  }

  getCursor(key: string): number | undefined {
    const row = this.db
      .prepare("SELECT value FROM cursors WHERE key = ?")
      .get(key) as { value: number } | undefined;
    return row?.value;
  }

  setCursor(key: string, value: number): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO cursors (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      )
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
