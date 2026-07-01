import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "./util/logger.js";
import { matchesDomain } from "./rank.js";

/**
 * Per-project retrieval memory: which result domains this project's agent
 * actually cited, accumulated across sessions. Tier 1 (§8.3) — the store, its
 * path, and the project-root hash never leave the machine; only cited domains
 * (already Tier-2-class data as parameters) may appear in telemetry events.
 *
 * The memory closes the write-back loop the companion skill describes: once a
 * domain proves itself across sessions it gets a soft rank boost, and past the
 * suggestion threshold the server proposes a concrete `## Trusted Sources`
 * edit for the agent to apply. The server never edits the context file itself.
 *
 * Concurrency: every operation re-reads the store from disk (it is a few KB),
 * mutates, and writes atomically via a per-writer temp file + rename. Two
 * servers on the same project can still lose individual counts to a
 * read-modify-write race — acceptable — but never clobber each other's whole
 * store with stale in-process state.
 */

/** Soft rank boost once a domain is cited this often across this many sessions. */
export const BOOST_MIN_CITED = 2;
export const BOOST_MIN_SESSIONS = 2;
/** Propose a `## Trusted Sources` edit at this evidence level. */
export const SUGGEST_MIN_CITED = 3;
export const SUGGEST_MIN_SESSIONS = 2;
/** Anti-nag: after a suggestion is emitted, stay silent until this many more citations. */
export const RESUGGEST_DELTA = 5;
/** Store bounds: domains pruned LRU by last_shown_ts; cited-session ids capped per domain. */
export const MAX_DOMAINS = 200;
export const MAX_SESSIONS_TRACKED = 8;
/** Rank-boost list cap — a runaway preferred tier must not reorder the whole page. */
export const MAX_BOOST_DOMAINS = 10;

const SCHEMA_VERSION = 1;

interface DomainStats {
  shown: number;
  cited: number;
  /** Distinct session ids the domain was CITED in (most recent last, capped). */
  sessions: string[];
  last_shown_ts: string;
  last_cited_ts?: string;
}

interface SuggestionRecord {
  status: "emitted" | "dismissed" | "accepted";
  emitted_at: string;
  /** Citation count when last emitted — re-suggest only after RESUGGEST_DELTA more. */
  cited_at_emit: number;
}

export interface MemoryFile {
  version: number;
  domains: Record<string, DomainStats>;
  suggestions: Record<string, SuggestionRecord>;
}

/** A concrete context-file edit the agent can apply verbatim. */
export interface ContextSuggestion {
  action: "add_trusted_source";
  domain: string;
  section: "## Trusted Sources";
  line: string;
  evidence: string;
  cited: number;
  sessions: number;
}

export interface ProjectMemoryOptions {
  enabled: boolean;
  /** Local data root (config.dataDir); the store lives at <dir>/projects/<hash>.json. */
  dir: string;
  projectRoot: string;
  now?: () => Date;
}

export class ProjectMemory {
  readonly enabled: boolean;
  private readonly file: string;
  private readonly now: () => Date;

  constructor(opts: ProjectMemoryOptions) {
    this.enabled = opts.enabled;
    this.now = opts.now ?? (() => new Date());
    const hash = createHash("sha256").update(opts.projectRoot).digest("hex").slice(0, 16);
    this.file = join(opts.dir, "projects", `${hash}.json`);
  }

  /** Record domains the agent was shown this search. Never creates suggestion pressure by itself. */
  recordShown(domains: string[], _sessionId: string): void {
    if (!this.enabled || domains.length === 0) return;
    const data = this.load();
    const ts = this.now().toISOString();
    for (const domain of new Set(domains)) {
      const stats = this.statsFor(data, domain, ts);
      stats.shown++;
      stats.last_shown_ts = ts;
    }
    this.save(data);
  }

  /** Record domains the agent actually cited (validated upstream against shown URLs). */
  recordCited(domains: string[], sessionId: string): void {
    if (!this.enabled || domains.length === 0) return;
    const data = this.load();
    const ts = this.now().toISOString();
    for (const domain of new Set(domains)) {
      const stats = this.statsFor(data, domain, ts);
      stats.cited++;
      stats.last_cited_ts = ts;
      if (!stats.sessions.includes(sessionId)) {
        stats.sessions.push(sessionId);
        if (stats.sessions.length > MAX_SESSIONS_TRACKED) stats.sessions.shift();
      }
    }
    this.save(data);
  }

  /** The developer declined these suggestions — never propose them again. */
  dismiss(domains: string[]): void {
    if (!this.enabled || domains.length === 0) return;
    const data = this.load();
    const ts = this.now().toISOString();
    let dirty = false;
    for (const domain of domains) {
      // Only domains this store has actually seen or suggested — an arbitrary
      // dismissal list must not grow the store unboundedly.
      const existing = data.suggestions[domain];
      if (!existing && !data.domains[domain]) continue;
      data.suggestions[domain] = {
        status: "dismissed",
        emitted_at: existing?.emitted_at ?? ts,
        cited_at_emit: existing?.cited_at_emit ?? 0,
      };
      dirty = true;
    }
    if (dirty) this.save(data);
  }

