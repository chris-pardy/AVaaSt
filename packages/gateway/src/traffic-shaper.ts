import type { TrafficRule, ResourceRef } from '@avaast/shared';
import { createLogger } from '@avaast/shared';

const logger = createLogger('traffic-shaper');

const TOTAL_BASIS_POINTS = 10000;

/**
 * Weighted random selection for routing requests between deploy versions.
 * Weights are expressed in basis points (0-10000) where 10000 = 100%.
 */
export class TrafficShaper {
  private rules: TrafficRule[] = [];

  /**
   * Update the routing rules. Rules must sum to exactly 10000 basis points.
   * Rules are stored sorted by weight descending for efficient selection.
   */
  updateRules(rules: TrafficRule[]): void {
    if (rules.length === 0) {
      this.rules = [];
      logger.info('Traffic rules cleared');
      return;
    }

    const total = rules.reduce((sum, r) => sum + r.weight, 0);
    if (total !== TOTAL_BASIS_POINTS) {
      throw new Error(
        `Traffic rules must sum to ${TOTAL_BASIS_POINTS} basis points, got ${total}`
      );
    }

    for (const rule of rules) {
      if (rule.weight < 0 || rule.weight > TOTAL_BASIS_POINTS) {
        throw new Error(
          `Traffic rule weight must be between 0 and ${TOTAL_BASIS_POINTS}, got ${rule.weight}`
        );
      }
    }

    // Sort by weight descending for efficient selection
    this.rules = [...rules].sort((a, b) => b.weight - a.weight);
    logger.info('Traffic rules updated', {
      ruleCount: this.rules.length,
      deploys: this.rules.map((r) => ({
        did: r.deploy.did,
        cid: r.deploy.cid,
        weight: r.weight,
      })),
    });
  }

  /**
   * Select a deploy to route a request to.
   * If stickyKey is provided, the selection is deterministic based on the key hash.
   * Otherwise, weighted random selection based on basis points.
   * Returns null if no rules are configured.
   */
  selectDeploy(stickyKey?: string): ResourceRef | null {
    if (this.rules.length === 0) {
      return null;
    }

    if (this.rules.length === 1) {
      return this.rules[0].deploy;
    }

    const value = stickyKey !== undefined
      ? hashToRange(stickyKey)
      : Math.floor(Math.random() * TOTAL_BASIS_POINTS);

    let cumulative = 0;
    for (const rule of this.rules) {
      cumulative += rule.weight;
      if (value < cumulative) {
        return rule.deploy;
      }
    }

    // Fallback to last rule (should not happen if rules sum to 10000)
    return this.rules[this.rules.length - 1].deploy;
  }

  /**
   * Get the current rules (read-only).
   */
  getRules(): ReadonlyArray<TrafficRule> {
    return this.rules;
  }
}

/**
 * Simple hash function that maps a string to a number in [0, 10000).
 * Uses DJB2 hash algorithm.
 */
function hashToRange(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  // Ensure positive and map to [0, 10000)
  return ((hash >>> 0) % TOTAL_BASIS_POINTS);
}
