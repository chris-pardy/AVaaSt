import type {
  DeployedEndpoint,
  ResourceRef,
  QueryRequest,
  QueryResponse,
  FunctionCallRequest,
  FunctionCallResponse,
  SearchRequest,
  SearchResponse,
  SubscribeRequest,
  SubscriptionNotification,
} from '@avaast/shared';
import { createLogger } from '@avaast/shared';

const logger = createLogger('router');

/**
 * XRPC error response format per AT Protocol conventions.
 */
export interface XrpcError {
  error: string;
  message: string;
}

function xrpcError(error: string, message: string): XrpcError {
  return { error, message };
}

/**
 * Dynamic router that manages registered endpoints and proxies
 * requests to the Controller's internal API.
 */
export class DynamicRouter {
  private controllerUrl: string;
  private registeredEndpoints: Map<string, DeployedEndpoint> = new Map();

  constructor(controllerUrl: string) {
    this.controllerUrl = controllerUrl;
  }

  /**
   * Register endpoints from a deploy. Replaces any existing endpoints
   * with the same name.
   */
  registerEndpoints(endpoints: DeployedEndpoint[]): void {
    for (const endpoint of endpoints) {
      this.registeredEndpoints.set(endpoint.name, endpoint);
      logger.info(`Registered endpoint: ${endpoint.name} (${endpoint.kind})`);
    }
  }

  /**
   * Remove endpoints by name.
   */
  unregisterEndpoints(endpointNames: string[]): void {
    for (const name of endpointNames) {
      if (this.registeredEndpoints.delete(name)) {
        logger.info(`Unregistered endpoint: ${name}`);
      }
    }
  }

  /**
   * Look up a registered endpoint by name.
   */
  getEndpoint(name: string): DeployedEndpoint | undefined {
    return this.registeredEndpoints.get(name);
  }

  /**
   * Get all registered endpoint names.
   */
  getEndpointNames(): string[] {
    return Array.from(this.registeredEndpoints.keys());
  }

  /**
   * Proxy a query request to the controller.
   */
  async proxyQuery(
    endpointName: string,
    deployRef: ResourceRef,
    params: Record<string, string>
  ): Promise<Response> {
    const body: QueryRequest = { endpointName, deployRef, params };
    try {
      const resp = await fetch(`${this.controllerUrl}/internal/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        logger.error(`Query proxy error: ${resp.status} ${errorBody}`);
        return Response.json(
          xrpcError('UpstreamFailure', `Controller returned ${resp.status}`),
          { status: resp.status }
        );
      }

      const result = (await resp.json()) as QueryResponse;
      return Response.json(result);
    } catch (err) {
      logger.error('Query proxy failed', err);
      return Response.json(
        xrpcError('InternalServerError', 'Failed to proxy query to controller'),
        { status: 502 }
      );
    }
  }

  /**
   * Proxy a function call to the controller.
   */
  async proxyFunction(
    endpointName: string,
    deployRef: ResourceRef,
    input: Record<string, unknown>,
    callerDid?: string,
    authToken?: string
  ): Promise<Response> {
    const body: FunctionCallRequest = {
      endpointName,
      deployRef,
      input,
      callerDid,
      authToken,
    };
    try {
      const resp = await fetch(`${this.controllerUrl}/internal/function`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        logger.error(`Function proxy error: ${resp.status} ${errorBody}`);
        return Response.json(
          xrpcError('UpstreamFailure', `Controller returned ${resp.status}`),
          { status: resp.status }
        );
      }

      const result = (await resp.json()) as FunctionCallResponse;
      return Response.json(result);
    } catch (err) {
      logger.error('Function proxy failed', err);
      return Response.json(
        xrpcError('InternalServerError', 'Failed to proxy function to controller'),
        { status: 502 }
      );
    }
  }

  /**
   * Proxy a search request to the controller.
   */
  async proxySearch(
    endpointName: string,
    deployRef: ResourceRef,
    params: Record<string, string>
  ): Promise<Response> {
    const body: SearchRequest = { endpointName, deployRef, params };
    try {
      const resp = await fetch(`${this.controllerUrl}/internal/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        logger.error(`Search proxy error: ${resp.status} ${errorBody}`);
        return Response.json(
          xrpcError('UpstreamFailure', `Controller returned ${resp.status}`),
          { status: resp.status }
        );
      }

      const result = (await resp.json()) as SearchResponse;
      return Response.json(result);
    } catch (err) {
      logger.error('Search proxy failed', err);
      return Response.json(
        xrpcError('InternalServerError', 'Failed to proxy search to controller'),
        { status: 502 }
      );
    }
  }

  /**
   * Initiate a subscription with the controller and return an SSE response.
   * The gateway connects to the controller's subscription endpoint and fans
   * out notifications as Server-Sent Events.
   */
  async proxySubscription(
    endpointName: string,
    deployRef: ResourceRef,
    params: Record<string, string>,
    subscriberId: string
  ): Promise<Response> {
    const body: SubscribeRequest = {
      endpointName,
      deployRef,
      params,
      subscriberId,
    };

    try {
      const resp = await fetch(`${this.controllerUrl}/internal/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        logger.error(`Subscribe proxy error: ${resp.status} ${errorBody}`);
        return Response.json(
          xrpcError('UpstreamFailure', `Controller returned ${resp.status}`),
          { status: resp.status }
        );
      }

      // Create an SSE stream that will forward notifications from the controller
      const stream = new ReadableStream({
        start(controller) {
          // Send initial connected event
          const connectMsg = `event: connected\ndata: ${JSON.stringify({ subscriberId })}\n\n`;
          controller.enqueue(new TextEncoder().encode(connectMsg));

          // If the controller response is itself a stream, pipe it through
          if (resp.body) {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();

            function pump(): void {
              reader.read().then(({ done, value }) => {
                if (done) {
                  controller.close();
                  return;
                }
                // Forward raw data from controller as SSE events
                const text = decoder.decode(value, { stream: true });
                try {
                  const notification = JSON.parse(text) as SubscriptionNotification;
                  const sseMsg = `event: notification\ndata: ${JSON.stringify(notification.data)}\nid: ${notification.timestamp}\n\n`;
                  controller.enqueue(new TextEncoder().encode(sseMsg));
                } catch {
                  // If not valid JSON, forward raw text as-is
                  controller.enqueue(value);
                }
                pump();
              }).catch((err) => {
                logger.error('Subscription stream error', err);
                controller.error(err);
              });
            }

            pump();
          } else {
            // No streaming body from controller, close after connect
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (err) {
      logger.error('Subscribe proxy failed', err);
      return Response.json(
        xrpcError('InternalServerError', 'Failed to proxy subscription to controller'),
        { status: 502 }
      );
    }
  }
}
