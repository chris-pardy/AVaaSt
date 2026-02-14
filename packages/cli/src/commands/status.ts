import { createLogger } from '@avaast/shared';
import type { Config, DeployStatusResponse } from '@avaast/shared';

export async function statusCommand(config: Config): Promise<void> {
  const logger = createLogger('cli');

  const controllerUrl = `http://localhost:${config.server.controllerPort}`;
  const gatewayUrl = `http://localhost:${config.server.port}`;

  // Check gateway health
  try {
    const gwRes = await fetch(`${gatewayUrl}/admin/status`);
    if (gwRes.ok) {
      const gwStatus = (await gwRes.json()) as { endpointCount?: number; uptimeMs?: number };
      console.log('Gateway: HEALTHY');
      console.log(`  Endpoints: ${gwStatus.endpointCount ?? 'unknown'}`);
      console.log(`  Uptime: ${gwStatus.uptimeMs ? Math.floor(gwStatus.uptimeMs / 1000) + 's' : 'unknown'}`);
    } else {
      console.log('Gateway: UNHEALTHY');
    }
  } catch {
    console.log('Gateway: OFFLINE');
  }

  // Check controller health / deploy status
  try {
    const ctrlRes = await fetch(`${controllerUrl}/internal/deploy/status`);
    if (ctrlRes.ok) {
      const status = (await ctrlRes.json()) as DeployStatusResponse;
      console.log('Controller: HEALTHY');
      console.log(`  Active deploys: ${status.deploys.filter(d => d.state === 'ACTIVE').length}`);
      for (const deploy of status.deploys) {
        console.log(`  Deploy ${deploy.ref.cid.slice(0, 12)}... [${deploy.state}]`);
      }
    } else {
      console.log('Controller: UNHEALTHY');
    }
  } catch {
    console.log('Controller: OFFLINE');
  }
}
