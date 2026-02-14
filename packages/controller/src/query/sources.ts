import { createLogger } from "@avaast/shared";
import type { Source } from "@avaast/shared";
import type { ChangeLog } from "../changelog.js";

export interface DataSourceAdapter {
  fetchRecords(source: Source, did?: string): Promise<unknown[]>;
}

export class PdsDataSource implements DataSourceAdapter {
  private logger = createLogger("data-source");
  private resolver: {
    listRecords(
      did: string,
      collection: string,
      limit?: number,
    ): Promise<Array<{ uri: string; cid: string; value: unknown }>>;
  };

  constructor(resolver: {
    listRecords(
      did: string,
      collection: string,
      limit?: number,
    ): Promise<Array<{ uri: string; cid: string; value: unknown }>>;
  }) {
    this.resolver = resolver;
  }

  async fetchRecords(source: Source, defaultDid?: string): Promise<unknown[]> {
    const did = source.did ?? defaultDid;
    if (!did) {
      throw new Error(
        `No DID specified for source ${source.alias} (collection: ${source.collection})`,
      );
    }

    this.logger.debug(`Fetching records from ${source.collection} for ${did}`);
    const records = await this.resolver.listRecords(did, source.collection);
    return records.map((r) => ({
      ...(r.value as Record<string, unknown>),
      _uri: r.uri,
      _cid: r.cid,
    }));
  }
}

/**
 * ChangeLogDataSource reads historical events from the ChangeLog SQLite table.
 * Used for collections suffixed with `:updates` or `:deletes`.
 */
export class ChangeLogDataSource implements DataSourceAdapter {
  private logger = createLogger("changelog-data-source");
  private changeLog: ChangeLog;
  private eventType: string;

  constructor(changeLog: ChangeLog, eventType: string) {
    this.changeLog = changeLog;
    this.eventType = eventType;
  }

  async fetchRecords(source: Source, defaultDid?: string): Promise<unknown[]> {
    const did = source.did ?? defaultDid;
    this.logger.debug(
      `Fetching changelog records: ${source.collection} (${this.eventType}) for ${did ?? "any"}`,
    );

    const eventTypes =
      this.eventType === "updates" ? "create" : "delete";

    const entries = this.changeLog.query(source.collection, {
      did: did ?? undefined,
      eventType: eventTypes,
    });

    return entries.map((entry) => {
      const record =
        entry.recordJson != null
          ? (JSON.parse(entry.recordJson) as Record<string, unknown>)
          : {};
      return {
        ...record,
        _rkey: entry.rkey,
        _did: entry.did,
        _eventType: entry.eventType,
        _createdAt: entry.createdAt,
      };
    });
  }
}

/**
 * RoutingDataSource parses the collection string and routes to the right
 * data source:
 *
 * - `app.avaast.status` → PdsDataSource (current state via listRecords)
 * - `app.avaast.status:updates` → ChangeLogDataSource (create + update events)
 * - `app.avaast.status:deletes` → ChangeLogDataSource (delete events)
 */
export class RoutingDataSource implements DataSourceAdapter {
  private pds: PdsDataSource;
  private updatesSource: ChangeLogDataSource;
  private deletesSource: ChangeLogDataSource;

  constructor(pds: PdsDataSource, changeLog: ChangeLog) {
    this.pds = pds;
    this.updatesSource = new ChangeLogDataSource(changeLog, "updates");
    this.deletesSource = new ChangeLogDataSource(changeLog, "deletes");
  }

  async fetchRecords(source: Source, defaultDid?: string): Promise<unknown[]> {
    const { collection, suffix } = parseCollectionSuffix(source.collection);

    // Build a source with the base collection (suffix stripped)
    const baseSource: Source = { ...source, collection };

    switch (suffix) {
      case "updates":
        return this.updatesSource.fetchRecords(baseSource, defaultDid);
      case "deletes":
        return this.deletesSource.fetchRecords(baseSource, defaultDid);
      default:
        return this.pds.fetchRecords(source, defaultDid);
    }
  }
}

function parseCollectionSuffix(collection: string): {
  collection: string;
  suffix: string | null;
} {
  const colonIdx = collection.lastIndexOf(":");
  if (colonIdx === -1) {
    return { collection, suffix: null };
  }
  return {
    collection: collection.slice(0, colonIdx),
    suffix: collection.slice(colonIdx + 1),
  };
}
