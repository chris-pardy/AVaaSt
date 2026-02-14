import { parseConfig } from '@avaast/shared';
import type { Config } from '@avaast/shared';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadConfig(configPath?: string): Config {
  let raw: Record<string, unknown> = {};

  // 1. Try configPath if provided, else look for avaast.json in CWD
  if (configPath) {
    const resolved = resolve(configPath);
    if (!existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    raw = JSON.parse(readFileSync(resolved, 'utf-8')) as Record<string, unknown>;
  } else {
    const defaultPath = resolve('avaast.json');
    if (existsSync(defaultPath)) {
      raw = JSON.parse(readFileSync(defaultPath, 'utf-8')) as Record<string, unknown>;
    }
  }

  // 2. Build nested structure, applying env var overrides
  const avaast = (raw.avaast ?? {}) as Record<string, unknown>;
  const server = (raw.server ?? {}) as Record<string, unknown>;
  const execution = (raw.execution ?? {}) as Record<string, unknown>;

  // AVAAST_WATCH_DID -> avaast.watchDid
  if (process.env.AVAAST_WATCH_DID) {
    avaast.watchDid = process.env.AVAAST_WATCH_DID;
  }
  // AVAAST_WATCH_RKEY -> avaast.watchRkey (default "self")
  if (process.env.AVAAST_WATCH_RKEY) {
    avaast.watchRkey = process.env.AVAAST_WATCH_RKEY;
  }
  // AVAAST_PDS_ENDPOINT -> avaast.pdsEndpoint
  if (process.env.AVAAST_PDS_ENDPOINT) {
    avaast.pdsEndpoint = process.env.AVAAST_PDS_ENDPOINT;
  }
  // AVAAST_NODE_ID -> avaast.nodeId
  if (process.env.AVAAST_NODE_ID) {
    avaast.nodeId = process.env.AVAAST_NODE_ID;
  }
  // AVAAST_APP_PASSWORD -> avaast.appPassword
  if (process.env.AVAAST_APP_PASSWORD) {
    avaast.appPassword = process.env.AVAAST_APP_PASSWORD;
  }
  // AVAAST_HEARTBEAT_INTERVAL_MS -> avaast.heartbeatIntervalMs
  if (process.env.AVAAST_HEARTBEAT_INTERVAL_MS) {
    avaast.heartbeatIntervalMs = parseInt(process.env.AVAAST_HEARTBEAT_INTERVAL_MS, 10);
  }

  // AVAAST_PORT -> server.port
  if (process.env.AVAAST_PORT) {
    server.port = parseInt(process.env.AVAAST_PORT, 10);
  }
  // AVAAST_CONTROLLER_PORT -> server.controllerPort
  if (process.env.AVAAST_CONTROLLER_PORT) {
    server.controllerPort = parseInt(process.env.AVAAST_CONTROLLER_PORT, 10);
  }
  // AVAAST_HOSTNAME -> server.hostname
  if (process.env.AVAAST_HOSTNAME) {
    server.hostname = process.env.AVAAST_HOSTNAME;
  }

  // AVAAST_MAX_PROCESSES -> execution.maxFunctionProcesses
  if (process.env.AVAAST_MAX_PROCESSES) {
    execution.maxFunctionProcesses = parseInt(process.env.AVAAST_MAX_PROCESSES, 10);
  }
  // AVAAST_FUNCTION_TIMEOUT -> execution.functionTimeout
  if (process.env.AVAAST_FUNCTION_TIMEOUT) {
    execution.functionTimeout = parseInt(process.env.AVAAST_FUNCTION_TIMEOUT, 10);
  }
  // AVAAST_FUNCTION_MEMORY -> execution.functionMemoryLimit
  if (process.env.AVAAST_FUNCTION_MEMORY) {
    execution.functionMemoryLimit = parseInt(process.env.AVAAST_FUNCTION_MEMORY, 10);
  }

  // 3. Validate with parseConfig (zod) and return typed Config
  return parseConfig({
    avaast,
    server,
    execution,
  });
}
