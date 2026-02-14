import { createLogger } from "@avaast/shared";
import type { SearchIndexRecord } from "@avaast/shared";
import { FtsAdapter } from "./fts.js";

export interface IndexDefinition {
  name: string;
  record: SearchIndexRecord;
}

export class Indexer {
  private logger = createLogger("indexer");
  private definitions = new Map<string, IndexDefinition>();
  private fts: FtsAdapter;
  // Maps collection NSID to index names that source from it
  private collectionToIndexes = new Map<string, string[]>();

  constructor(fts: FtsAdapter) {
    this.fts = fts;
  }

  registerIndex(name: string, record: SearchIndexRecord): void {
    this.definitions.set(name, { name, record });
    this.fts.createIndex(name, record.fields);

    const collection = record.source.collection;
    const indexes = this.collectionToIndexes.get(collection) ?? [];
    indexes.push(name);
    this.collectionToIndexes.set(collection, indexes);

    this.logger.info(
      `Registered search index: ${name} (source: ${collection})`,
    );
  }

  onRecordChange(
    collection: string,
    uri: string,
    cid: string | undefined,
    record: unknown | null,
    deleted: boolean,
  ): void {
    const indexNames = this.collectionToIndexes.get(collection);
    if (!indexNames) return;

    for (const indexName of indexNames) {
      if (deleted || record === null) {
        this.fts.removeRecord(indexName, uri);
        this.logger.debug(`Removed ${uri} from index ${indexName}`);
      } else {
        this.fts.indexRecord(
          indexName,
          uri,
          cid,
          record as Record<string, unknown>,
        );
        this.logger.debug(`Indexed ${uri} in index ${indexName}`);
      }
    }
  }

  getIndexesForCollection(collection: string): string[] {
    return this.collectionToIndexes.get(collection) ?? [];
  }
}
