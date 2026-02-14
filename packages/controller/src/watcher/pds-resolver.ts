import { createLogger, retry } from "@avaast/shared";

interface DidDocument {
  id: string;
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
}

/**
 * PdsResolver handles DID resolution and PDS record/blob fetching.
 * It resolves did:plc and did:web DIDs to their PDS endpoints, then
 * provides methods to fetch individual records, list records, and
 * retrieve blobs from those endpoints.
 *
 * DID-to-PDS mappings are cached with a configurable TTL to reduce
 * redundant resolution requests.
 */
export class PdsResolver {
  private logger = createLogger("pds-resolver");
  private didCache = new Map<
    string,
    { pdsEndpoint: string; expiresAt: number }
  >();
  private cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  async resolveDid(did: string): Promise<string> {
    const cached = this.didCache.get(did);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.pdsEndpoint;
    }

    const pdsEndpoint = await this.doResolveDid(did);
    this.didCache.set(did, {
      pdsEndpoint,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    return pdsEndpoint;
  }

  private async doResolveDid(did: string): Promise<string> {
    let doc: DidDocument;

    if (did.startsWith("did:plc:")) {
      doc = await this.resolvePlc(did);
    } else if (did.startsWith("did:web:")) {
      doc = await this.resolveWeb(did);
    } else {
      throw new Error(`Unsupported DID method: ${did}`);
    }

    const pdsService = doc.service?.find(
      (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer"
    );
    if (!pdsService) {
      throw new Error(`No PDS service found in DID document for ${did}`);
    }

    return pdsService.serviceEndpoint;
  }

  private async resolvePlc(did: string): Promise<DidDocument> {
    const response = await retry(
      () => fetch(`https://plc.directory/${did}`),
      { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000 }
    );
    if (!response.ok) {
      throw new Error(`Failed to resolve DID ${did}: ${response.status}`);
    }
    return response.json() as Promise<DidDocument>;
  }

  private async resolveWeb(did: string): Promise<DidDocument> {
    const domain = did.replace("did:web:", "").replace(/:/g, "/");
    const url = `https://${domain}/.well-known/did.json`;
    const response = await retry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    });
    if (!response.ok) {
      throw new Error(`Failed to resolve DID ${did}: ${response.status}`);
    }
    return response.json() as Promise<DidDocument>;
  }

  async getRecord(
    did: string,
    collection: string,
    rkey: string
  ): Promise<{ uri: string; cid: string; value: unknown }> {
    const pds = await this.resolveDid(did);
    const url = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

    const response = await retry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to get record ${collection}/${rkey} from ${did}: ${response.status}`
      );
    }
    return response.json() as Promise<{
      uri: string;
      cid: string;
      value: unknown;
    }>;
  }

  async getBlob(did: string, cid: string): Promise<Uint8Array> {
    const pds = await this.resolveDid(did);
    const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;

    const response = await retry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    });
    if (!response.ok) {
      throw new Error(`Failed to get blob ${cid} from ${did}: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async listRecords(
    did: string,
    collection: string,
    limit = 100
  ): Promise<Array<{ uri: string; cid: string; value: unknown }>> {
    const pds = await this.resolveDid(did);
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&limit=${limit}`;

    const response = await retry(() => fetch(url), {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to list records ${collection} from ${did}: ${response.status}`
      );
    }
    const data = (await response.json()) as {
      records: Array<{ uri: string; cid: string; value: unknown }>;
    };
    return data.records;
  }
}
