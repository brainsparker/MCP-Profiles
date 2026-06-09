import type { CompileMode } from "./config.js";
import type { Decision, SearchParams } from "./types.js";
import { contentTokens } from "./context/parse.js";

/**
 * Query compilation (PRD §8.2): compile harness context into the lexical,
 * operator-heavy query language production agents already speak. Everything
 * here is zero-marginal-cost mechanics — no model calls (§8.0).
 */

export interface CompileOptions {
  mode: CompileMode;
  now: Date;
  freshWindowDays: number;
}

export interface CompiledQuery {
  query: string;
  /** Domains boosted via the native parameter (and client-side partition). */
  trustedBoost: string[];
  /** True when site: narrowing operators were emitted (operators mode). */
  trustedNarrowed: boolean;
  /** Domains compiled to -site: operators or passed to the native filter. */
  blockedApplied: string[];
  /** Human-readable ledger applications, e.g. "moment.js rejected → -moment". */
  decisionsApplied: string[];
  /** Vocabulary terms injected from project_context. */
  vocabularyInjected: string[];
}

/** Languages/frameworks used as disambiguation terms when found in project context. */
const KNOWN_LANGUAGES = [
  "typescript", "javascript", "python", "rust", "golang", "java", "kotlin",
  "swift", "ruby", "php", "csharp", "scala", "elixir", "haskell",
];
const KNOWN_FRAMEWORKS = [
  "react", "nextjs", "next.js", "vue", "svelte", "angular", "django", "rails",
  "flask", "fastapi", "spring", "laravel", "express", "node", "node.js", "deno", "bun",
];

const INTERROGATIVE_PREFIXES = [
  /^(what('s| is| are)?|how (do|does|can|should|to)( i| we| you)?|why (is|are|does|do)|which|where (is|are|do|can)|who|when)\b/i,
  /^(the )?best (way|ways|approach|practice|practices) (to|of|for)\b/i,
  /^(is|are) there (a|any)\b/i,
];

const QUERY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "do", "does", "did", "i", "we", "you", "it",
  "my", "our", "your", "this", "that", "there", "way", "best", "should",
  "would", "could", "can", "how", "what", "why", "which", "where", "who",
  "when", "handle", "handling", "project", "codebase", "currently", "right",
  "now", "please", "some", "any",
]);

/** Operator-bearing or already-lexical queries pass through untouched (§4: agents speak lexical). */
export function looksLexical(query: string): boolean {
  return /(site:|after:|before:|filetype:|intitle:|inurl:|"|\bOR\b|(^|\s)-\S)/.test(query);
}

/** Reduce a natural-language question to its content keywords. */
export function keywordize(query: string): string {
  let q = query.trim();
  for (const prefix of INTERROGATIVE_PREFIXES) q = q.replace(prefix, "").trim();
  q = q.replace(/\?+$/, "");
  q = q.replace(/\bin (this|my|our) (project|codebase|repo|app|application)\b/gi, "");
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w@"-]+|[^\w@".-]+$/g, ""))
    .filter((t) => t && !QUERY_STOPWORDS.has(t.toLowerCase()));
  if (tokens.length < 2) return query.trim().replace(/\?+$/, "");
  return tokens.join(" ");
}

