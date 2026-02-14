import { createLogger } from "@avaast/shared";

export interface SubscriberConnection {
  id: string;
  endpointName: string;
  params: Record<string, string>;
  send(data: unknown): void;
  close(): void;
  onClose(handler: () => void): void;
}

export class WebSocketTransport {
  private logger = createLogger("ws-transport");

  createConnection(
    ws: {
      send(data: string): void;
      close(): void;
      on(event: string, handler: (...args: unknown[]) => void): void;
    },
    id: string,
    endpointName: string,
    params: Record<string, string>,
  ): SubscriberConnection {
    let closeHandler: (() => void) | null = null;

    const conn: SubscriberConnection = {
      id,
      endpointName,
      params,
      send(data: unknown) {
        try {
          ws.send(JSON.stringify(data));
        } catch {
          // Connection may be closed
        }
      },
      close() {
        try {
          ws.close();
        } catch {
          // Already closed
        }
      },
      onClose(handler: () => void) {
        closeHandler = handler;
      },
    };

    ws.on("close", () => {
      closeHandler?.();
    });

    ws.on("error", () => {
      closeHandler?.();
    });

    this.logger.debug(`WebSocket connection created: ${id}`);
    return conn;
  }
}

export class SseTransport {
  private logger = createLogger("sse-transport");

  createConnection(
    res: {
      write(chunk: string): void;
      end(): void;
      on(event: string, handler: () => void): void;
    },
    id: string,
    endpointName: string,
    params: Record<string, string>,
  ): SubscriberConnection {
    let closeHandler: (() => void) | null = null;

    const conn: SubscriberConnection = {
      id,
      endpointName,
      params,
      send(data: unknown) {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Connection may be closed
        }
      },
      close() {
        try {
          res.end();
        } catch {
          // Already closed
        }
      },
      onClose(handler: () => void) {
        closeHandler = handler;
      },
    };

    res.on("close", () => {
      closeHandler?.();
    });

    this.logger.debug(`SSE connection created: ${id}`);
    return conn;
  }
}
