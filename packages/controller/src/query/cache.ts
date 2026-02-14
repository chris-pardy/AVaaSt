import { createLogger } from "@avaast/shared";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  version: string;
}

export class QueryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private logger = createLogger("query-cache");
  private maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string, version: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    if (entry.version !== version) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number, version: string): void {
    if (this.cache.size >= this.maxEntries) {
      this.evict();
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      version,
    });
  }

  invalidateByPrefix(prefix: string): void {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.logger.debug(
        `Invalidated ${count} cache entries with prefix ${prefix}`,
      );
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private evict(): void {
    // Evict expired entries first
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
    // If still too full, evict oldest 10%
    if (this.cache.size >= this.maxEntries) {
      const toEvict = Math.floor(this.maxEntries * 0.1);
      const keys = this.cache.keys();
      for (let i = 0; i < toEvict; i++) {
        const next = keys.next();
        if (next.done) break;
        this.cache.delete(next.value);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }
}
