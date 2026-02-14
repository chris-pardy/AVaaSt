import { createLogger } from "@avaast/shared";
import type { Dependency, ResourceRef } from "@avaast/shared";

export interface DependencyHandles {
  [name: string]: unknown;
}

export interface DependencyResolver {
  resolveComputed(ref: ResourceRef): ComputedProxy;
  resolveFunction(ref: ResourceRef): FunctionProxy;
  resolveSearch(ref: ResourceRef): SearchProxy;
  resolveSubscription(ref: ResourceRef): SubscriptionProxy;
  resolveCollection(collection: string, writeMode: boolean): CollectionProxy;
}

export interface ComputedProxy {
  query(params?: Record<string, unknown>): Promise<unknown[]>;
}

export interface FunctionProxy {
  call(input: Record<string, unknown>): Promise<unknown>;
}

export interface SearchProxy {
  search(params: Record<string, unknown>): Promise<unknown[]>;
}

export interface SubscriptionProxy {
  publish(event: Record<string, unknown>): Promise<void>;
}

export interface CollectionProxy {
  list(params?: { did?: string; limit?: number; cursor?: string }): Promise<unknown[]>;
  get(rkey: string): Promise<unknown>;
  put?(rkey: string, record: unknown): Promise<void>;
  delete?(rkey: string): Promise<void>;
}

export function buildDependencyHandles(
  dependencies: Dependency[],
  resolver: DependencyResolver,
  writeMode: boolean
): DependencyHandles {
  const logger = createLogger("dependency-handles");
  const handles: DependencyHandles = {};

  for (const dep of dependencies) {
    switch (dep.kind) {
      case "computed":
        if (!dep.ref) throw new Error(`Dependency "${dep.name}" of kind "computed" requires a ref`);
        handles[dep.name] = resolver.resolveComputed(dep.ref);
        break;
      case "function":
        if (!dep.ref) throw new Error(`Dependency "${dep.name}" of kind "function" requires a ref`);
        handles[dep.name] = resolver.resolveFunction(dep.ref);
        break;
      case "searchIndex":
        if (!dep.ref) throw new Error(`Dependency "${dep.name}" of kind "searchIndex" requires a ref`);
        handles[dep.name] = resolver.resolveSearch(dep.ref);
        break;
      case "subscription":
        if (!dep.ref) throw new Error(`Dependency "${dep.name}" of kind "subscription" requires a ref`);
        handles[dep.name] = resolver.resolveSubscription(dep.ref);
        break;
      case "collection":
        if (!dep.collection) throw new Error(`Dependency "${dep.name}" of kind "collection" requires a collection`);
        handles[dep.name] = resolver.resolveCollection(dep.collection, writeMode);
        break;
      default:
        logger.warn(`Unknown dependency kind: ${dep.kind} for "${dep.name}"`);
    }
  }

  return handles;
}
