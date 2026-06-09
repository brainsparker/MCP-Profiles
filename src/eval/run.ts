import { readFileSync } from "node:fs";
import { compileQuery } from "../compile.js";
import { parseDecisionLine } from "../context/parse.js";
import { detectMultiHop } from "../decompose.js";
import { loadConfig } from "../config.js";
import { postRank } from "../rank.js";
import { SessionMemory } from "../session.js";
import type { Decision, SearchParams } from "../types.js";
import { YouComClient } from "../youcom.js";
import { citationPrecisionAtK, citationRecallAtK, ndcgAtK, udcgAtK } from "./metrics.js";

/**
 * v0 lexical-compilation ablation runner (PRD §13). Three arms through the
 * current provider, no API changes:
 *   control               — NL query passthrough
 *   compiled              — MCP-compiled lexical query (operators mode)
 *   compiled+decomposition — compiled, plus pre-supplied sub-queries for
 *                            tasks the multi-hop detector flags (the harness
 *                            model authors sub-queries in production; the
 *                            gold set carries reference sub-queries here)
 *
 * Gold-set tasks are session-shaped (multi-call) per the §10.1 composition
 * requirement. See eval/README.md for the format and methodology.
 */

interface GoldTask {
  id: string;
  queries: string[];
  subqueries?: Record<string, string[]>;
  reference_citations: string[];
  context?: {
    trusted_sources?: string[];
    blocked_sources?: string[];
    project_context?: string;
    freshness?: SearchParams["freshness"];
    decisions?: string[];
  };
}

type Arm = "control" | "compiled" | "compiled+decomposition";

interface ArmResult {
  arm: Arm;
  tasks: number;
  calls: number;
  callsPerTask: number;
  udcgAt10: number;
  /** Reported alongside for continuity, not as a gate (§10.1). */
  ndcgAt10: number;
  citationPrecisionAt10: number;
  citationRecallAt10: number;
  /** Fraction of calls that near-duplicated an earlier query in the same task session. */
  nearDuplicateRate: number;
}

function parseGoldset(path: string): GoldTask[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldTask);
}

async function runArm(arm: Arm, tasks: GoldTask[], k: number): Promise<ArmResult> {
  const config = loadConfig(process.argv.slice(2));
  if (!config.apiKey) throw new Error("YDC_API_KEY required to run the ablation");
  const client = new YouComClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  let calls = 0;
  let nearDup = 0;
  const udcgs: number[] = [];
  const ndcgs: number[] = [];
  const precisions: number[] = [];
  const recalls: number[] = [];

  for (const task of tasks) {
    const params: SearchParams = {
      trusted_sources: task.context?.trusted_sources,
      blocked_sources: task.context?.blocked_sources,
      project_context: task.context?.project_context,
      freshness: task.context?.freshness,
    };
    const decisions: Decision[] = (task.context?.decisions ?? [])
      .map((line) => parseDecisionLine(`- ${line}`))
      .filter((d): d is Decision => d !== null);

    // Each task is one session: the same near-duplicate definition (token
    // Jaccard ≥ 0.8) the runtime telemetry baseline uses, so eval and
    // production measure the same thing under the same metric name.
    const session = new SessionMemory();
    const retrieved: string[] = [];

    let queries = task.queries;
    if (arm === "compiled+decomposition") {
      queries = task.queries.flatMap((q) =>
        detectMultiHop(q).multiHop && task.subqueries?.[q] ? task.subqueries[q]! : [q],
      );
    }

    for (const q of queries) {
      let outbound = q;
      // v0 runs through the current provider with no API changes (§13):
      // context reaches the query via operators only, never native params.
      const useParams = false;
      if (arm !== "control") {
        outbound = compileQuery(q, params, decisions, {
          mode: "operators",
          now: new Date(),
          freshWindowDays: config.freshWindowDays,
        }).query;
      }
      if (session.observe(outbound).nearDuplicate) nearDup++;
      calls++;
      const hits = await client.search({
        query: outbound,
        count: k,
        params,
        sendNativeParams: useParams,
      });
      const ranked =
        arm === "control"
          ? hits
          : postRank(hits, params.trusted_sources ?? [], params.blocked_sources ?? []).hits;
      for (const h of ranked) if (!retrieved.includes(h.url)) retrieved.push(h.url);
    }

    // Gains over the FULL retrieved list: udcgAtK/ndcgAtK normalize against
    // the ideal ordering, so relevant documents ranked beyond K must be
    // visible or the metric degenerates to an any-hit indicator.
    const gains = retrieved.map((u) =>
      citationPrecisionAtK([u], task.reference_citations, 1) > 0 ? 1 : 0,
    );
    udcgs.push(udcgAtK(gains, k));
    ndcgs.push(ndcgAtK(gains, k));
    precisions.push(citationPrecisionAtK(retrieved, task.reference_citations, k));
    recalls.push(citationRecallAtK(retrieved, task.reference_citations, k));
  }

  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    arm,
    tasks: tasks.length,
    calls,
    callsPerTask: tasks.length === 0 ? 0 : calls / tasks.length,
    udcgAt10: mean(udcgs),
    ndcgAt10: mean(ndcgs),
    citationPrecisionAt10: mean(precisions),
    citationRecallAt10: mean(recalls),
    nearDuplicateRate: calls === 0 ? 0 : nearDup / calls,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string, dflt: string): string => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
  };
  const goldsetPath = get("goldset", "eval/goldset.sample.jsonl");
  const k = Number(get("k", "10"));
  const armArg = get("arm", "all");
  const arms: Arm[] =
    armArg === "all" ? ["control", "compiled", "compiled+decomposition"] : [armArg as Arm];

  const tasks = parseGoldset(goldsetPath);
  const results: ArmResult[] = [];
  for (const arm of arms) {
    process.stderr.write(`running arm: ${arm} (${tasks.length} tasks)\n`);
    results.push(await runArm(arm, tasks, k));
  }
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(`eval failed: ${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(1);
});
