import type { CacheStatus } from "./cache.js";
import type { Freshness } from "./types.js";

/**
 * The inspectable trace block (PRD §9.3) included in every tool response,
 * covering the NL-to-lexical transformation. Developers debug agents
 * constantly; if they can't see what you-aware did — including how their
 * question became the query that ran — they won't trust it.
 */

export interface Trace {
  query_received: string;
  query_compiled: string;
  trusted_sources_boost: string[];
  blocked_sources_applied: string[];
  /** Domains soft-boosted from per-project memory (cited across prior sessions). */
  memory_boost: string[];
  decisions_applied: string[];
  project_context_chars: number;
  freshness: Freshness | "default";
  pre_rank_top_3: string[];
  post_rank_top_3: string[];
  /** Which retrieval path ran: "free" (hosted keyless tier) or "keyed" (direct Search API). */
  tier: "free" | "keyed";
  /**
   * Whether this result came from the in-session cache ("hit": no upstream
   * call, no quota spent), went upstream ("miss"), or the cache was not in
   * play ("disabled" by config; "not_applicable" when nothing was searched).
   */
  cache: CacheStatus;
  /** Seconds since a cache hit's result was fetched; absent otherwise. */
  cache_age_s?: number;
  /** Searches left today by local count; null when untracked (keyed tier without a budget). */
  budget_remaining: number | null;
}

const quote = (s: string): string => JSON.stringify(s);
const list = (items: string[]): string => `[${items.map((i) => i).join(", ")}]`;

/** Render the trace in the §9.3 YAML-ish debug shape. */
export function formatTrace(t: Trace): string {
  return [
    "trace:",
    `  query_received: ${quote(t.query_received)}`,
    `  query_compiled: ${quote(t.query_compiled)}`,
    `  trusted_sources_boost: ${list(t.trusted_sources_boost)}`,
    `  blocked_sources_applied: ${list(t.blocked_sources_applied)}`,
    `  memory_boost: ${list(t.memory_boost)}`,
    `  decisions_applied: ${list(t.decisions_applied.map(quote))}`,
    `  project_context_chars: ${t.project_context_chars}`,
    `  freshness: ${quote(t.freshness)}`,
    `  pre_rank_top_3: ${list(t.pre_rank_top_3)}`,
    `  post_rank_top_3: ${list(t.post_rank_top_3)}`,
    `  tier: ${quote(t.tier)}`,
    `  cache: ${quote(t.cache)}${t.cache_age_s !== undefined ? ` (${t.cache_age_s}s old)` : ""}`,
    `  budget_remaining: ${t.budget_remaining === null ? "untracked" : t.budget_remaining}`,
  ].join("\n");
}
