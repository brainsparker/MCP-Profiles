import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "./util/logger.js";

/**
 * Daily search budget: a local count of upstream search calls per UTC day,
 * surfaced in every trace as `budget_remaining`.
 *
 * Why: the keyless free tier allows about 100 searches per day per IP, and
 * an agent that loops on a question burns that quota silently. Harness-side
 * caps fail the same way (Claude Code's CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION
 * is reported to exhaust without a visible error). you-aware already stands
 * between the model and the quota, so it counts what it spends and tells the
 * model how much is left, before the upstream starts refusing.
 *
 * The count is advisory. you-aware never blocks a search on its own count:
 * the upstream quota is authoritative (it may reset at a different hour, or
 * be shared across machines behind one IP), so a stale local count must not
 * turn a working search into a refusal. What the budget does is make the
 * spend visible, warn when it runs low, and, when the upstream does say
 * "rate limited", pin the local count to exhausted so every later trace
 * that day says 0 instead of a number that is wrong.
 *
 * Tier 1 (data-handling.md): the store holds a day stamp and a counter,
 * nothing else. It lives at <data dir>/budget.json, machine-wide rather than
 * per project, because the quota it tracks is per IP, not per project.
 */

/** Documented free-tier allowance: about 100 queries per day per IP. */
export const FREE_TIER_DAILY_BUDGET = 100;
/** Warn in the response once this few searches remain (or 10% of the limit, whichever is larger). */
export const LOW_BUDGET_WARN_AT = 10;

const SCHEMA_VERSION = 1;

interface BudgetFile {
  version: number;
  /** UTC day the counter belongs to, YYYY-MM-DD. */
  day: string;
  used: number;
  /** Set when the upstream reported a quota rejection this day. */
  exhausted?: boolean;
}

export interface BudgetStatus {
  /** Upstream calls counted today (attempts, including ones that failed). */
  used: number;
  /** Configured daily limit; null when tracking is off (keyed tier without a budget). */
  limit: number | null;
  /** Searches left today by local count; null when untracked. Never negative. */
  remaining: number | null;
  /** True once the upstream rejected a call for quota this day. */
  exhausted: boolean;
  /** ISO timestamp of the next UTC midnight, when the local count resets. */
  resets_at: string;
}

export interface SearchBudgetOptions {
  /** Daily limit; undefined disables tracking entirely. */
  limit?: number;
  /** Local data root (config.dataDir); the counter lives at <dir>/budget.json. */
  dir: string;
  now?: () => Date;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnight(d: Date): string {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.toISOString();
}

export class SearchBudget {
  readonly limit: number | null;
  private readonly file: string;
  private readonly now: () => Date;

  constructor(opts: SearchBudgetOptions) {
    this.limit = opts.limit ?? null;
    this.file = join(opts.dir, "budget.json");
    this.now = opts.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return this.limit !== null;
  }

  /** Count one upstream call. Call before the request goes out so failures count too. */
  consume(): BudgetStatus {
    if (!this.enabled) return this.status();
    const data = this.load();
    data.used++;
    this.save(data);
    return this.toStatus(data);
  }

  /**
   * The upstream said no for quota reasons: whatever the local count
   * believed, the day's budget is gone. Later traces say 0 until reset.
   */
  markExhausted(): BudgetStatus {
    if (!this.enabled) return this.status();
    const data = this.load();
    data.exhausted = true;
    data.used = Math.max(data.used, this.limit!);
    this.save(data);
    return this.toStatus(data);
  }

  status(): BudgetStatus {
    return this.toStatus(this.enabled ? this.load() : this.fresh());
  }

  /**
   * One-line warning for the response text when the budget is running low,
   * or null when there is nothing to say. Advisory: searches still run.
   */
  warning(status: BudgetStatus = this.status()): string | null {
    if (status.limit === null || status.remaining === null) return null;
    const threshold = Math.max(LOW_BUDGET_WARN_AT, Math.ceil(status.limit * 0.1));
    if (status.exhausted) {
      return (
        `budget: the upstream rejected a search for quota today (${status.used} of ${status.limit} counted); ` +
        `further searches may fail until ${status.resets_at}. Prefer the results you already have.`
      );
    }
    if (status.remaining === 0) {
      return (
        `budget: ${status.limit} of ${status.limit} daily searches used by local count; the next call may be ` +
        `rejected upstream (resets ${status.resets_at}). Prefer the results you already have.`
      );
    }
    if (status.remaining <= threshold) {
      return (
        `budget: ${status.remaining} of ${status.limit} daily searches left (resets ${status.resets_at}). ` +
        `Repeated identical queries are served from the session cache and cost nothing.`
      );
    }
    return null;
  }

  private toStatus(data: BudgetFile): BudgetStatus {
    const limit = this.limit;
    return {
      used: data.used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - data.used),
      exhausted: data.exhausted === true,
      resets_at: nextUtcMidnight(this.now()),
    };
  }

  private fresh(): BudgetFile {
    return { version: SCHEMA_VERSION, day: utcDay(this.now()), used: 0 };
  }

  /** Always read fresh from disk: several servers on one machine share the quota, so they share the file. */
  private load(): BudgetFile {
    const today = utcDay(this.now());
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as BudgetFile;
      if (parsed.version !== SCHEMA_VERSION || typeof parsed.used !== "number" || typeof parsed.day !== "string") {
        throw new Error(`unsupported budget schema version ${parsed.version}`);
      }
      // A new UTC day resets the count; an old file is just history.
      if (parsed.day !== today) return this.fresh();
      return { version: SCHEMA_VERSION, day: today, used: Math.max(0, parsed.used), exhausted: parsed.exhausted };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("search budget unreadable, starting fresh:", (err as Error).message);
      }
      return this.fresh();
    }
  }

  private save(data: BudgetFile): void {
    // Per-writer temp name plus rename, same as the project memory store:
    // two servers must never publish a torn file.
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      // The budget is advisory local state; a failed save must never fail a search.
      log.warn("search budget save failed:", (err as Error).message);
      try {
        unlinkSync(tmp);
      } catch {
        /* tmp never created */
      }
    }
  }
}

/** Upstream error shapes that mean "quota", from youcom.ts and hostedClient.ts. */
const QUOTA_ERROR = /(\b429\b|rate limited|rate.?limit reached|quota)/i;

/** Did this search failure come from the upstream refusing for quota reasons? */
export function isQuotaError(message: string): boolean {
  return QUOTA_ERROR.test(message.split("\n")[0]!);
}
