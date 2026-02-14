import { z } from "zod";

export const configSchema = z.object({
  avaast: z.object({
    watchDid: z.string().startsWith("did:"),
    watchRkey: z.string().default("self"),
    pdsEndpoint: z.string().url().optional(),
    nodeId: z.string().optional(),
    appPassword: z.string().optional(),
    heartbeatIntervalMs: z.number().int().min(1000).default(30000),
  }),
  server: z.object({
    port: z.number().int().min(1).max(65535).default(3000),
    controllerPort: z.number().int().min(1).max(65535).default(3001),
    hostname: z.string().optional(),
  }),
  execution: z.object({
    maxFunctionProcesses: z.number().int().min(1).max(32).default(4),
    functionTimeout: z.number().int().min(100).max(30000).default(30000),
    functionMemoryLimit: z.number().int().min(64).max(1024).default(128),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}
