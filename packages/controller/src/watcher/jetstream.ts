import { createLogger } from "@avaast/shared";
import type { FirehoseEvent, FirehoseEventHandler } from "./firehose.js";

export interface JetstreamOptions {
  jetstreamUrl: string;
  wantedCollections?: string[];
  onEvent: FirehoseEventHandler;
  onError?: (error: Error) => void;
}

interface JetstreamMessage {
  did: string;
  time_us: number;
  kind: string;
  commit?: {
    rev: string;
    operation: "create" | "update" | "delete";
    collection: string;
    rkey: string;
    record?: unknown;
    cid?: string;
  };
}

/**
 * Minimal WebSocket interface for compatibility across Node versions.
 */
interface MinimalWebSocket {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  close(): void;
}

type WebSocketConstructor = new (url: string) => MinimalWebSocket;

async function getWebSocketConstructor(): Promise<WebSocketConstructor> {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket as unknown as WebSocketConstructor;
  }
  try {
    // ws is a declared dependency — import it directly
    const ws = await import("ws");
    return (ws.default ?? ws) as unknown as WebSocketConstructor;
  } catch {
    throw new Error(
      "No WebSocket implementation available. " +
        "Use Node 22+ (built-in WebSocket) or install the 'ws' package.",
    );
  }
}

/**
 * JetstreamClient connects to a Jetstream relay and converts JSON events
 * into FirehoseEvent objects so the Watcher can use it interchangeably
 * with the existing FirehoseClient.
 */
export class JetstreamClient {
  private ws: MinimalWebSocket | null = null;
  private running = false;
  private logger = createLogger("jetstream");
  private options: JetstreamOptions;
  private reconnectDelay = 1000;
  private WS: WebSocketConstructor | null = null;

  constructor(options: JetstreamOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.WS = await getWebSocketConstructor();
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.running) return;

    const url = new URL(this.options.jetstreamUrl);
    if (this.options.wantedCollections) {
      for (const col of this.options.wantedCollections) {
        url.searchParams.append("wantedCollections", col);
      }
    }

    this.logger.info(`Connecting to Jetstream: ${url.toString()}`);
    const ws = new this.WS!(url.toString());
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.logger.info("Jetstream connected");
      this.reconnectDelay = 1000;
    });

    ws.addEventListener("message", (event: { data: unknown }) => {
      try {
        const text =
          typeof event.data === "string"
            ? event.data
            : String(event.data);
        const msg = JSON.parse(text) as JetstreamMessage;
        this.handleMessage(msg);
      } catch (err) {
        this.logger.error("Error handling Jetstream message", err);
      }
    });

    ws.addEventListener("close", () => {
      this.logger.info("Jetstream disconnected");
      if (this.running) {
        this.logger.info(`Reconnecting in ${this.reconnectDelay}ms...`);
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      }
    });

    ws.addEventListener("error", (err: unknown) => {
      this.logger.error("Jetstream WebSocket error", err);
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  private handleMessage(msg: JetstreamMessage): void {
    if (msg.kind !== "commit" || !msg.commit) return;

    const commit = msg.commit;
    const event: FirehoseEvent = {
      type: commit.operation,
      collection: commit.collection,
      rkey: commit.rkey,
      did: msg.did,
      cid: commit.cid,
      record: commit.record,
    };

    this.options.onEvent(event);
  }
}
