import type { ResourceRef, DeployedEndpoint, Dependency } from "./lexicon.js";

export type DeployState =
  | "PENDING"
  | "FETCHING"
  | "RESOLVING"
  | "BUILDING"
  | "ACTIVATING"
  | "ACTIVE"
  | "DRAINING"
  | "RETIRED"
  | "FAILED";

// A resolved resource with all its data fetched
export interface ResolvedResource {
  ref: ResourceRef;
  kind: "computed" | "function" | "searchIndex" | "subscription";
  record: unknown; // The actual record data
  dependencies: Dependency[];
  // For functions, the code blob content
  codeBlob?: Uint8Array;
}

// The fully resolved manifest for a deploy
export interface DeployManifest {
  deployRef: ResourceRef;
  version?: string;
  endpoints: DeployedEndpoint[];
  resources: Map<string, ResolvedResource>; // keyed by "did:cid"
  resolvedAt: string;
}

export interface DeployStatus {
  ref: ResourceRef;
  state: DeployState;
  manifest?: DeployManifest;
  error?: string;
  activatedAt?: string;
  retiredAt?: string;
}
