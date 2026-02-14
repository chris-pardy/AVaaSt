import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { DeployedEndpoint, TrafficRule } from '@avaast/shared';
import { createLogger } from '@avaast/shared';
import { TrafficShaper } from './traffic-shaper.js';
import { DynamicRouter } from './router.js';
import { createAdminRouter } from './admin.js';
import { extractAuth } from './auth.js';

const logger = createLogger('gateway');

export interface GatewayConfig {
  /** Port for the gateway HTTP server */
  port: number;
  /** Base URL for the controller, e.g. "http://localhost:3001" */
  controllerUrl: string;
  /** Optional hostname to bind to */
  hostname?: string;
}

/**
 * The Gateway is an XRPC server that receives HTTP requests, routes them
 * to the correct deploy version via traffic shaping, and proxies to the
 * Controller for actual execution.
 */
export class Gateway {
  private app: Hono;
  private trafficShaper: TrafficShaper;
  private router: DynamicRouter;
  private config: GatewayConfig;
  private server: Server | null = null;
  private startedAt: number = 0;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.app = new Hono();
    this.trafficShaper = new TrafficShaper();
    this.router = new DynamicRouter(config.controllerUrl);

    this.setupMiddleware();
    this.setupAdminRoutes();
    this.setupXrpcRoutes();
  }

  /**
   * Set up request-level middleware for auth extraction and logging.
   */
  private setupMiddleware(): void {
    // Request logging middleware
    this.app.use('*', async (c, next) => {
      const start = Date.now();
      const method = c.req.method;
      const path = c.req.path;

      await next();

      const duration = Date.now() - start;
      logger.debug(`${method} ${path} ${c.res.status} ${duration}ms`);
    });
  }

  /**
   * Mount the admin routes under /admin.
   */
  private setupAdminRoutes(): void {
    const adminRouter = createAdminRouter({
      onEndpointsUpdate: (endpoints) => {
        this.router.registerEndpoints(endpoints);
      },
      onTrafficUpdate: (rules) => {
        this.trafficShaper.updateRules(rules);
      },
      getStatus: () => ({
        uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
        registeredEndpoints: this.router.getEndpointNames(),
        trafficRules: this.trafficShaper.getRules(),
      }),
    });

    this.app.route('/admin', adminRouter);
  }

  /**
   * Set up the XRPC endpoint routes.
   * XRPC uses the pattern: GET/POST /xrpc/{methodName}
   */
  private setupXrpcRoutes(): void {
    // Handle GET requests (computed queries, search, subscriptions)
    this.app.get('/xrpc/:method', async (c) => {
      const methodName = c.req.param('method');
      return this.handleXrpcRequest(c.req.raw, methodName, 'GET');
    });

    // Handle POST requests (function calls)
    this.app.post('/xrpc/:method', async (c) => {
      const methodName = c.req.param('method');
      return this.handleXrpcRequest(c.req.raw, methodName, 'POST');
    });
  }

  /**
   * Main XRPC request handler. Looks up the endpoint, selects a deploy
   * via traffic shaping, and proxies to the controller.
   */
  private async handleXrpcRequest(
    req: Request,
    methodName: string,
    httpMethod: string
  ): Promise<Response> {
    // 1. Look up endpoint by name
    const endpoint = this.router.getEndpoint(methodName);
    if (!endpoint) {
      return Response.json(
        { error: 'MethodNotFound', message: `Unknown method: ${methodName}` },
        { status: 404 }
      );
    }

    // 2. Select deploy via traffic shaper
    const auth = extractAuth(req);
    const stickyKey = auth.did; // Use DID for sticky sessions if authenticated
    const deployRef = this.trafficShaper.selectDeploy(stickyKey);

    if (!deployRef) {
      return Response.json(
        { error: 'ServiceUnavailable', message: 'No active deploys available' },
        { status: 503 }
      );
    }

    // 3. Route based on endpoint kind
    switch (endpoint.kind) {
      case 'computed': {
        if (httpMethod !== 'GET') {
          return Response.json(
            { error: 'InvalidRequest', message: 'Computed endpoints only accept GET requests' },
            { status: 405 }
          );
        }
        const params = extractQueryParams(req);
        return this.router.proxyQuery(methodName, deployRef, params);
      }

      case 'searchIndex': {
        if (httpMethod !== 'GET') {
          return Response.json(
            { error: 'InvalidRequest', message: 'Search endpoints only accept GET requests' },
            { status: 405 }
          );
        }
        const params = extractQueryParams(req);
        return this.router.proxySearch(methodName, deployRef, params);
      }

      case 'function': {
        if (httpMethod !== 'POST') {
          return Response.json(
            { error: 'InvalidRequest', message: 'Function endpoints only accept POST requests' },
            { status: 405 }
          );
        }
        let input: Record<string, unknown> = {};
        try {
          input = (await req.json()) as Record<string, unknown>;
        } catch {
          // Empty body is acceptable for functions with no input
        }
        const authToken = req.headers.get('Authorization')?.replace('Bearer ', '');
        return this.router.proxyFunction(
          methodName,
          deployRef,
          input,
          auth.did,
          authToken
        );
      }

      case 'subscription': {
        if (httpMethod !== 'GET') {
          return Response.json(
            { error: 'InvalidRequest', message: 'Subscription endpoints only accept GET requests' },
            { status: 405 }
          );
        }

        // Check for SSE accept header or WebSocket upgrade
        const acceptHeader = req.headers.get('Accept') ?? '';
        const upgradeHeader = req.headers.get('Upgrade') ?? '';

        if (upgradeHeader.toLowerCase() === 'websocket') {
          // WebSocket upgrade would be handled at the Node HTTP server level.
          // For now, return an error directing clients to use SSE.
          return Response.json(
            {
              error: 'InvalidRequest',
              message: 'WebSocket upgrades are not yet supported. Use Accept: text/event-stream for SSE.',
            },
            { status: 501 }
          );
        }

        if (!acceptHeader.includes('text/event-stream')) {
          return Response.json(
            {
              error: 'InvalidRequest',
              message: 'Subscription endpoints require Accept: text/event-stream header',
            },
            { status: 400 }
          );
        }

        const params = extractQueryParams(req);
        // Generate a subscriber ID from DID or random
        const subscriberId = auth.did ?? `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        return this.router.proxySubscription(
          methodName,
          deployRef,
          params,
          subscriberId
        );
      }

      default: {
        return Response.json(
          { error: 'InternalServerError', message: `Unknown endpoint kind: ${String((endpoint as DeployedEndpoint).kind)}` },
          { status: 500 }
        );
      }
    }
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server = serve(
        {
          fetch: this.app.fetch,
          port: this.config.port,
          hostname: this.config.hostname,
        },
        (info) => {
          this.startedAt = Date.now();
          logger.info(
            `Gateway listening on ${info.address}:${info.port}`
          );
          resolve();
        }
      ) as Server;
    });
  }

  /**
   * Gracefully stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          logger.error('Error stopping server', err);
          reject(err);
        } else {
          logger.info('Gateway stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }
}

/**
 * Extract query parameters from a request URL as a flat Record<string, string>.
 */
function extractQueryParams(req: Request): Record<string, string> {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}
