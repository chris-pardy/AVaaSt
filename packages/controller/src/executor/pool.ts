import { spawn } from "node:child_process";
import { createLogger } from "@avaast/shared";
import type { Dependency, RuntimeConfig } from "@avaast/shared";
import { buildSandboxConfig, type SandboxConfig } from "./sandbox.js";
import { generateHarness } from "./harness.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface FunctionExecRequest {
  code: string;
  input: Record<string, unknown>;
  dependencies: Dependency[];
  runtime?: RuntimeConfig;
  callerDid?: string;
  authToken?: string;
  writeMode: boolean;
}

export interface FunctionExecResult {
  output: Record<string, unknown>;
  durationMs: number;
}

export interface FunctionExecError {
  code: string;
  message: string;
  durationMs: number;
}

export interface PoolOptions {
  maxProcesses: number;
  controllerBaseUrl: string;
  functionTimeout: number;
  functionMemoryLimit: number;
  workDir: string;
}

export class FunctionPool {
  private logger = createLogger("function-pool");
  private activeCount = 0;
  private queue: Array<{
    request: FunctionExecRequest;
    resolve: (result: FunctionExecResult) => void;
    reject: (error: FunctionExecError) => void;
  }> = [];
  private options: PoolOptions;
  private harnessPath: string | null = null;

  constructor(options: PoolOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    await mkdir(this.options.workDir, { recursive: true });
    const harness = generateHarness(this.options.controllerBaseUrl);
    this.harnessPath = join(this.options.workDir, "harness.ts");
    await writeFile(this.harnessPath, harness, "utf-8");
    this.logger.info(`Function pool initialized (max: ${this.options.maxProcesses})`);
  }

  async execute(request: FunctionExecRequest): Promise<FunctionExecResult> {
    return new Promise((resolve, reject) => {
      if (this.activeCount < this.options.maxProcesses) {
        this.runProcess(request, resolve, reject);
      } else {
        this.queue.push({ request, resolve, reject });
        this.logger.debug(`Queued function execution (queue size: ${this.queue.length})`);
      }
    });
  }

  private async runProcess(
    request: FunctionExecRequest,
    resolve: (result: FunctionExecResult) => void,
    reject: (error: FunctionExecError) => void
  ): Promise<void> {
    this.activeCount++;
    const startTime = Date.now();

    const sandboxConfig = buildSandboxConfig(request.runtime, {
      timeoutMs: this.options.functionTimeout,
      memoryMb: this.options.functionMemoryLimit,
    });

    try {
      const result = await this.spawnDeno(request, sandboxConfig);
      const durationMs = Date.now() - startTime;

      if (result.error) {
        reject({ ...result.error, durationMs });
      } else {
        resolve({ output: result.output ?? {}, durationMs });
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      reject({
        code: "PROCESS_ERROR",
        message: err instanceof Error ? err.message : String(err),
        durationMs,
      });
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.activeCount < this.options.maxProcesses) {
      const next = this.queue.shift()!;
      this.runProcess(next.request, next.resolve, next.reject);
    }
  }

  private spawnDeno(
    request: FunctionExecRequest,
    sandbox: SandboxConfig
  ): Promise<{ output?: Record<string, unknown>; error?: { code: string; message: string } }> {
    return new Promise((resolve, reject) => {
      if (!this.harnessPath) {
        reject(new Error("Pool not initialized"));
        return;
      }

      const args = ["run", ...sandbox.denoFlags, this.harnessPath];
      const child = spawn("deno", args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: sandbox.timeoutMs,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout?.on("data", (data: Buffer) => stdout.push(data));
      child.stderr?.on("data", (data: Buffer) => stderr.push(data));

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf-8");
        const errOutput = Buffer.concat(stderr).toString("utf-8");

        if (code !== 0) {
          this.logger.error(`Deno process exited with code ${code}`, errOutput);
          resolve({
            error: {
              code: "EXIT_ERROR",
              message: errOutput || `Process exited with code ${code}`,
            },
          });
          return;
        }

        try {
          const parsed = JSON.parse(output);
          resolve(parsed);
        } catch {
          resolve({
            error: {
              code: "PARSE_ERROR",
              message: `Failed to parse output: ${output.substring(0, 500)}`,
            },
          });
        }
      });

      // Send the request to stdin
      const payload = JSON.stringify({
        code: request.code,
        input: request.input,
        dependencies: request.dependencies,
        callerDid: request.callerDid,
        authToken: request.authToken,
        writeMode: request.writeMode,
      });

      child.stdin?.write(payload);
      child.stdin?.end();
    });
  }

  get stats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      max: this.options.maxProcesses,
    };
  }
}
