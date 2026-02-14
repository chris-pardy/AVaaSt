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
  const avaas = (raw.avaas ?? {}) as Record<string, unknown>;
  const server = (raw.server ?? {}) as Record<string, unknown>;
  const execution = (raw.execution ?? {}) as Record<string, unknown>;

  // AVAAS_WATCH_DID -> avaas.watchDid
  if (process.env.AVAAS_WATCH_DID) {
    avaas.watchDid = process.env.AVAAS_WATCH_DID;
  }
  // AVAAS_WATCH_RKEY -> avaas.watchRkey (default "self")
  if (process.env.AVAAS_WATCH_RKEY) {
    avaas.watchRkey = process.env.AVAAS_WATCH_RKEY;
  }
  // AVAAS_PDS_ENDPOINT -> avaas.pdsEndpoint
  if (process.env.AVAAS_PDS_ENDPOINT) {
    avaas.pdsEndpoint = process.env.AVAAS_PDS_ENDPOINT;
  }

  // AVAAS_PORT -> server.port
  if (process.env.AVAAS_PORT) {
    server.port = parseInt(process.env.AVAAS_PORT, 10);
  }
  // AVAAS_CONTROLLER_PORT -> server.controllerPort
  if (process.env.AVAAS_CONTROLLER_PORT) {
    server.controllerPort = parseInt(process.env.AVAAS_CONTROLLER_PORT, 10);
  }
  // AVAAS_HOSTNAME -> server.hostname
  if (process.env.AVAAS_HOSTNAME) {
    server.hostname = process.env.AVAAS_HOSTNAME;
  }

  // AVAAS_MAX_PROCESSES -> execution.maxFunctionProcesses
  if (process.env.AVAAS_MAX_PROCESSES) {
    execution.maxFunctionProcesses = parseInt(process.env.AVAAS_MAX_PROCESSES, 10);
  }
  // AVAAS_FUNCTION_TIMEOUT -> execution.functionTimeout
  if (process.env.AVAAS_FUNCTION_TIMEOUT) {
    execution.functionTimeout = parseInt(process.env.AVAAS_FUNCTION_TIMEOUT, 10);
  }
  // AVAAS_FUNCTION_MEMORY -> execution.functionMemoryLimit
  if (process.env.AVAAS_FUNCTION_MEMORY) {
    execution.functionMemoryLimit = parseInt(process.env.AVAAS_FUNCTION_MEMORY, 10);
  }

  // 3. Validate with parseConfig (zod) and return typed Config
  return parseConfig({
    avaas,
    server,
    execution,
  });
}
