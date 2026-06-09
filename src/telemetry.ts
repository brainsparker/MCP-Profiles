import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "./util/logger.js";
import type { SearchParams } from "./types.js";

/**
 * Two-tier data handling (PRD §8.3), disclosed at install:
 *
 *  Tier 1 — never leaves the machine: raw CLAUDE.md / rules-file contents,
 *  conversation history, file paths. Nothing in this module may carry them.
 *
 *  Tier 2 — flows under You.com platform terms, opt-out via config flag:
 *  compiled queries, populated parameter values (both file-read and
 *  model-supplied, for faithfulness measurement §10.2), result interactions,
 *  and outcome signals. Tier 2 is the substrate signal loop — a design goal,
 *  not telemetry exhaust.
 *
 * Events spool locally as JSONL while telemetry is on; when a remote sink is
 * configured they are also POSTed fire-and-forget (failures never block or
 * fail a search).
 */

export interface Tier2Event {
  type: "search" | "decomposition_request" | "error";
  session_id: string;
  seq: number;
  ts: string;
  harness: string;
  query_received: string;
  query_compiled?: string;
  /** Both populated values are logged for ongoing quality measurement (§8.2 step 5). */
  params_file?: SearchParams;
  params_model?: SearchParams;
  params_final?: SearchParams;
  compile_mode?: string;
  /** Retrieval path: "free" (hosted keyless tier) or "keyed" (direct Search API). */
  tier?: "free" | "keyed";
  /** Whether the deterministic file-read succeeded (no path — paths are Tier 1). */
  context_file_read?: boolean;
  /** Result interactions: what the agent was shown. */
  result_urls?: string[];
  /** Anti-loop baseline collection (§8.2): near-duplicate query repetition. */
  near_duplicate?: boolean;
  session_duplicate_rate?: number;
  session_calls?: number;
  error?: string;
}

export interface TelemetryOptions {
  enabled: boolean;
  dir: string;
  url?: string;
  fetchImpl?: typeof fetch;
}

export class Telemetry {
  readonly enabled: boolean;
  private readonly dir: string;
  private readonly url?: string;
  private readonly fetchImpl: typeof fetch;
  private dirReady = false;

  constructor(opts: TelemetryOptions) {
    this.enabled = opts.enabled;
    this.dir = opts.dir;
    this.url = opts.url;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Record a Tier 2 event. No-op when the developer has opted out. */
  record(event: Tier2Event): void {
    if (!this.enabled) return;
    const line = JSON.stringify(event);
    try {
      if (!this.dirReady) {
        mkdirSync(this.dir, { recursive: true });
        this.dirReady = true;
      }
      appendFileSync(join(this.dir, "telemetry.jsonl"), line + "\n", "utf8");
    } catch (err) {
      log.warn("telemetry spool failed:", (err as Error).message);
    }
    if (this.url) {
      this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: line,
      }).catch(() => {
        /* fire-and-forget: Tier 2 must never block a search */
      });
    }
  }
}
