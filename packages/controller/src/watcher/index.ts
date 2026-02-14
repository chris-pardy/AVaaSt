import { createLogger } from "@avaast/shared";
import {
  FirehoseClient,
  type FirehoseEvent,
  type FirehoseEventHandler,
} from "./firehose.js";
import { JetstreamClient } from "./jetstream.js";
import { Poller } from "./poller.js";
import { PdsResolver } from "./pds-resolver.js";
import { CursorStore } from "./cursor-store.js";

export { FirehoseClient, Poller, PdsResolver, CursorStore, JetstreamClient };
export type { FirehoseEvent, FirehoseEventHandler };

const AVAAS_COLLECTIONS = [
  "dev.avaas.computed",
  "dev.avaas.function",
  "dev.avaas.searchIndex",
  "dev.avaas.subscription",
  "dev.avaas.deploy",
  "dev.avaas.appView",
];

export interface WatcherOptions {
  pdsEndpoint: string;
  watchDid: string;
  dbPath: string;
  useFirehose?: boolean;
  pollIntervalMs?: number;
  onEvent: FirehoseEventHandler;
  onError?: (error: Error) => void;
  /** Jetstream WebSocket URL. When set, Jetstream is used instead of firehose/poller. */
  jetstreamUrl?: string;
  /** Extra collections to subscribe to via Jetstream (merged with AVAAS_COLLECTIONS). */
  extraCollections?: string[];
}

/**
 * Watcher orchestrates PDS observation by tying together the firehose
 * WebSocket client, polling fallback, DID resolver, and cursor persistence.
 *
 * It first attempts to connect via the firehose for real-time updates.
 * If that fails, it falls back to polling the PDS at a configurable interval.
 * Cursor positions are persisted in SQLite so the watcher can resume
 * from where it left off after a restart.
 *
 * When a Jetstream URL is provided, it connects to Jetstream instead,
 * which provides JSON events over WebSocket.
 */
export class Watcher {
  private logger = createLogger("watcher");
  private firehose: FirehoseClient | null = null;
  private jetstream: JetstreamClient | null = null;
  private poller: Poller | null = null;
  private cursorStore: CursorStore;
  private resolver: PdsResolver;
  private options: WatcherOptions;

  constructor(options: WatcherOptions) {
    this.options = options;
    this.cursorStore = new CursorStore(options.dbPath);
    this.resolver = new PdsResolver();
  }

  async start(): Promise<void> {
    this.logger.info(`Starting watcher for ${this.options.watchDid}`);

    // Jetstream mode
    if (this.options.jetstreamUrl) {
      this.startJetstream();
      return;
    }

    if (this.options.useFirehose !== false) {
      try {
        await this.startFirehose();
        return;
      } catch (err) {
        this.logger.warn(
          "Firehose unavailable, falling back to polling",
          err
        );
      }
    }

    this.startPoller();
  }

  stop(): void {
    this.firehose?.stop();
    this.jetstream?.stop();
    this.poller?.stop();
    this.cursorStore.close();
    this.logger.info("Watcher stopped");
  }

  getResolver(): PdsResolver {
    return this.resolver;
  }

  private startJetstream(): void {
    const allCollections = [
      ...AVAAS_COLLECTIONS,
      ...(this.options.extraCollections ?? []),
    ];
    this.logger.info(
      `Starting Jetstream client (url: ${this.options.jetstreamUrl}, collections: ${allCollections.length})`
    );

    this.jetstream = new JetstreamClient({
      jetstreamUrl: this.options.jetstreamUrl!,
      wantedCollections: allCollections,
      onEvent: (event) => {
        if (event.did === this.options.watchDid) {
          this.options.onEvent(event);
        }
      },
      onError: this.options.onError,
    });

    this.jetstream.start();
  }

  private async startFirehose(): Promise<void> {
    const cursor = this.cursorStore.getCursor("firehose");
    this.logger.info(`Starting firehose (cursor: ${cursor ?? "none"})`);

    this.firehose = new FirehoseClient({
      pdsEndpoint: this.options.pdsEndpoint,
      cursor,
      collections: AVAAS_COLLECTIONS,
      onEvent: (event) => {
        if (event.did === this.options.watchDid) {
          this.options.onEvent(event);
        }
      },
      onCursor: (seq) => {
        this.cursorStore.setCursor("firehose", seq);
      },
      onError: this.options.onError,
    });

    await this.firehose.start();
  }

  private startPoller(): void {
    this.logger.info(
      `Starting poller (interval: ${this.options.pollIntervalMs ?? 30000}ms)`
    );

    this.poller = new Poller({
      pdsEndpoint: this.options.pdsEndpoint,
      did: this.options.watchDid,
      collections: AVAAS_COLLECTIONS,
      intervalMs: this.options.pollIntervalMs ?? 30000,
      onEvent: this.options.onEvent,
      onError: this.options.onError,
    });

    this.poller.start();
  }
}
