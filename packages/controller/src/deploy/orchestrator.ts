import { createLogger } from "@avaast/shared";
import type { ResourceRef, DeployRecord, AppViewRecord } from "@avaast/shared";
import type { DeployState, DeployStatus, DeployManifest } from "@avaast/shared";
import { ManifestBuilder, type RecordFetcher } from "./manifest.js";
import { refKey, type DependencyNode } from "./dependency-graph.js";

export type DeployEventHandler = (deployRef: ResourceRef, state: DeployState, manifest?: DeployManifest) => void;

export interface OrchestratorOptions {
  fetcher: RecordFetcher;
  onDeployStateChange?: DeployEventHandler;
  nodeResolver: (ref: ResourceRef) => DependencyNode | undefined;
  maxActiveDeploys?: number;
}

export class DeployOrchestrator {
  private logger = createLogger("deploy-orchestrator");
  private deploys = new Map<string, DeployStatus>();
  private manifestBuilder = new ManifestBuilder();
  private options: OrchestratorOptions;

  constructor(options: OrchestratorOptions) {
    this.options = options;
  }

  async processDeploy(deployRef: ResourceRef, deployRecord: DeployRecord): Promise<void> {
    const key = refKey(deployRef);
    this.logger.info(`Processing deploy ${key}`);

    this.setState(deployRef, "PENDING");

    try {
      // FETCHING
      this.setState(deployRef, "FETCHING");

      // RESOLVING
      this.setState(deployRef, "RESOLVING");

      // BUILDING
      this.setState(deployRef, "BUILDING");
      const manifest = await this.manifestBuilder.build(
        deployRef,
        deployRecord,
        this.options.fetcher,
        this.options.nodeResolver
      );

      // ACTIVATING
      this.setState(deployRef, "ACTIVATING", manifest);

      // Drain old deploys if at max
      const maxActive = this.options.maxActiveDeploys ?? 2;
      const activeDeploys = Array.from(this.deploys.values())
        .filter(d => d.state === "ACTIVE");

      if (activeDeploys.length >= maxActive) {
        // Drain the oldest
        const oldest = activeDeploys[0];
        if (oldest) {
          this.setState(oldest.ref, "DRAINING");
        }
      }

      // ACTIVE
      this.setState(deployRef, "ACTIVE", manifest);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Deploy ${key} failed: ${msg}`);
      const status = this.deploys.get(key);
      if (status) {
        status.state = "FAILED";
        status.error = msg;
      }
      this.options.onDeployStateChange?.(deployRef, "FAILED");
    }
  }

  async retireDeploy(deployRef: ResourceRef): Promise<void> {
    const key = refKey(deployRef);
    this.setState(deployRef, "DRAINING");
    // In a real impl, wait for in-flight requests to complete
    this.setState(deployRef, "RETIRED");
    this.logger.info(`Deploy ${key} retired`);
  }

  processAppView(appViewRecord: AppViewRecord): ResourceRef[] {
    // Extract deploy refs from traffic rules
    return appViewRecord.trafficRules.map(rule => rule.deploy);
  }

  getDeployStatus(deployRef: ResourceRef): DeployStatus | undefined {
    return this.deploys.get(refKey(deployRef));
  }

  getActiveDeploys(): DeployStatus[] {
    return Array.from(this.deploys.values())
      .filter(d => d.state === "ACTIVE");
  }

  getAllDeploys(): DeployStatus[] {
    return Array.from(this.deploys.values());
  }

  getManifest(deployRef: ResourceRef): DeployManifest | undefined {
    return this.deploys.get(refKey(deployRef))?.manifest;
  }

  private setState(deployRef: ResourceRef, state: DeployState, manifest?: DeployManifest): void {
    const key = refKey(deployRef);
    let status = this.deploys.get(key);

    if (!status) {
      status = { ref: deployRef, state };
      this.deploys.set(key, status);
    }

    status.state = state;
    if (manifest) status.manifest = manifest;
    if (state === "ACTIVE") status.activatedAt = new Date().toISOString();
    if (state === "RETIRED") status.retiredAt = new Date().toISOString();

    this.logger.info(`Deploy ${key}: ${state}`);
    this.options.onDeployStateChange?.(deployRef, state, manifest);
  }
}
