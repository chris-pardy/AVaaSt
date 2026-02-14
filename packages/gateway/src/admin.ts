import { Hono } from 'hono';
import type { DeployedEndpoint, TrafficRule } from '@avaast/shared';
import { createLogger } from '@avaast/shared';

const logger = createLogger('admin');

export interface AdminDeps {
  onEndpointsUpdate: (endpoints: DeployedEndpoint[]) => void;
  onTrafficUpdate: (rules: TrafficRule[]) => void;
  getStatus: () => AdminStatus;
}

export interface AdminStatus {
  uptime: number;
  registeredEndpoints: string[];
  trafficRules: ReadonlyArray<TrafficRule>;
}

/**
 * Create the internal admin router for deploy management.
 * These endpoints are called by the Controller or CLI, not by end users.
 */
export function createAdminRouter(deps: AdminDeps): Hono {
  const admin = new Hono();

  /**
   * POST /endpoints - Update registered endpoints.
   * Body: { endpoints: DeployedEndpoint[] }
   */
  admin.post('/endpoints', async (c) => {
    try {
      const body = (await c.req.json()) as { endpoints: DeployedEndpoint[] };

      if (!body.endpoints || !Array.isArray(body.endpoints)) {
        return c.json(
          { error: 'InvalidRequest', message: 'Missing endpoints array' },
          400
        );
      }

      deps.onEndpointsUpdate(body.endpoints);
      logger.info(`Updated endpoints: ${body.endpoints.length} registered`);

      return c.json({ ok: true, count: body.endpoints.length });
    } catch (err) {
      logger.error('Failed to update endpoints', err);
      return c.json(
        { error: 'InternalServerError', message: 'Failed to update endpoints' },
        500
      );
    }
  });

  /**
   * POST /traffic - Update traffic shaping rules.
   * Body: { rules: TrafficRule[] }
   */
  admin.post('/traffic', async (c) => {
    try {
      const body = (await c.req.json()) as { rules: TrafficRule[] };

      if (!body.rules || !Array.isArray(body.rules)) {
        return c.json(
          { error: 'InvalidRequest', message: 'Missing rules array' },
          400
        );
      }

      deps.onTrafficUpdate(body.rules);
      logger.info(`Updated traffic rules: ${body.rules.length} rules`);

      return c.json({ ok: true, count: body.rules.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Failed to update traffic rules', err);
      return c.json(
        { error: 'InvalidRequest', message },
        400
      );
    }
  });

  /**
   * GET /status - Gateway health and status information.
   */
  admin.get('/status', (c) => {
    const status = deps.getStatus();
    return c.json(status);
  });

  return admin;
}
