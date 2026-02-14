import Database from "better-sqlite3";
import { createLogger } from "@avaast/shared";
import type { IndexedField } from "@avaast/shared";

export interface FtsIndex {
  name: string;
  tableName: string;
  fields: IndexedField[];
}

export interface FtsSearchResult {
  rowid: number;
  rank: number;
  data: Record<string, unknown>;
}

export class FtsAdapter {
  private db: Database.Database;
  private logger = createLogger("fts");
  private indexes = new Map<string, FtsIndex>();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.logger.info(`FTS adapter initialized at ${dbPath}`);
  }

  createIndex(name: string, fields: IndexedField[]): void {
    const tableName = `fts_${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const dataTableName = `${tableName}_data`;

    // Create the data table for storing full records
    const dataColumns = fields.map((f) => `"${f.name}" TEXT`).join(", ");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${dataTableName}" (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        source_uri TEXT UNIQUE NOT NULL,
        source_cid TEXT,
        ${dataColumns},
        raw_json TEXT
      )
    `);

    // Create FTS5 table for fulltext fields only
    const fulltextFields = fields.filter((f) => f.indexType === "fulltext");
    if (fulltextFields.length > 0) {
      const ftsColumns = fulltextFields.map((f) => `"${f.name}"`).join(", ");
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS "${tableName}" USING fts5(
          ${ftsColumns},
          content="${dataTableName}",
          content_rowid="rowid"
        )
      `);
    }

    this.indexes.set(name, { name, tableName, fields });
    this.logger.info(
      `Created FTS index: ${name} (${fields.length} fields, ${fulltextFields.length} fulltext)`,
    );
  }

  indexRecord(
    indexName: string,
    uri: string,
    cid: string | undefined,
    record: Record<string, unknown>,
  ): void {
    const index = this.indexes.get(indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);

    const dataTableName = `${index.tableName}_data`;
    const values: Record<string, unknown> = {
      source_uri: uri,
      source_cid: cid ?? null,
    };

    for (const field of index.fields) {
      values[field.name] = this.extractField(record, field.path);
    }
    values.raw_json = JSON.stringify(record);

    const columns = Object.keys(values);
    const placeholders = columns.map(() => "?").join(", ");
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO "${dataTableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
    );
    stmt.run(...Object.values(values));

    // Update FTS index
    const fulltextFields = index.fields.filter(
      (f) => f.indexType === "fulltext",
    );
    if (fulltextFields.length > 0) {
      const row = this.db
        .prepare(`SELECT rowid FROM "${dataTableName}" WHERE source_uri = ?`)
        .get(uri) as { rowid: number } | undefined;
      if (row) {
        const ftsValues = fulltextFields.map((f) => values[f.name] ?? "");
        const ftsCols = fulltextFields
          .map((f) => `"${f.name}"`)
          .join(", ");
        const ftsPlaceholders = fulltextFields.map(() => "?").join(", ");
        this.db
          .prepare(
            `INSERT OR REPLACE INTO "${index.tableName}" (rowid, ${ftsCols}) VALUES (?, ${ftsPlaceholders})`,
          )
          .run(row.rowid, ...ftsValues);
      }
    }
  }

  removeRecord(indexName: string, uri: string): void {
    const index = this.indexes.get(indexName);
    if (!index) return;

    const dataTableName = `${index.tableName}_data`;
    const row = this.db
      .prepare(`SELECT rowid FROM "${dataTableName}" WHERE source_uri = ?`)
      .get(uri) as { rowid: number } | undefined;
    if (row) {
      const fulltextFields = index.fields.filter(
        (f) => f.indexType === "fulltext",
      );
      if (fulltextFields.length > 0) {
        this.db
          .prepare(`DELETE FROM "${index.tableName}" WHERE rowid = ?`)
          .run(row.rowid);
      }
      this.db
        .prepare(`DELETE FROM "${dataTableName}" WHERE rowid = ?`)
        .run(row.rowid);
    }
  }

  search(
    indexName: string,
    query: string,
    options?: { limit?: number; offset?: number },
  ): FtsSearchResult[] {
    const index = this.indexes.get(indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const fulltextFields = index.fields.filter(
      (f) => f.indexType === "fulltext",
    );

    if (fulltextFields.length === 0) {
      // No fulltext fields, do keyword search on data table
      return this.keywordSearch(index, query, limit, offset);
    }

    const results = this.db
      .prepare(
        `
      SELECT "${index.tableName}".rowid, rank, d.raw_json, d.source_uri, d.source_cid
      FROM "${index.tableName}"
      JOIN "${index.tableName}_data" d ON d.rowid = "${index.tableName}".rowid
      WHERE "${index.tableName}" MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `,
      )
      .all(query, limit, offset) as Array<{
      rowid: number;
      rank: number;
      raw_json: string;
      source_uri: string;
      source_cid: string;
    }>;

    return results.map((r) => ({
      rowid: r.rowid,
      rank: r.rank,
      data: {
        ...JSON.parse(r.raw_json),
        _uri: r.source_uri,
        _cid: r.source_cid,
      },
    }));
  }

  private keywordSearch(
    index: FtsIndex,
    query: string,
    limit: number,
    offset: number,
  ): FtsSearchResult[] {
    const dataTableName = `${index.tableName}_data`;
    const keywordFields = index.fields.filter(
      (f) => f.indexType === "keyword",
    );
    if (keywordFields.length === 0) return [];

    const conditions = keywordFields
      .map((f) => `"${f.name}" LIKE ?`)
      .join(" OR ");
    const searchValue = `%${query}%`;
    const params = keywordFields.map(() => searchValue);

    const results = this.db
      .prepare(
        `
      SELECT rowid, raw_json, source_uri, source_cid
      FROM "${dataTableName}"
      WHERE ${conditions}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, limit, offset) as Array<{
      rowid: number;
      raw_json: string;
      source_uri: string;
      source_cid: string;
    }>;

    return results.map((r, i) => ({
      rowid: r.rowid,
      rank: i,
      data: {
        ...JSON.parse(r.raw_json),
        _uri: r.source_uri,
        _cid: r.source_cid,
      },
    }));
  }

  getCount(indexName: string): number {
    const index = this.indexes.get(indexName);
    if (!index) return 0;
    const dataTableName = `${index.tableName}_data`;
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM "${dataTableName}"`)
      .get() as { count: number };
    return row.count;
  }

  private extractField(record: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = record;
    for (const part of parts) {
      if (current === null || current === undefined) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  close(): void {
    this.db.close();
  }
}
