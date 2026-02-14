import Database from "better-sqlite3";
import { createLogger } from "@avaast/shared";
import type { FirehoseEvent } from "./watcher/index.js";

export interface ChangeLogEntry {
  id: number;
  collection: string;
  rkey: string;
  did: string;
  eventType: string;
  recordJson: string | null;
  createdAt: string;
}

/**
 * ChangeLog stores a timestamped event log of record mutations seen by the
 * watcher. When the watcher sees a create/update/delete event it appends a
 * snapshot here. Computed queries can read from the change log to get
 * history over time.
 *
 * Uses WAL journal mode (same pattern as CursorStore).
 */
export class ChangeLog {
  private db: Database.Database;
  private logger = createLogger("changelog");
  private insertStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS changelog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        rkey TEXT NOT NULL,
        did TEXT NOT NULL,
        event_type TEXT NOT NULL,
        record_json TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_changelog_lookup
        ON changelog(collection, did, created_at)
    `);
    this.insertStmt = this.db.prepare(
      `INSERT INTO changelog (collection, rkey, did, event_type, record_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.logger.info(`ChangeLog initialized at ${dbPath}`);
  }

  append(event: FirehoseEvent): void {
    const recordJson =
      event.record != null ? JSON.stringify(event.record) : null;
    this.insertStmt.run(
      event.collection,
      event.rkey,
      event.did,
      event.type,
      recordJson,
      new Date().toISOString(),
    );
  }

  query(
    collection: string,
    options?: {
      did?: string;
      eventType?: string;
      limit?: number;
      afterDate?: string;
    },
  ): ChangeLogEntry[] {
    const conditions: string[] = ["collection = ?"];
    const params: unknown[] = [collection];

    if (options?.did) {
      conditions.push("did = ?");
      params.push(options.did);
    }
    if (options?.eventType) {
      conditions.push("event_type = ?");
      params.push(options.eventType);
    }
    if (options?.afterDate) {
      conditions.push("created_at > ?");
      params.push(options.afterDate);
    }

    const limit = options?.limit ?? 100;
    const sql = `SELECT id, collection, rkey, did, event_type, record_json, created_at
                 FROM changelog
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY created_at DESC
                 LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      collection: string;
      rkey: string;
      did: string;
      event_type: string;
      record_json: string | null;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      collection: r.collection,
      rkey: r.rkey,
      did: r.did,
      eventType: r.event_type,
      recordJson: r.record_json,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
    this.logger.info("ChangeLog closed");
  }
}
