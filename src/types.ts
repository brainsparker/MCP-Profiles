/**
 * Shared types for the you-aware MCP.
 *
 * The four optional parameters mirror Product A — the You.com Search API's
 * context-aware parameters (PRD §8.1). The parameter contract is documented in
 * spec/search-parameters.md and is designed to carry forward unchanged.
 */

export type Freshness = "fresh" | "stable" | "any";

/** The four Product A parameters. All optional; all omitted = today's Search API behavior. */
export interface SearchParams {
  /** Domains the caller wants boosted in ranking. */
  trusted_sources?: string[];
  /** Domains the caller wants demoted or filtered. */
  blocked_sources?: string[];
  /** Free-text description of the caller's current project/codebase, capped at 4 KB. */
  project_context?: string;
  /** Whether the caller prefers recent or evergreen results. */
  freshness?: Freshness;
}

/** §8.1: project_context is the only free-text field and is capped at 4 KB. */
export const PROJECT_CONTEXT_MAX_BYTES = 4096;

const utf8 = new TextEncoder();

/**
 * Truncate to at most `maxBytes` of UTF-8, on a code-point boundary. The 4 KB
 * cap is a privacy bound on what leaves the machine (§8.3), so it is denominated
 * in bytes — a UTF-16 .slice() would let multi-byte content exceed it 3x.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8.encode(text).length <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (utf8.encode(text.slice(0, mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  let cut = text.slice(0, lo);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** A decisions-ledger entry parsed from harness context (§8.2). */
export interface Decision {
  /** The raw ledger line, e.g. "Rejected moment.js in favor of date-fns (bundle size)". */
  line: string;
  /** The rejected option, e.g. "moment.js". */
  rejected: string;
  /** Lexical exclusion term derived from the rejected option, e.g. "moment". */
  exclusionTerm: string;
  /** Content tokens of the line (minus the rejected term) used to gate relevance to a query. */
  topicTokens: string[];
}

/** Everything Mechanism C's deterministic file-read extracts from the harness context file. */
export interface HarnessContext {
  trustedSources: string[];
  blockedSources: string[];
  decisions: Decision[];
  projectContext?: string;
  freshness?: Freshness;
  /**
   * Absolute path of the file that was read. Tier 1 (§8.3): file paths never
   * leave the machine — this field must never be copied into telemetry events.
   */
  filePath: string;
}

/** One ranked result from the You.com Search API. */
export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}
