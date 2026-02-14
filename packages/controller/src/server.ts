import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createLogger } from "@avaast/shared";
import type { QueryRequest, QueryResponse } from "@avaast/shared";

const logger = createLogger("controller-server");

export type QueryResolver = (
  req: QueryRequest,
) => Promise<QueryResponse>;

export interface ControllerServerOptions {
  port: number;
  hostname?: string;
  queryResolver: QueryResolver;
  getDeployStatus?: () => unknown[];
}

/**
 * Internal HTTP server for the Controller.
 * Exposes endpoints used by the Gateway to proxy XRPC requests.
 */
export class ControllerServer {
  private app: Hono;
  private server: Server | null = null;
  private options: ControllerServerOptions;

  constructor(options: ControllerServerOptions) {
    this.options = options;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // POST /internal/query - Execute a computed query
    this.app.post("/internal/query", async (c) => {
      try {
        const body = (await c.req.json()) as QueryRequest;
        const start = Date.now();
        const result = await this.options.queryResolver(body);
        const durationMs = Date.now() - start;
        return c.json({ ...result, durationMs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Query execution failed", err);
        return c.json({ error: "QueryFailed", message: msg }, 500);
      }
    });

    // GET /internal/deploy/status - List deploy statuses
    this.app.get("/internal/deploy/status", (c) => {
      const deploys = this.options.getDeployStatus?.() ?? [];
      return c.json({ deploys });
    });

    // GET /internal/health - Health check
    this.app.get("/internal/health", (c) => {
      return c.json({ status: "ok" });
    });

    // Stubs for unimplemented endpoints
    this.app.post("/internal/function", (c) => {
      return c.json(
        { error: "NotImplemented", message: "Function execution not yet supported" },
        501,
      );
    });

    this.app.post("/internal/search", (c) => {
      return c.json(
        { error: "NotImplemented", message: "Search not yet supported" },
        501,
      );
    });

    this.app.post("/internal/subscribe", (c) => {
      return c.json(
        { error: "NotImplemented", message: "Subscriptions not yet supported" },
        501,
      );
    });
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server = serve(
        {
          fetch: this.app.fetch,
          port: this.options.port,
          hostname: this.options.hostname,
        },
        (info) => {
          logger.info(`Controller server listening on ${info.address}:${info.port}`);
          resolve();
        },
      ) as Server;
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          logger.error("Error stopping controller server", err);
          reject(err);
        } else {
          logger.info("Controller server stopped");
          this.server = null;
          resolve();
        }
      });
    });
  }
}