/** Package-shaped tokens: date-fns, react-router, @tanstack/query, lodash.merge … */
const PACKAGE_TOKEN = /(@[a-z0-9-]+\/[a-z0-9._-]+|\b[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+\b)/g;

interface VocabularyCandidate {
  term: string;
  lineTokens: string[];
}

/** `Name 19.2` / `name@19.2` pairs — version numbers are injected with their library (§8.2). */
const VERSIONED_NAME = /([a-z][a-z0-9.+_-]*)[ @]v?(\d+(?:\.\d+)+)\b/g;

/** TLDs that are never npm-package suffixes; .io/.dev/.ai stay (socket.io, …). */
const UNAMBIGUOUS_TLD = /\.(com|org|net|edu|gov|info|biz)$/;

/** A dotted token is a domain (not a package like lodash.merge) when the line shows it as a URL. */
function looksLikeDomainInLine(term: string, lowerLine: string): boolean {
  if (lowerLine.includes(`//${term}`) || lowerLine.includes(`www.${term}`)) return true;
  return UNAMBIGUOUS_TLD.test(term);
}

/** Extract candidate library/version vocabulary from project context, with per-line topic tokens. */
export function extractVocabulary(projectContext: string): VocabularyCandidate[] {
  const seen = new Set<string>();
  const out: VocabularyCandidate[] = [];
  const push = (term: string, lineTokens: string[]): void => {
    if (seen.has(term)) return;
    seen.add(term);
    out.push({ term, lineTokens });
  };
  for (const line of projectContext.split("\n")) {
    const lineTokens = contentTokens(line);
    const lower = line.toLowerCase();
    for (const m of lower.matchAll(PACKAGE_TOKEN)) {
      const term = m[1]!;
      // Skip version-only tokens, file names (library names like video.js pass), and URLs/domains.
      if (/^\d/.test(term)) continue;
      if (/\.(md|json|yaml|yml|txt|lock|ts|tsx|jsx|mjs|cjs|css|html)$/.test(term)) continue;
      if (/^(e\.g|i\.e)/.test(term)) continue;
      if (term.includes(".") && !term.includes("/") && looksLikeDomainInLine(term, lower)) continue;
      push(term, lineTokens);
    }
    for (const m of lower.matchAll(VERSIONED_NAME)) {
      const name = m[1]!;
      if (name === "version" || name === "v") continue;
      push(`${name} ${m[2]!}`, lineTokens);
    }
  }
  return out;
}

/** First known language/framework mentioned in the project context, if any. */
export function primaryStackTerm(projectContext: string): string | null {
  const tokens = new Set(contentTokens(projectContext));
  for (const lang of KNOWN_LANGUAGES) if (tokens.has(lang)) return lang;
  for (const fw of KNOWN_FRAMEWORKS) if (tokens.has(fw)) return fw;
  return null;
}

const overlaps = (a: string[], b: Set<string>): boolean => a.some((t) => b.has(t));

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compile the received query plus populated parameters into the outbound
 * lexical query. Deterministic; the calling model remains the only rewriter
 * (multi-hop decomposition is returned to the model, never run here).
 */
export function compileQuery(
  received: string,
  params: SearchParams,
  decisions: Decision[],
  opts: CompileOptions,
): CompiledQuery {
  const lexical = looksLexical(received);
  let query = lexical ? received.trim() : keywordize(received);

  const queryTokens = new Set(contentTokens(received).concat(contentTokens(query)));
  const vocabularyInjected: string[] = [];
  const decisionsApplied: string[] = [];

  // project_context → lexical vocabulary injection (§8.2), relevance-gated so
  // unrelated libraries don't pollute the query. Skipped for already-lexical
  // queries (the agent has shaped the query itself) and in native mode (params
  // only, no query-side compilation).
  if (!lexical && opts.mode !== "native" && params.project_context) {
    const stack = primaryStackTerm(params.project_context);
    if (stack && !queryTokens.has(stack)) {
      query = `${stack} ${query}`;
      vocabularyInjected.push(stack);
      queryTokens.add(stack);
    }
    for (const cand of extractVocabulary(params.project_context)) {
      if (vocabularyInjected.length >= 4) break;
      if (queryTokens.has(cand.term)) continue;
      if (!overlaps(cand.lineTokens, queryTokens)) continue;
      query = `${query} "${cand.term}"`;
      vocabularyInjected.push(cand.term);
      queryTokens.add(cand.term);
    }
  }

  // Decisions ledger → negative vocabulary (§8.2), gated on topical overlap
  // with the query so -moment only lands on date-library queries. Never
  // exclude a term the query itself mentions (e.g. "migrate from moment").
  // The mention guard keeps short tokens (qs, ws) that contentTokens drops.
  // Query-side ledger compilation runs in every mode — it is the ledger's
  // only carrier until the prior_decisions native parameter ships (v2.1).
  const mentionTokens = new Set(
    `${received} ${query}`
      .toLowerCase()
      .split(/[^a-z0-9@./_-]+/)
      .filter(Boolean),
  );
  const excluded = new Set<string>();
  for (const d of decisions) {
    if (excluded.size >= 3) break;
    if (excluded.has(d.exclusionTerm)) continue;
    if (mentionTokens.has(d.exclusionTerm) || mentionTokens.has(d.rejected.toLowerCase())) continue;
    if (queryTokens.has(d.exclusionTerm) || queryTokens.has(d.rejected.toLowerCase())) continue;
    if (!overlaps(d.topicTokens, queryTokens)) continue;
    query = `${query} -${d.exclusionTerm}`;
    excluded.add(d.exclusionTerm);
    decisionsApplied.push(`${d.rejected} rejected → -${d.exclusionTerm}`);
  }

  const trusted = params.trusted_sources ?? [];
  const blocked = params.blocked_sources ?? [];
  let trustedNarrowed = false;
  let blockedApplied: string[] = [];

  if (opts.mode === "operators") {
    // Provider-portable compilation: recall-narrowing site: group + negations.
    // Agent-shaped queries may already carry these operators (§4) — never
    // duplicate or contradict what the query itself says.
    const lowerQuery = (): string => query.toLowerCase();
    const hasPositiveSite = /(^|\s|\()site:/.test(lowerQuery());
    // Blocked wins on trusted∩blocked overlap, matching rank-time demotion.
    const narrowable = trusted.filter((d) => !blocked.includes(d));
    if (narrowable.length > 0 && !hasPositiveSite) {
      const group = narrowable.slice(0, 4).map((d) => `site:${d}`).join(" OR ");
      query = narrowable.length > 1 ? `${query} (${group})` : `${query} ${group}`;
      trustedNarrowed = true;
    }
    const negations = blocked.slice(0, 6).filter((d) => !lowerQuery().includes(`site:${d}`));
    for (const d of negations) query = `${query} -site:${d}`;
    blockedApplied = negations;
    if (params.freshness === "fresh" && !/(^|\s)(after|before):/.test(lowerQuery())) {
      const since = new Date(opts.now.getTime() - opts.freshWindowDays * 86_400_000);
      query = `${query} after:${formatDate(since)}`;
    }
  } else {
    // auto/native: the native parameters carry sources and freshness —
    // recall-preserving boost rather than narrowing (§14.7 default).
    blockedApplied = blocked;
  }

  return {
    query,
    trustedBoost: trusted,
    trustedNarrowed,
    blockedApplied,
    decisionsApplied,
    vocabularyInjected,
  };
}
