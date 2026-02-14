import { createLogger } from "@avaast/shared";
import type { StatusRecord } from "@avaast/shared";
import type { PdsClient } from "./pds-client.js";

const DEFAULT_INTERVAL_MS = 30_000;
const GRACE_FACTOR = 2;

export interface HeartbeatOptions {
  nodeId: string;
  pdsClient: PdsClient;
  intervalMs?: number;
  /** Called each tick to get the CIDs of app view records this node has observed. */
  getAppViewCids?: () => string[];
  /** Software version string included in the status record. */
  version?: string;
}

/**
 * Heartbeat writes a status record to the PDS at a regular interval.
 *
 * Each tick calls `putRecord` for `app.avaast.status` at rkey = nodeId,
 * setting `nextHeartbeatAt` to now + interval + grace so observers know
 * when to expect the next heartbeat. The record includes the CIDs of
 * app view records this node has observed, allowing observers to check
 * whether nodes have reached agreement.
 *
 * Errors are logged but never crash the process.
 */
export class Heartbeat {
  private logger = createLogger("heartbeat");
  private nodeId: string;
  private pdsClient: PdsClient;
  private intervalMs: number;
  private getAppViewCids: () => string[];
  private version?: string;
  private startedAt: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: HeartbeatOptions) {
    this.nodeId = options.nodeId;
    this.pdsClient = options.pdsClient;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.getAppViewCids = options.getAppViewCids ?? (() => []);
    this.version = options.version;
    this.startedAt = new Date().toISOString();
  }

  async start(): Promise<void> {
    this.logger.info(
      `Starting heartbeat for node ${this.nodeId} (interval: ${this.intervalMs}ms)`,
    );
    // Write initial heartbeat immediately
    await this.tick();
    // Then repeat at interval
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error("Heartbeat tick failed", err);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("Heartbeat stopped");
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const nextHeartbeatAt = new Date(
      now.getTime() + this.intervalMs + this.intervalMs * GRACE_FACTOR,
    );

    const appViewCids = this.getAppViewCids();
    const record: StatusRecord = {
      nodeId: this.nodeId,
      nextHeartbeatAt: nextHeartbeatAt.toISOString(),
      startedAt: this.startedAt,
      version: this.version,
      appViewCids: appViewCids.length > 0 ? appViewCids : undefined,
      createdAt: now.toISOString(),
    };

    try {
      await this.pdsClient.putRecord(
        "app.avaast.status",
        this.nodeId,
        record,
      );
      this.logger.debug(
        `Heartbeat written: nextHeartbeatAt=${record.nextHeartbeatAt}, appViewCids=${appViewCids.length}`,
      );
    } catch (err) {
      this.logger.error("Failed to write heartbeat", err);
    }
  }
}
