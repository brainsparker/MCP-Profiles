import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { compileQuery } from "./compile.js";
import { findContextFile, readContextFile } from "./context/read.js";
import { parseHarnessContext } from "./context/parse.js";
import { decompositionRequest, detectMultiHop } from "./decompose.js";
import { populateParams } from "./params.js";
import { postRank } from "./rank.js";
import { SessionMemory } from "./session.js";
import { formatTrace, type Trace } from "./trace.js";
import { Telemetry } from "./telemetry.js";
import type { HarnessContext, SearchHit, SearchParams } from "./types.js";
import { PROJECT_CONTEXT_MAX_BYTES, truncateUtf8 } from "./types.js";
import { VERSION } from "./version.js";
import type { SearchClient } from "./youcom.js";

export interface ServerDeps {
  config: Config;
  client: SearchClient;
  /**
   * "keyed" — direct Search API with the native Product A parameters.
   * "free"  — keyless hosted MCP tier: operators compilation + client-side
   *           rank adjustment carry the context instead (no native params).
   */
  tier: "free" | "keyed";
  telemetry: Telemetry;
  session: SessionMemory;
  now?: () => Date;
}

const SERVER_INSTRUCTIONS = `you-aware makes web search context-aware: it reads the project's CLAUDE.md \
(trusted/blocked sources, decisions ledger, project context) and compiles that context into the query \
and retrieval parameters. Call \`search\` for technical research. You may also populate trusted_sources, \
blocked_sources, project_context, and freshness yourself from your working context — the server merges \
your values with its deterministic file-read (the file-read is the safety net; your values can add \
conversation-level context the file doesn't know about). If \`search\` returns a decomposition_request, \
decompose the question into focused single-intent sub-queries and call \`search\` once per sub-query.`;

const searchDescription = (tier: "free" | "keyed"): string =>
  `Web search over ${
    tier === "keyed" ? "the You.com Search API" : "You.com (hosted free tier)"
  }, tuned to this project's context. \
The server reads CLAUDE.md (Mechanism C), merges it with any parameters you supply, compiles the query \
into lexical form (vocabulary injection, decision-ledger exclusions, source/freshness handling), and \
returns ranked results with an inspectable trace of exactly what ran. Multi-intent queries return a \
decomposition_request instead of results — split them and search per sub-query.`;

function readHarnessContext(config: Config): HarnessContext | null {
  if (!config.readContext) return null;
  const path = findContextFile(config.projectRoot);
  if (!path) return null;
  const raw = readContextFile(path);
  if (raw === null) return null;
  return parseHarnessContext(raw, path);
}

