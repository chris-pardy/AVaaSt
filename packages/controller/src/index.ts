import { createLogger } from "@avaast/shared";
import type {
  ResourceRef,
  DeployRecord,
  AppViewRecord,
  ComputedRecord,
  DeployedEndpoint,
  TrafficRule,
  QueryRequest,
  QueryResponse,
} from "@avaast/shared";
import type { DeployManifest, DeployState } from "@avaast/shared";
import { Watcher, type FirehoseEvent } from "./watcher/index.js";
import { DeployOrchestrator } from "./deploy/orchestrator.js";
import { refKey, type DependencyNode } from "./deploy/dependency-graph.js";
import { QueryEngine } from "./query/engine.js";
import { PdsDataSource } from "./query/sources.js";
import { ControllerServer, type QueryResolver } from "./server.js";

export { Watcher, type FirehoseEvent } from "./watcher/index.js";
export { JetstreamClient } from "./watcher/jetstream.js";
export { PdsResolver } from "./watcher/pds-resolver.js";
export { QueryEngine, type QueryEngineOptions } from "./query/engine.js";
export { PdsDataSource, type DataSourceAdapter } from "./query/sources.js";
export { DeployOrchestrator } from "./deploy/orchestrator.js";
export { ControllerServer, type QueryResolver } from "./server.js";

const logger = createLogger("controller");

export interface ControllerOptions {
  pdsEndpoint: string;
  watchDid: string;
  dbPath?: string;
  jetstreamUrl?: string;
  controllerPort?: number;
  gatewayUrl?: string;
  extraCollections?: string[];
}

/**
 * Controller ties together Watcher → DeployOrchestrator → QueryEngine → Server.
 *
 * On event from Jetstream/Watcher:
 * - dev.avaas.computed create → store in computedRecords map
 * - dev.avaas.deploy create → fetch record, process deploy
 * - dev.avaas.appView create/update → extract deploy refs, process, register on gateway
 */
export class Controller {
  private logger = createLogger("controller");
  private watcher: Watcher;
  private orchestrator: DeployOrchestrator;
  private queryEngine: QueryEngine;
  private server: ControllerServer;
  private options: ControllerOptions;

  /** Stored computed records keyed by CID */
  private computedRecords = new Map<string, ComputedRecord>();
  /** Current app view traffic rules */
  private currentTrafficRules: TrafficRule[] = [];
  /** Current app view endpoints */
  private currentEndpoints: DeployedEndpoint[] = [];

  constructor(options: ControllerOptions) {
    this.options = options;

    // Build the PDS data source for queries
    const pdsDataSource = new PdsDataSource({
      listRecords: async (did: string, collection: string, limit?: number) => {
        const pdsUrl = options.pdsEndpoint;
        const url = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&limit=${limit ?? 100}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`listRecords failed: ${resp.status}`);
        const data = (await resp.json()) as {
          records: Array<{ uri: string; cid: string; value: unknown }>;
        };
        return data.records;
      },
    });

    this.queryEngine = new QueryEngine({
      dataSource: pdsDataSource,
      defaultDid: options.watchDid,
    });

    this.orchestrator = new DeployOrchestrator({
      fetcher: {
        getRecord: async (did, collection, rkey) => {
          const url = `${options.pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`getRecord failed: ${resp.status}`);
          return resp.json() as Promise<{ uri: string; cid: string; value: unknown }>;
        },
        getBlob: async (did, cid) => {
          const url = `${options.pdsEndpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`getBlob failed: ${resp.status}`);
          return new Uint8Array(await resp.arrayBuffer());
        },
      },
      onDeployStateChange: (ref, state, manifest) => {
        this.onDeployStateChange(ref, state, manifest);
      },
      nodeResolver: (ref) => this.resolveNode(ref),
    });

    const queryResolver: QueryResolver = async (req: QueryRequest) => {
      return this.resolveQuery(req);
    };

    this.server = new ControllerServer({
      port: options.controllerPort ?? 3001,
      queryResolver,
      getDeployStatus: () => this.orchestrator.getAllDeploys(),
    });

