import type { ResourceRef, DeployedEndpoint } from "../types/lexicon.js";
import type { DeployState, DeployStatus } from "../types/deploy.js";
import type {
  FunctionExecutionRequest,
  FunctionExecutionResult,
} from "../types/function.js";

// ===== Controller API (called by Gateway) =====

// POST /internal/query
export interface QueryRequest {
  endpointName: string;
  deployRef: ResourceRef;
  params: Record<string, string>;
}

export interface QueryResponse {
  results: unknown[];
  cached: boolean;
  durationMs: number;
}

// POST /internal/function
export interface FunctionCallRequest {
  endpointName: string;
  deployRef: ResourceRef;
  input: Record<string, unknown>;
  callerDid?: string;
  authToken?: string;
}

export interface FunctionCallResponse {
  output: Record<string, unknown>;
  durationMs: number;
}

// POST /internal/search
export interface SearchRequest {
  endpointName: string;
  deployRef: ResourceRef;
  params: Record<string, string>;
}

export interface SearchResponse {
  results: unknown[];
  totalCount?: number;
  facets?: Record<string, Array<{ value: string; count: number }>>;
  durationMs: number;
}

// GET /internal/deploy/status
export interface DeployStatusResponse {
  deploys: DeployStatus[];
}

// POST /internal/deploy/activate
export interface DeployActivateRequest {
  deployRef: ResourceRef;
}

// GET /internal/endpoints
export interface EndpointsResponse {
  deployRef: ResourceRef;
  endpoints: DeployedEndpoint[];
}

// POST /internal/subscribe
export interface SubscribeRequest {
  endpointName: string;
  deployRef: ResourceRef;
  params: Record<string, string>;
  subscriberId: string;
}

// Subscription notification (pushed from Controller to Gateway via WebSocket)
export interface SubscriptionNotification {
  subscriberId: string;
  endpointName: string;
  data: Record<string, unknown>;
  timestamp: string;
}