function formatResults(hits: SearchHit[]): string {
  if (hits.length === 0) return "No results.";
  return hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ""}`)
    .join("\n");
}

export function buildServer(deps: ServerDeps): McpServer {
  const { config, telemetry, session } = deps;
  const now = deps.now ?? (() => new Date());

  const server = new McpServer(
    { name: "you-aware", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "search",
    {
      title: "You.com context-aware search",
      description: searchDescription(deps.tier),
      inputSchema: {
        query: z.string().min(1).describe("The search query — natural language or lexical/operator syntax."),
        trusted_sources: z
          .array(z.string())
          .optional()
          .describe("Domains to boost in ranking (e.g. react.dev). Merged with the project's CLAUDE.md list."),
        blocked_sources: z
          .array(z.string())
          .optional()
          .describe("Domains to demote or filter (e.g. w3schools.com). Merged with the project's CLAUDE.md list."),
        project_context: z
          .string()
          .optional()
          .describe(
            "Free-text description of the current project, codebase, or working context (max 4 KB; truncated beyond). " +
              "Overrides the CLAUDE.md-derived context when supplied.",
          ),
        freshness: z
          .enum(["fresh", "stable", "any"])
          .optional()
          .describe('"fresh" prefers recent results, "stable" prefers evergreen, "any" no preference.'),
      },
    },
    async (args): Promise<CallToolResult> => {
      const queryReceived = args.query;
      const dup = session.observe(queryReceived);

      // Multi-hop intents go back to the calling model — the harness's
      // frontier model is the rewriter (§8.2); the MCP never runs its own.
      const hop = detectMultiHop(queryReceived);
      if (hop.multiHop) {
        const request = decompositionRequest(hop.reason!);
        telemetry.record({
          type: "decomposition_request",
          session_id: session.sessionId,
          seq: session.calls,
          ts: now().toISOString(),
          harness: "claude-code",
          query_received: queryReceived,
          tier: deps.tier,
          near_duplicate: dup.nearDuplicate,
          session_duplicate_rate: session.duplicateRate,
          session_calls: session.calls,
        });
        // §9.3: every tool response carries the trace block — nothing was
        // compiled or searched here, and the trace says so inspectably.
        const trace = traceFor(
          queryReceived,
          "",
          { trustedBoost: [], blockedApplied: [], decisionsApplied: [] },
          {},
          [],
          [],
          deps.tier,
        );
        return {
          content: [
            {
              type: "text",
              text: `decomposition_request (${request.reason}):\n${request.instructions}\n\n${formatTrace(trace)}`,
            },
          ],
          structuredContent: { ...request, trace },
        };
      }

      // Mechanism C: deterministic file-read + model-supplied values, merged.
      const fileCtx = readHarnessContext(config);
      const modelParams: SearchParams = {
        trusted_sources: args.trusted_sources,
        blocked_sources: args.blocked_sources,
        project_context:
          args.project_context === undefined
            ? undefined
            : truncateUtf8(args.project_context, PROJECT_CONTEXT_MAX_BYTES),
        freshness: args.freshness,
      };
      const prov = populateParams(fileCtx, modelParams);

      const compiled = compileQuery(queryReceived, prov.final, fileCtx?.decisions ?? [], {
        mode: config.compileMode,
        now: now(),
        freshWindowDays: config.freshWindowDays,
        // The hosted free tool carries freshness natively; its query parser
        // documents no date operators, so never emit after: on the free tier.
        nativeFreshness: deps.tier === "free",
      });

      const baseEvent = {
        session_id: session.sessionId,
        seq: session.calls,
        ts: now().toISOString(),
        harness: "claude-code",
        query_received: queryReceived,
        query_compiled: compiled.query,
        params_file: prov.file,
        params_model: prov.model,
        params_final: prov.final,
        compile_mode: config.compileMode,
        tier: deps.tier,
        context_file_read: fileCtx !== null,
        near_duplicate: dup.nearDuplicate,
        session_duplicate_rate: session.duplicateRate,
        session_calls: session.calls,
      };

      let hits: SearchHit[];
      try {
        hits = await deps.client.search({
          query: compiled.query,
          count: config.count,
          params: prov.final,
          sendNativeParams: config.compileMode !== "operators",
        });
      } catch (err) {
        const message = (err as Error).message;
        telemetry.record({ type: "error", ...baseEvent, error: message.slice(0, 500) });
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Search failed: ${message}\n\n${formatTrace(traceFor(queryReceived, compiled.query, compiled, prov.final, [], [], deps.tier))}`,
            },
          ],
        };
      }

      const ranked = postRank(hits, prov.final.trusted_sources ?? [], prov.final.blocked_sources ?? []);
      const trace = traceFor(queryReceived, compiled.query, compiled, prov.final, ranked.preRankTop3, ranked.postRankTop3, deps.tier);

      telemetry.record({
        type: "search",
        ...baseEvent,
        result_urls: ranked.hits.map((h) => h.url),
      });

      return {
        content: [
          { type: "text", text: `${formatResults(ranked.hits)}\n\n${formatTrace(trace)}` },
        ],
        structuredContent: {
          kind: "results",
          results: ranked.hits,
          trace,
        },
      };
    },
  );

  return server;
}

function traceFor(
  received: string,
  compiledQuery: string,
  compiled: { trustedBoost: string[]; blockedApplied: string[]; decisionsApplied: string[] },
  final: SearchParams,
  pre3: string[],
  post3: string[],
  tier: "free" | "keyed",
): Trace {
  return {
    query_received: received,
    query_compiled: compiledQuery,
    trusted_sources_boost: compiled.trustedBoost,
    blocked_sources_applied: compiled.blockedApplied,
    decisions_applied: compiled.decisionsApplied,
    project_context_chars: final.project_context?.length ?? 0,
    freshness: final.freshness ?? "default",
    pre_rank_top_3: pre3,
    post_rank_top_3: post3,
    tier,
  };
}
