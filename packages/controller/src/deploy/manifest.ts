import { createLogger } from "@avaast/shared";
import type {
  ResourceRef,
  DeployedEndpoint,
  Dependency,
  DeployRecord,
} from "@avaast/shared";
import type { DeployManifest, ResolvedResource } from "@avaast/shared";
import { DependencyGraphBuilder, refKey, type DependencyNode } from "./dependency-graph.js";

export interface RecordFetcher {
  getRecord(did: string, collection: string, rkey: string): Promise<{ uri: string; cid: string; value: unknown }>;
  getBlob(did: string, cid: string): Promise<Uint8Array>;
}

export class ManifestBuilder {
  private logger = createLogger("manifest-builder");
  private graphBuilder = new DependencyGraphBuilder();

  async build(
    deployRef: ResourceRef,
    deployRecord: DeployRecord,
    fetcher: RecordFetcher,
    nodeResolver: (ref: ResourceRef) => DependencyNode | undefined
  ): Promise<DeployManifest> {
    this.logger.info(`Building manifest for deploy ${refKey(deployRef)}`);

    // Build dependency graph
    const graph = this.graphBuilder.build(deployRecord.endpoints, nodeResolver);

    // Validate
    const errors = this.graphBuilder.validate(graph);
    if (errors.length > 0) {
      throw new Error(`Deploy validation failed:\n${errors.join("\n")}`);
    }

    // Resolve all resources
    const resources = new Map<string, ResolvedResource>();

    for (const key of graph.order) {
      const node = graph.nodes.get(key);
      if (!node) continue;

      const resolved: ResolvedResource = {
        ref: node.ref,
        kind: node.kind,
        record: node, // The node itself contains the record data
        dependencies: node.dependencies,
      };

      // Fetch code blobs for functions
      if (node.kind === "function") {
        try {
          const record = node as unknown as { record: { code?: { ref?: { $link: string } } } };
          const codeRef = record.record?.code?.ref?.$link;
          if (codeRef) {
            resolved.codeBlob = await fetcher.getBlob(node.ref.did, codeRef);
          }
        } catch (err) {
          this.logger.warn(`Failed to fetch code blob for ${key}`, err);
        }
      }

      resources.set(key, resolved);
    }

    const manifest: DeployManifest = {
      deployRef,
      version: deployRecord.version,
      endpoints: deployRecord.endpoints,
      resources,
      resolvedAt: new Date().toISOString(),
    };

    this.logger.info(
      `Manifest built: ${resources.size} resources, ${deployRecord.endpoints.length} endpoints`
    );

    return manifest;
  }
}
