import { createLogger } from "@avaast/shared";
import type { FirehoseEvent, FirehoseEventHandler } from "./firehose.js";

export interface PollerOptions {
  pdsEndpoint: string;
  did: string;
  collections: string[];
  intervalMs: number;
  onEvent: FirehoseEventHandler;
  onError?: (error: Error) => void;
}

/**
 * Poller provides a polling-based fallback for watching PDS record changes
 * when the firehose WebSocket is unavailable. It checks specified collections
 * at regular intervals and emits create/update/delete events by comparing
 * CIDs between polls.
 */
export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger = createLogger("poller");
  private knownCids = new Map<string, string>(); // "collection/rkey" -> cid
  private options: PollerOptions;

  constructor(options: PollerOptions) {
    this.options = options;
  }

  start(): void {
    this.logger.info(
      `Starting poller with ${this.options.intervalMs}ms interval`
    );
    void this.poll(); // Initial poll
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    for (const collection of this.options.collections) {
      try {
        await this.pollCollection(collection);
      } catch (err) {
        this.logger.error(`Error polling ${collection}`, err);
        this.options.onError?.(
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }
  }

  private async pollCollection(collection: string): Promise<void> {
    const url = `${this.options.pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(this.options.did)}&collection=${encodeURIComponent(collection)}&limit=100`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to list records: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      records: Array<{ uri: string; cid: string; value: unknown }>;
    };
    const currentKeys = new Set<string>();

    for (const record of data.records) {
      const parts = record.uri.split("/");
      const rkey = parts[parts.length - 1] ?? "";
      const key = `${collection}/${rkey}`;
      currentKeys.add(key);

      const previousCid = this.knownCids.get(key);
      if (!previousCid) {
        // New record
        this.knownCids.set(key, record.cid);
        this.options.onEvent({
          type: "create",
          collection,
          rkey,
          did: this.options.did,
          cid: record.cid,
          record: record.value,
        });
      } else if (previousCid !== record.cid) {
        // Updated record
        this.knownCids.set(key, record.cid);
        this.options.onEvent({
          type: "update",
          collection,
          rkey,
          did: this.options.did,
          cid: record.cid,
          record: record.value,
        });
      }
    }

    // Check for deleted records
    for (const [key] of this.knownCids) {
      if (!key.startsWith(collection + "/")) continue;
      if (!currentKeys.has(key)) {
        const rkey = key.split("/")[1] ?? "";
        this.knownCids.delete(key);
        this.options.onEvent({
          type: "delete",
          collection,
          rkey,
          did: this.options.did,
        });
      }
    }
  }
}