  /** Domains that earned a soft rank boost, minus anything already covered by `exclude`. */
  boostDomains(exclude: string[]): string[] {
    if (!this.enabled) return [];
    const data = this.load();
    return Object.entries(data.domains)
      .filter(
        ([domain, s]) =>
          s.cited >= BOOST_MIN_CITED &&
          s.sessions.length >= BOOST_MIN_SESSIONS &&
          !exclude.some((e) => matchesDomain(domain, e)),
      )
      .sort((a, b) => b[1].cited - a[1].cited || a[0].localeCompare(b[0]))
      .slice(0, MAX_BOOST_DOMAINS)
      .map(([domain]) => domain);
  }

  /**
   * Reconcile suggestion state against the freshly-read context file and
   * return the suggestions worth (re-)emitting now. A previously suggested
   * domain that now appears in the file's trusted list flips to "accepted"
   * (returned once so the caller can emit its telemetry event).
   */
  reconcileAndSuggest(
    fileTrusted: string[],
    fileBlocked: string[],
  ): { suggestions: ContextSuggestion[]; accepted: string[] } {
    if (!this.enabled) return { suggestions: [], accepted: [] };
    const data = this.load();
    const ts = this.now().toISOString();
    const suggestions: ContextSuggestion[] = [];
    const accepted: string[] = [];
    let dirty = false;

    for (const [domain, record] of Object.entries(data.suggestions)) {
      if (record.status === "emitted" && fileTrusted.some((t) => matchesDomain(domain, t))) {
        record.status = "accepted";
        accepted.push(domain);
        dirty = true;
      }
    }

    for (const [domain, stats] of Object.entries(data.domains)) {
      if (stats.cited < SUGGEST_MIN_CITED || stats.sessions.length < SUGGEST_MIN_SESSIONS) continue;
      if (fileTrusted.some((t) => matchesDomain(domain, t))) continue;
      if (fileBlocked.some((b) => matchesDomain(domain, b))) continue;
      const record = data.suggestions[domain];
      if (record?.status === "dismissed" || record?.status === "accepted") continue;
      if (record?.status === "emitted" && stats.cited < record.cited_at_emit + RESUGGEST_DELTA) continue;
      data.suggestions[domain] = { status: "emitted", emitted_at: ts, cited_at_emit: stats.cited };
      dirty = true;
      suggestions.push({
        action: "add_trusted_source",
        domain,
        section: "## Trusted Sources",
        line: `- ${domain}`,
        evidence: `cited ${stats.cited} ${stats.cited === 1 ? "time" : "times"} across ${stats.sessions.length} sessions`,
        cited: stats.cited,
        sessions: stats.sessions.length,
      });
    }

    if (dirty) this.save(data);
    return { suggestions, accepted };
  }

  private statsFor(data: MemoryFile, domain: string, ts: string): DomainStats {
    let stats = data.domains[domain];
    if (!stats) {
      this.pruneIfFull(data);
      stats = { shown: 0, cited: 0, sessions: [], last_shown_ts: ts };
      data.domains[domain] = stats;
    }
    return stats;
  }

  private pruneIfFull(data: MemoryFile): void {
    const entries = Object.entries(data.domains);
    if (entries.length < MAX_DOMAINS) return;
    entries.sort((a, b) => a[1].last_shown_ts.localeCompare(b[1].last_shown_ts));
    for (const [domain] of entries.slice(0, entries.length - MAX_DOMAINS + 1)) {
      delete data.domains[domain];
      // A dismissal is an explicit developer decision — it survives eviction
      // so the suggestion can never resurrect.
      if (data.suggestions[domain]?.status !== "dismissed") delete data.suggestions[domain];
    }
  }

  /** Always read fresh from disk — concurrent servers share the store. */
  private load(): MemoryFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as MemoryFile;
      if (parsed.version !== SCHEMA_VERSION || typeof parsed.domains !== "object") {
        throw new Error(`unsupported memory schema version ${parsed.version}`);
      }
      return { version: SCHEMA_VERSION, domains: parsed.domains ?? {}, suggestions: parsed.suggestions ?? {} };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("project memory unreadable — starting fresh:", (err as Error).message);
      }
      return { version: SCHEMA_VERSION, domains: {}, suggestions: {} };
    }
  }

  private save(data: MemoryFile): void {
    // Per-writer temp name: a shared .tmp would let two processes interleave
    // write and rename and publish a torn file.
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      // Memory is best-effort local state — a failed save must never fail a search.
      log.warn("project memory save failed:", (err as Error).message);
      try {
        unlinkSync(tmp);
      } catch {
        /* tmp never created */
      }
    }
  }
}
