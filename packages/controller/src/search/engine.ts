import { createLogger } from "@avaast/shared";
import type { SearchIndexRecord } from "@avaast/shared";
import { FtsAdapter } from "./fts.js";
import { Indexer } from "./indexer.js";

export interface SearchEngineOptions {
  dbPath: string;
}

export interface SearchQuery {
  indexName: string;
  query: string;
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  results: unknown[];
  totalCount?: number;
  durationMs: number;
}

export class SearchEngine {
  private logger = createLogger("search-engine");
  private fts: FtsAdapter;
  private indexer: Indexer;

  constructor(options: SearchEngineOptions) {
    this.fts = new FtsAdapter(options.dbPath);
    this.indexer = new Indexer(this.fts);
  }

  registerIndex(name: string, record: SearchIndexRecord): void {
    this.indexer.registerIndex(name, record);
  }

  getIndexer(): Indexer {
    return this.indexer;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const start = Date.now();
    this.logger.debug(`Search: ${query.indexName} q="${query.query}"`);

    const results = this.fts.search(query.indexName, query.query, {
      limit: query.limit,
      offset: query.offset,
    });
    const totalCount = this.fts.getCount(query.indexName);

    return {
      results: results.map((r) => r.data),
      totalCount,
      durationMs: Date.now() - start,
    };
  }

  close(): void {
    this.fts.close();
  }
}
