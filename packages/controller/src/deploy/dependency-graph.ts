import { createLogger } from "@avaast/shared";
import type { Dependency, ResourceRef, DeployedEndpoint } from "@avaast/shared";

export interface DependencyNode {
  ref: ResourceRef;
  kind: "computed" | "function" | "searchIndex" | "subscription";
  dependencies: Dependency[];
}

export interface DependencyGraph {
  endpoints: DeployedEndpoint[];
  nodes: Map<string, DependencyNode>; // keyed by "did:cid"
  order: string[]; // topological order for resolution
}

export function refKey(ref: ResourceRef): string {
  return `${ref.did}:${ref.cid}`;
}

export class DependencyGraphBuilder {
  private logger = createLogger("dependency-graph");

  build(
    endpoints: DeployedEndpoint[],
    resolveNode: (ref: ResourceRef) => DependencyNode | undefined
  ): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const visited = new Set<string>();
    const order: string[] = [];

    // BFS from endpoints to discover all transitive dependencies
    const queue: ResourceRef[] = endpoints.map(e => e.ref);

    while (queue.length > 0) {
      const ref = queue.shift()!;
      const key = refKey(ref);

      if (visited.has(key)) continue;
      visited.add(key);

      const node = resolveNode(ref);
      if (!node) {
        this.logger.warn(`Could not resolve node for ${key}`);
        continue;
      }

      nodes.set(key, node);

      // Enqueue dependencies that reference other resources
      for (const dep of node.dependencies) {
        if (dep.ref && dep.kind !== "collection") {
          queue.push(dep.ref);
        }
      }
    }

    // Topological sort
    const tempMarked = new Set<string>();
    const permMarked = new Set<string>();
    const sorted: string[] = [];

    const visit = (key: string) => {
      if (permMarked.has(key)) return;
      if (tempMarked.has(key)) {
        this.logger.warn(`Circular dependency detected at ${key}`);
        return;
      }

      tempMarked.add(key);
      const node = nodes.get(key);
      if (node) {
        for (const dep of node.dependencies) {
          if (dep.ref && dep.kind !== "collection") {
            visit(refKey(dep.ref));
          }
        }
      }
      tempMarked.delete(key);
      permMarked.add(key);
      sorted.push(key);
    };

    for (const key of nodes.keys()) {
      visit(key);
    }

    this.logger.info(
      `Dependency graph: ${nodes.size} nodes, ${endpoints.length} endpoints, resolution order: ${sorted.length} steps`
    );

    return { endpoints, nodes, order: sorted };
  }

  validate(graph: DependencyGraph): string[] {
    const errors: string[] = [];

    // Check all endpoint refs are in the graph
    for (const endpoint of graph.endpoints) {
      const key = refKey(endpoint.ref);
      if (!graph.nodes.has(key)) {
        errors.push(`Endpoint "${endpoint.name}" references unknown resource ${key}`);
      }
    }

    // Check all dependency refs are in the graph
    for (const [key, node] of graph.nodes) {
      for (const dep of node.dependencies) {
        if (dep.ref && dep.kind !== "collection") {
          const depKey = refKey(dep.ref);
          if (!graph.nodes.has(depKey)) {
            errors.push(`Node ${key} depends on unresolved resource ${depKey}`);
          }
        }
        if (dep.kind === "collection" && !dep.collection) {
          errors.push(`Node ${key} has collection dependency "${dep.name}" without collection NSID`);
        }
      }
    }

    return errors;
  }
}
