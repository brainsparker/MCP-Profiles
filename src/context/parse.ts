import type { Decision, Freshness, HarnessContext } from "../types.js";
import { PROJECT_CONTEXT_MAX_BYTES, truncateUtf8 } from "../types.js";

/**
 * Section conventions for harness-context files (PRD §8.2 / §14.2). These are
 * documented in docs/context-conventions.md so developers can opt into
 * ground-truth parameter population; everything else falls back to naive
 * top-of-file truncation for project_context (a documented v1 limitation —
 * smart slicing is v2.1, §8.4).
 */
const SECTION_MATCHERS: Record<string, RegExp> = {
  trusted: /^trusted\s+sources$/i,
  blocked: /^blocked\s+sources$/i,
  decisions: /^decisions(\s+ledger)?$/i,
  projectContext: /^project\s+context$/i,
  freshness: /^freshness$/i,
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "nor", "with", "without", "this",
  "that", "these", "those", "is", "are", "was", "were", "be", "been", "being",
  "in", "on", "at", "to", "of", "by", "as", "it", "its", "we", "our", "you",
  "your", "they", "their", "from", "into", "over", "under", "use", "uses",
  "using", "used", "do", "does", "did", "not", "no", "never", "always", "all",
  "any", "some", "can", "should", "must", "will", "would", "may", "might",
  "have", "has", "had", "favor", "instead", "because", "rejected", "avoid",
  "prefer", "preferred", "chose", "choose", "picked", "selected", "decided",
  "decision", "how", "what", "which", "when", "where", "why", "who", "best",
  "way", "ways", "project", "projects",
]);

/** Lowercased content tokens: stopwords and short tokens removed. */
export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@./_-]+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Normalize a source entry to a bare domain: accepts raw domains, URLs, and
 * markdown links. Returns null for anything that doesn't look like a domain.
 */
export function normalizeDomain(entry: string): string | null {
  let s = entry.trim();
  // Markdown link: prefer the URL target.
  const link = /\[[^\]]*\]\(([^)]+)\)/.exec(s);
  if (link) s = link[1]!;
  s = s.replace(/^[-*+]\s+/, "").trim();
  s = s.replace(/^<|>$/g, "");
  s = s.replace(/^https?:\/\//i, "");
  s = s.split(/[/?#\s]/)[0]!;
  s = s.replace(/^www\./i, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

/** Pull list entries out of a section body: bullets, numbered items, or comma lists. */
function listEntries(body: string): string[] {
  const entries: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const stripped = line.replace(/^([-*+]|\d+[.)])\s+/, "");
    for (const part of stripped.split(",")) {
      const p = part.trim();
      if (p) entries.push(p);
    }
  }
  return entries;
}

const REJECTION_PATTERNS: RegExp[] = [
  // Filler tokens after the rejection verb ("avoid using X", "don't use the X")
  // are consumed so the capture lands on the rejected option itself.
  /(?:rejected|avoid|do\s+not\s+use|don'?t\s+use|never\s+use|no\s+more)\s+(?:(?:using|the|a|an|any|all|of)\s+)*`?([@a-z0-9][\w@./-]*)`?/i,
  /`?([@a-z0-9][\w@./-]*)`?\s+(?:was\s+|is\s+)?(?:rejected|banned|deprecated\s+here)/i,
  /(?:chose|picked|selected|prefer(?:red)?)\s+\S+\s+over\s+(?:(?:using|the)\s+)*`?([@a-z0-9][\w@./-]*)`?/i,
];

/**
 * Derive the lexical exclusion term from a rejected option (§8.2: a project
 * that rejected moment.js gets -moment on date-library queries).
 */
export function exclusionTermFor(rejected: string): string {
  let name = rejected.toLowerCase();
  if (name.startsWith("@")) name = name.slice(1).split("/")[0]!;
  name = name.replace(/\.(js|ts|py|rb|go)$/, "");
  name = name.replace(/[^\w-]+$/g, "");
  return name;
}

/** Parse one decisions-ledger line into a Decision, or null when no rejection is found. */
export function parseDecisionLine(line: string): Decision | null {
  const trimmed = line.replace(/^([-*+]|\d+[.)])\s+/, "").trim();
  if (!trimmed) return null;
  for (const pattern of REJECTION_PATTERNS) {
    const m = pattern.exec(trimmed);
    if (m) {
      const rejected = m[1]!.replace(/[.,;:]+$/, "");
      const exclusionTerm = exclusionTermFor(rejected);
      // A stopword exclusion ("-using", "-the") would devastate recall on
      // engines honoring negation; better to drop the decision than emit it.
      if (!exclusionTerm || STOPWORDS.has(exclusionTerm)) return null;
      const rejectedTokens = new Set(contentTokens(rejected).concat(exclusionTerm));
      const topicTokens = contentTokens(trimmed).filter((t) => !rejectedTokens.has(t));
      return { line: trimmed, rejected, exclusionTerm, topicTokens };
    }
  }
  return null;
}

interface Section {
  heading: string;
  body: string;
}

/** Split a markdown document into heading-delimited sections (any heading level). */
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of markdown.split("\n")) {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (current) sections.push(current);
      current = { heading: h[1]!.trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Mechanism C step 2 (§8.2): parse known section conventions from the harness
 * context file to populate ground-truth parameter values.
 */
export function parseHarnessContext(markdown: string, filePath: string): HarnessContext {
  const ctx: HarnessContext = {
    trustedSources: [],
    blockedSources: [],
    decisions: [],
    filePath,
  };

  let explicitProjectContext: string | null = null;

  for (const section of splitSections(markdown)) {
    const { heading, body } = section;
    if (SECTION_MATCHERS.trusted!.test(heading)) {
      for (const entry of listEntries(body)) {
        const d = normalizeDomain(entry);
        if (d && !ctx.trustedSources.includes(d)) ctx.trustedSources.push(d);
      }
    } else if (SECTION_MATCHERS.blocked!.test(heading)) {
      for (const entry of listEntries(body)) {
        const d = normalizeDomain(entry);
        if (d && !ctx.blockedSources.includes(d)) ctx.blockedSources.push(d);
      }
    } else if (SECTION_MATCHERS.decisions!.test(heading)) {
      for (const line of body.split("\n")) {
        const decision = parseDecisionLine(line);
        if (decision) ctx.decisions.push(decision);
      }
    } else if (SECTION_MATCHERS.projectContext!.test(heading)) {
      explicitProjectContext = body.trim();
    } else if (SECTION_MATCHERS.freshness!.test(heading)) {
      const m = /\b(fresh|stable|any)\b/i.exec(body);
      if (m) ctx.freshness = m[1]!.toLowerCase() as Freshness;
    }
  }

  ctx.projectContextExplicit = Boolean(explicitProjectContext);
  if (explicitProjectContext) {
    ctx.projectContext = truncateUtf8(explicitProjectContext, PROJECT_CONTEXT_MAX_BYTES);
  } else {
    // Fallback: naive top-of-file truncation (§11 risk, documented; smart slicing is v2.1).
    const head = truncateUtf8(markdown.trim(), PROJECT_CONTEXT_MAX_BYTES);
    if (head) ctx.projectContext = head;
  }

  return ctx;
}