    this.watcher = new Watcher({
      pdsEndpoint: options.pdsEndpoint,
      watchDid: options.watchDid,
      dbPath: options.dbPath ?? ":memory:",
      jetstreamUrl: options.jetstreamUrl,
      extraCollections: options.extraCollections,
      onEvent: (event) => this.handleEvent(event),
      onError: (err) => this.logger.error("Watcher error", err),
    });
  }

  async start(): Promise<void> {
    await this.server.start();
    await this.watcher.start();
    this.logger.info("Controller started");
  }

  async stop(): Promise<void> {
    this.watcher.stop();
    await this.server.stop();
    this.logger.info("Controller stopped");
  }

  /** Expose for tests to check deploy status */
  getOrchestrator(): DeployOrchestrator {
    return this.orchestrator;
  }

  private handleEvent(event: FirehoseEvent): void {
    this.logger.info(
      `Event: ${event.type} ${event.collection} ${event.rkey}`,
    );

    switch (event.collection) {
      case "dev.avaas.computed":
        if (event.type === "create" && event.record && event.cid) {
          this.computedRecords.set(
            event.cid,
            event.record as ComputedRecord,
          );
          this.logger.info(`Stored computed record: ${event.cid}`);
        }
        break;

      case "dev.avaas.deploy":
        if (event.type === "create" && event.record) {
          const deployRef: ResourceRef = {
            did: event.did,
            cid: event.cid ?? "",
          };
          this.orchestrator.processDeploy(
            deployRef,
            event.record as DeployRecord,
          );
        }
        break;

      case "dev.avaas.appView":
        if (
          (event.type === "create" || event.type === "update") &&
          event.record
        ) {
          this.handleAppView(event);
        }
        break;
    }
  }

  private async handleAppView(event: FirehoseEvent): void {
    const appView = event.record as AppViewRecord;
    const deployRefs = this.orchestrator.processAppView(appView);

    // Process any deploys we haven't seen
    for (const ref of deployRefs) {
      const status = this.orchestrator.getDeployStatus(ref);
      if (!status) {
        // Try to fetch the deploy record
        try {
          const uri = `at://${ref.did}/dev.avaas.deploy/self`;
          this.logger.info(`Would fetch deploy for ref ${refKey(ref)}`);
        } catch (err) {
          this.logger.error(`Failed to fetch deploy for ${refKey(ref)}`, err);
        }
      }
    }

    // Store traffic rules and endpoints for gateway registration
    this.currentTrafficRules = appView.trafficRules;

    // Register endpoints on gateway if we have active deploys
    await this.registerOnGateway();
  }

  private async onDeployStateChange(
    ref: ResourceRef,
    state: DeployState,
    manifest?: DeployManifest,
  ): Promise<void> {
    this.logger.info(`Deploy ${refKey(ref)} → ${state}`);

    if (state === "ACTIVE" && manifest) {
      this.currentEndpoints = manifest.endpoints;
      await this.registerOnGateway();
    }
  }

  private async registerOnGateway(): Promise<void> {
    const gatewayUrl = this.options.gatewayUrl;
    if (!gatewayUrl) return;
    if (this.currentEndpoints.length === 0) return;

    try {
      // Register endpoints
      await fetch(`${gatewayUrl}/admin/endpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoints: this.currentEndpoints }),
      });

      // Update traffic rules
      if (this.currentTrafficRules.length > 0) {
        await fetch(`${gatewayUrl}/admin/traffic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: this.currentTrafficRules }),
        });
      }

      this.logger.info(
        `Registered ${this.currentEndpoints.length} endpoints and ${this.currentTrafficRules.length} traffic rules on gateway`,
      );
    } catch (err) {
      this.logger.error("Failed to register on gateway", err);
    }
  }

  private resolveNode(ref: ResourceRef): DependencyNode | undefined {
    const computed = this.computedRecords.get(ref.cid);
    if (computed) {
      return {
        ref,
        kind: "computed",
        dependencies: [],
      };
    }
    return undefined;
  }

  private async resolveQuery(req: QueryRequest): Promise<QueryResponse> {
    // Look up the computed record by the deploy ref's CID
    const manifest = this.orchestrator.getManifest(req.deployRef);
    let query: ComputedRecord["query"] | undefined;

    if (manifest) {
      // Find the endpoint matching the request
      const endpoint = manifest.endpoints.find(
        (e) => e.name === req.endpointName,
      );
      if (endpoint) {
        const computed = this.computedRecords.get(endpoint.ref.cid);
        if (computed) {
          query = computed.query;
        }
      }
    }

    // Fallback: search all computed records
    if (!query) {
      for (const computed of this.computedRecords.values()) {
        if (computed.name === req.endpointName) {
          query = computed.query;
          break;
        }
      }
    }

    if (!query) {
      throw new Error(`No query found for endpoint: ${req.endpointName}`);
    }

    const start = Date.now();
    const result = await this.queryEngine.execute(query, req.params);
    return {
      results: result.results,
      cached: result.cached,
      durationMs: Date.now() - start,
    };
  }
}
