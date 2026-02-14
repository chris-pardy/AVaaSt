import type { RuntimeConfig } from "@avaast/shared";

export interface SandboxConfig {
  denoFlags: string[];
  timeoutMs: number;
  memoryMb: number;
}

export function buildSandboxConfig(
  runtime?: RuntimeConfig,
  defaults?: { timeoutMs: number; memoryMb: number }
): SandboxConfig {
  const timeoutMs = runtime?.timeoutMs ?? defaults?.timeoutMs ?? 30000;
  const memoryMb = runtime?.memoryMb ?? defaults?.memoryMb ?? 128;

  return {
    denoFlags: [
      "--deny-env",
      "--deny-sys",
      "--deny-ffi",
      "--deny-run",
      "--deny-write",
      // Network is restricted - only allow PDS hosts, managed by harness
      "--allow-net",
      // Memory limit via V8 flags
      `--v8-flags=--max-old-space-size=${memoryMb}`,
    ],
    timeoutMs,
    memoryMb,
  };
}
