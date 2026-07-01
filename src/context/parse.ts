import type { Decision, Freshness, HarnessContext } from "../types.js";
import { PROJECT_CONTEXT_MAX_BYTES, truncateUtf8 } from "../types.js";
import { log } from "../util/logger.js";

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
  // Markdown link: prefer the URL target — only its URL token, so a
  // CommonMark title (`[React](https://react.dev "React docs")`) or an
  // angle-bracketed destination never trips the whitespace check below.
  const link = /\[[^\]]*\]\(\s*<?([^)\s>]+)/.exec(s);
  if (link) s = link[1]!;
  s = s.replace(/^[-*+]\s+/, "").trim();
  s = s.replace(/^<|>$/g, "");
  s = s.replace(/^https?:\/\//i, "");
  // A prose entry ("Node.js official docs") is not a domain — treating its
  // first token as one would compile a recall-destroying filter. Only accept
  // entries that are a single domain/URL token.
  if (/\s/.test(s)) return null;
  s = s.split(/[/?#]/)[0]!;
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

/**
 * A rejected option must look like an identifier (moment.js, styled-components,
 * @tanstack/query) or be backticked in the source line — otherwise "avoid
 * premature optimization" would emit a recall-destroying `-premature` on every
 * optimization query. Single-word packages can be backticked: "Avoid `lodash`".
 */
function identifierShaped(rejected: string, line: string): boolean {
  if (/[@./_\-]|\d/.test(rejected)) return true;
  return line.includes(`\`${rejected}\``);
}

/** Parse one decisions-ledger line into a Decision, or null when no rejection is found. */
export function parseDecisionLine(line: string): Decision | null {
  const trimmed = line.replace(/^([-*+]|\d+[.)])\s+/, "").trim();
  if (!trimmed) return null;
  for (const [i, pattern] of REJECTION_PATTERNS.entries()) {
    const m = pattern.exec(trimmed);
    if (m) {
      const rejected = m[1]!.replace(/[.,;:]+$/, "");
      const exclusionTerm = exclusionTermFor(rejected);
      // A stopword exclusion ("-using", "-the") would devastate recall on
      // engines honoring negation; better to drop the decision than emit it.
      if (!exclusionTerm || STOPWORDS.has(exclusionTerm)) return null;
      // The verb patterns ("avoid X", "X was rejected") also match plain-prose
      // guidance; gate those on identifier shape. "Chose A over B" names a
      // concrete alternative by construction, so it stays ungated.
      if (i < 2 && !identifierShaped(rejected, trimmed)) return null;
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

/**
 * Split a markdown document into heading-delimited sections (any heading
 * level). Fenced code blocks are opaque: a `# comment` inside a ```bash block
 * must not become a section boundary, and a fenced markdown *example* showing
 * `## Blocked Sources` must not inject live parameters.
 */
function splitSections(markdown: string): { sections: Section[]; unclosedFence: boolean } {
  const sections: Section[] = [];
  let current: Section | null = null;
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    if (fence) {
      // A closing fence carries nothing but whitespace after the run
      // (CommonMark: info strings are opening-only), same character, at
      // least as long — otherwise a ```md line inside a ```text block would
      // close the fence and let example headings go live.
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) fence = null;
      if (current) current.body += line + "\n";
      continue;
    }
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = open[1]!;
      if (current) current.body += line + "\n";
      continue;
    }
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (current) sections.push(current);
      current = { heading: h[1]!.trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);
  return { sections, unclosedFence: fence !== null };
}

export interface ParseOptions {
  /**
   * Off by default (§8.3): without an explicit `## Project Context` section,
   * no project_context is derived at all — the file head is raw file content
   * and must not ride the search call unless the developer opts in
   * (YOU_AWARE_CONTEXT_FALLBACK=head).
   */
  headFallback?: boolean;
}

/**
 * Deterministic file-read (§8.2 step 2): parse known section conventions from
 * the harness context file to populate ground-truth parameter values.
 */
export function parseHarnessContext(
  markdown: string,
  filePath: string,
  opts: ParseOptions = {},
): HarnessContext {
  const ctx: HarnessContext = {
    trustedSources: [],
    blockedSources: [],
    decisions: [],
    filePath,
  };

  let explicitProjectContext: string | null = null;

  const { sections, unclosedFence } = splitSections(markdown);
  if (unclosedFence) {
    // Everything after an unclosed ``` is fenced content per CommonMark —
    // sections below it silently vanish. Say so instead of losing parameters
    // with no signal.
    log.warn(
      "context file has an unclosed code fence — sections after it were not parsed. " +
        "Close the fence (```) to restore trusted/blocked/decisions parsing.",
    );
  }

  for (const section of sections) {
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
  } else if (opts.headFallback) {
    // Opt-in fallback: naive top-of-file truncation. Off by default because
    // the head is raw file content, and the search call transmits it.
    const head = truncateUtf8(markdown.trim(), PROJECT_CONTEXT_MAX_BYTES);
    if (head) ctx.projectContext = head;
  }

  return ctx;
}
