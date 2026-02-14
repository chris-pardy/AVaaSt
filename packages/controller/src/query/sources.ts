import { createLogger } from "@avaast/shared";
import type { Source } from "@avaast/shared";

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
