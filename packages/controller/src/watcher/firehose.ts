import { createLogger } from "@avaast/shared";

export interface FirehoseEvent {
  type: "create" | "update" | "delete";
  collection: string;
  rkey: string;
  did: string;
  cid?: string;
  record?: unknown;
}

export type FirehoseEventHandler = (event: FirehoseEvent) => void;

export interface FirehoseOptions {
  pdsEndpoint: string;
  cursor?: number;
  collections?: string[]; // filter for specific collections
  onEvent: FirehoseEventHandler;
  onCursor: (cursor: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Minimal WebSocket interface for compatibility across Node versions.
 * Node 22+ provides a global WebSocket; earlier versions require `ws`.
 */
interface MinimalWebSocket {
  addEventListener(
    type: "open",
    listener: () => void
  ): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void
  ): void;
  addEventListener(
    type: "close",
    listener: () => void
  ): void;
  addEventListener(
    type: "error",
    listener: (event: unknown) => void
  ): void;
  close(): void;
}

type WebSocketConstructor = new (url: string) => MinimalWebSocket;

/**
 * Resolves a WebSocket constructor. Uses the global WebSocket (Node 22+)
 * if available, otherwise falls back to the `ws` package.
 */
async function getWebSocketConstructor(): Promise<WebSocketConstructor> {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket as unknown as WebSocketConstructor;
  }
  try {
    // Dynamic import for environments without global WebSocket.
    // Use a variable to prevent TypeScript from resolving the module statically.
    const moduleName = "ws";
    const ws = await (Function("m", "return import(m)") as (m: string) => Promise<{ default: unknown }>)(moduleName);
    return ws.default as unknown as WebSocketConstructor;
  } catch {
    throw new Error(
      "No WebSocket implementation available. " +
        "Use Node 22+ (built-in WebSocket) or install the 'ws' package."
    );
  }
}

/**
 * FirehoseClient connects to a PDS via the com.atproto.sync.subscribeRepos
 * WebSocket endpoint and watches for record changes in specified collections.
 *
 * The firehose sends CBOR-encoded frames. This initial implementation handles
 * JSON-based messages; a production implementation would use @atproto/repo
 * for full CBOR/CAR decoding. The poller fallback ensures data is still fetched
 * even when binary frames cannot be decoded.
 */
export class FirehoseClient {
  private ws: MinimalWebSocket | null = null;
  private running = false;
  private logger = createLogger("firehose");
  private options: FirehoseOptions;
  private reconnectDelay = 1000;
  private WS: WebSocketConstructor | null = null;

  constructor(options: FirehoseOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.WS = await getWebSocketConstructor();
    this.running = true;
    await this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    while (this.running) {
      try {
        await this.doConnect();
      } catch (err) {
        this.logger.error(
          "Firehose connection error",
          err
        );
        this.options.onError?.(
          err instanceof Error ? err : new Error(String(err))
        );
        if (!this.running) break;
        this.logger.info(`Reconnecting in ${this.reconnectDelay}ms...`);
        await new Promise((r) => setTimeout(r, this.reconnectDelay));
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      }
    }
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.options.pdsEndpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/xrpc/com.atproto.sync.subscribeRepos";
      if (this.options.cursor !== undefined) {
        url.searchParams.set("cursor", String(this.options.cursor));
      }

      this.logger.info(`Connecting to firehose: ${url.toString()}`);
      const ws = new this.WS!(url.toString());
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.logger.info("Firehose connected");
        this.reconnectDelay = 1000;
      });

      ws.addEventListener("message", (event: { data: unknown }) => {
        try {
          this.handleMessage(event.data);
        } catch (err) {
          this.logger.error("Error handling firehose message", err);
        }
      });

      ws.addEventListener("close", () => {
        this.logger.info("Firehose disconnected");
        resolve();
      });

      ws.addEventListener("error", (err: unknown) => {
        this.logger.error("WebSocket error", err);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private handleMessage(data: unknown): void {
    // The firehose sends CBOR-encoded frames.
    // For simplicity in this initial implementation, we handle JSON-based messages.
    // A production implementation would use @atproto/repo for CBOR/CAR decoding.
    // For now, we skip binary frames -- the poller fallback handles data fetching.
    if (typeof data !== "string") {
      return;
    }

    try {
      const msg = JSON.parse(data) as Record<string, unknown>;
      if (msg && typeof msg === "object") {
        this.processMessage(msg);
      }
    } catch {
      // Not valid JSON -- likely CBOR, skip
    }
  }

  private processMessage(msg: Record<string, unknown>): void {
    const seq = msg.seq as number | undefined;
    if (seq !== undefined) {
      this.options.onCursor(seq);
    }

    const ops = msg.ops as Array<Record<string, unknown>> | undefined;
    if (!ops) return;

    for (const op of ops) {
      const path = op.path as string | undefined;
      if (!path) continue;

      const parts = path.split("/");
      const nsid = parts[0] ?? "";

      // Filter by collection if specified
      if (
        this.options.collections?.length &&
        !this.options.collections.includes(nsid)
      ) {
        continue;
      }

      const action = op.action as string | undefined;
      let eventType: FirehoseEvent["type"];
      if (action === "create") {
        eventType = "create";
      } else if (action === "update") {
        eventType = "update";
      } else {
        eventType = "delete";
      }

      const event: FirehoseEvent = {
        type: eventType,
        collection: nsid,
        rkey: parts[1] ?? "",
        did: (msg.repo as string) ?? "",
        cid: op.cid as string | undefined,
        record: op.record as unknown,
      };

      this.options.onEvent(event);
    }
  }
}
