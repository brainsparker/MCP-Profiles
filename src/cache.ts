import type { SearchHit } from "./types.js";
import type { SearchRequest } from "./youcom.js";

/**
 * Session result cache: exact-match on the request that would go upstream.
 *
 * Agents repeat themselves. A model that loses context re-asks the question
 * it already asked; a retry loop re-issues the same search several times in
 * a row (one Claude Code report counts 234 search and fetch calls in a
 * single session for information already in the prompt). Each repeat costs
 * a quota unit and, on the free tier, a slice of the 100-per-day allowance.
 *
 * The cache keys on the compiled upstream request, not the natural-language
 * query: two phrasings that compile to the same lexical query with the same
 * parameters are the same search and share one entry. Anything that changes
 * the upstream call (parameters, count, native-vs-operators mode) changes
 * the key, so a cached answer is never returned for a different question.
 *
 * In memory only, bounded by TTL and entry count. The MCP process lives for
 * the harness session, so the session is the cache boundary; nothing is
 * written to disk. Post-rank work (memory boosts, trusted/blocked ordering)
 * still runs on a hit because it is local and cheap; only the upstream call
 * is skipped.
 */

export const DEFAULT_CACHE_TTL_SECONDS = 900;
export const MAX_CACHE_ENTRIES = 200;

export type CacheStatus = "hit" | "miss" | "disabled" | "not_applicable";

interface Entry {
  hits: SearchHit[];
  storedAt: number;
}

export interface CacheLookup {
  status: CacheStatus;
  hits?: SearchHit[];
  /** Seconds since the cached result was fetched (hits only). */
  ageSeconds?: number;
}

export interface SessionCacheOptions {
  enabled: boolean;
  ttlSeconds?: number;
  maxEntries?: number;
  now?: () => Date;
}

/** Stable key: sorted parameter lists, no incidental key order. */
export function cacheKey(req: SearchRequest): string {
  const p = req.params;
  return JSON.stringify({
    q: req.query,
    n: req.count,
    native: req.sendNativeParams,
    t: [...(p.trusted_sources ?? [])].sort(),
    b: [...(p.blocked_sources ?? [])].sort(),
    c: p.project_context ?? "",
    f: p.freshness ?? "",
  });
}

export class SessionCache {
  readonly enabled: boolean;
  readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => Date;
  /** Insertion-ordered; re-inserted on hit so eviction is least recently used. */
  private readonly entries = new Map<string, Entry>();
  private hitCount = 0;
  private missCount = 0;

  constructor(opts: SessionCacheOptions) {
    this.enabled = opts.enabled;
    this.ttlMs = (opts.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
    this.maxEntries = opts.maxEntries ?? MAX_CACHE_ENTRIES;
    this.now = opts.now ?? (() => new Date());
  }

  lookup(req: SearchRequest): CacheLookup {
    if (!this.enabled) return { status: "disabled" };
    const key = cacheKey(req);
    const entry = this.entries.get(key);
    if (!entry) {
      this.missCount++;
      return { status: "miss" };
    }
    const age = this.now().getTime() - entry.storedAt;
    if (age > this.ttlMs) {
      this.entries.delete(key);
      this.missCount++;
      return { status: "miss" };
    }
    // Refresh recency without refreshing age: TTL counts from the fetch.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hitCount++;
    return { status: "hit", hits: entry.hits.map((h) => ({ ...h })), ageSeconds: Math.floor(age / 1000) };
  }

  /** Store a successful upstream result. Failures are never cached. */
  store(req: SearchRequest, hits: SearchHit[]): void {
    if (!this.enabled) return;
    const key = cacheKey(req);
    this.entries.delete(key);
    this.entries.set(key, { hits: hits.map((h) => ({ ...h })), storedAt: this.now().getTime() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get hits(): number {
    return this.hitCount;
  }

  get misses(): number {
    return this.missCount;
  }
}
