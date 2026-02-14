import type { ResourceRef } from "./lexicon.js";

export interface FunctionInput {
  [key: string]: unknown;
}

export interface FunctionOutput {
  [key: string]: unknown;
}

export interface FunctionExecutionRequest {
  functionRef: ResourceRef;
  input: FunctionInput;
  callerDid?: string;
  authToken?: string; // only for write-mode functions
}

export interface FunctionExecutionResult {
  output: FunctionOutput;
  durationMs: number;
}

export interface FunctionExecutionError {
  code: string;
  message: string;
  durationMs: number;
}

// Dependency handles that get injected into functions
export interface ComputedHandle {
  query(params?: Record<string, unknown>): Promise<unknown[]>;
}

export interface FunctionHandle {
  call(input: Record<string, unknown>): Promise<unknown>;
}

export interface SearchHandle {
  search(params: Record<string, unknown>): Promise<unknown[]>;
}

export interface SubscriptionHandle {
  publish(event: Record<string, unknown>): Promise<void>;
}

export interface CollectionHandle {
  list(params?: {
    did?: string;
    limit?: number;
    cursor?: string;
  }): Promise<unknown[]>;
  get(rkey: string): Promise<unknown>;
  // Only available for write-mode functions
  put?(rkey: string, record: unknown): Promise<void>;
  delete?(rkey: string): Promise<void>;
}

export type DependencyHandle =
  | ComputedHandle
  | FunctionHandle
  | SearchHandle
  | SubscriptionHandle
  | CollectionHandle;
