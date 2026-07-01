import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { compileQuery } from "./compile.js";
import { findContextSource, readContextSource } from "./context/read.js";
import { normalizeDomain, parseHarnessContext } from "./context/parse.js";
import { decompositionRequest, detectMultiHop } from "./decompose.js";
import { ProjectMemory, type ContextSuggestion } from "./memory.js";
import { populateParams, type ParamProvenance } from "./params.js";
import { domainOf, postRank } from "./rank.js";
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
  /** Per-project retrieval memory (Tier 1, local). Constructed disabled when config.memory is off. */
  memory: ProjectMemory;
  now?: () => Date;
}

const SERVER_INSTRUCTIONS = `you-aware makes web search context-aware: it reads the project's context file — \
AGENTS.md first, then CLAUDE.md, GEMINI.md, .github/copilot-instructions.md, Cursor/Cline/Windsurf rules files — \
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
The server reads the project's context file (AGENTS.md, CLAUDE.md, GEMINI.md, Copilot/Cursor/Cline/Windsurf rules), \
merges it with any parameters you supply, compiles the query \
into lexical form (vocabulary injection, decision-ledger exclusions, source/freshness handling), and \
returns ranked results with an inspectable trace of exactly what ran. Multi-intent queries return a \
decomposition_request instead of results — split them and search per sub-query.`;

function readHarnessContext(config: Config): HarnessContext | null {
  if (!config.readContext) return null;
  const resolved = findContextSource(config.projectRoot);
  if (!resolved) return null;
  const raw = readContextSource(resolved);
  if (raw === null) return null;
  const ctx = parseHarnessContext(raw, resolved.paths[0]!, {
    headFallback: config.contextHeadFallback,
  });
  ctx.source = resolved.sourceId;
  return ctx;
}

/**
 * Tier 2 error events carry a status line, never upstream response bodies.
 * The clients put bodies on line 2+ (youcom.ts/hostedClient.ts); the status
 * match is a second fence in case an unknown error shape sneaks body content
 * onto line 1.
 */
function sanitizeError(message: string): string {
  const firstLine = message.split("\n")[0]!;
  const status = /^(You\.com .*?error(?: \d{3})?(?: \(rate limited\))?)/.exec(firstLine);
  return (status ? status[1]! : firstLine).slice(0, 200);
}

/**
 * §8.3: file-derived project_context enters Tier 2 events only when it came
 * from an explicit `## Project Context` section — content the developer
 * authored for this purpose. The top-of-file fallback is raw file head, which
 * is Tier 1; telemetry gets its source label and length instead. The search
 * call itself is unaffected (prov.final is used there unredacted).
 */
function telemetrySafeParams(
  prov: ParamProvenance,
  fileCtx: HarnessContext | null,
): {
  params_file: SearchParams;
  params_model: SearchParams;
  params_final: SearchParams;
  project_context_source: "section" | "model" | "file-head" | "none";
  project_context_chars: number;
} {
  const fileHead = Boolean(fileCtx?.projectContext) && !fileCtx?.projectContextExplicit;
  const strip = (p: SearchParams): SearchParams => {
    const { project_context: _tier1, ...rest } = p;
    return rest;
  };
  const source = prov.model.project_context
    ? "model"
    : prov.file.project_context
      ? fileHead
        ? "file-head"
        : "section"
      : "none";
  return {
    params_file: fileHead ? strip(prov.file) : prov.file,
    params_model: prov.model,
    params_final: source === "file-head" ? strip(prov.final) : prov.final,
    project_context_source: source,
    project_context_chars: prov.final.project_context?.length ?? 0,
  };
}

/**
 * Remove vocabulary-injected terms from a compiled query, exactly reversing
 * compile.ts's two insertion shapes: an unquoted stack term prepended to the
 * front, and quoted terms appended as ` "term"`.
 */
function stripInjectedTerms(query: string, injected: string[]): string {
  let safe = query;
  for (const term of injected) {
    if (safe.startsWith(`${term} `)) safe = safe.slice(term.length + 1);
    else safe = safe.replace(` "${term}"`, "");
  }
  return safe;
}

/** Suggestions block appended after the trace so text-only clients see it too. */
function formatSuggestions(suggestions: ContextSuggestion[]): string {
  if (suggestions.length === 0) return "";
  return (
    "\n\ncontext_suggestions:\n" +
    suggestions.map((s) => `  - add "${s.line}" to ${s.section} (${s.evidence})`).join("\n")
  );
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

  // Queries already bounced as multi-hop this session (see the search handler).
  const bouncedQueries = new Set<string>();

  /**
   * Reconcile per-project memory against the freshly-read context file:
   * record acceptances (a suggested domain now in the file), emit the
   * suggestion telemetry, and return what's worth proposing to the agent now.
   */
  const reconcileMemory = (fileCtx: HarnessContext | null): ContextSuggestion[] => {
    const { suggestions, accepted } = deps.memory.reconcileAndSuggest(
      fileCtx?.trustedSources ?? [],
      fileCtx?.blockedSources ?? [],
    );
    const meta = {
      session_id: session.sessionId,
      seq: session.calls,
      ts: now().toISOString(),
      harness: config.harness,
      tier: deps.tier,
    };
    for (const domain of accepted) {
      telemetry.record({
        type: "suggestion_accepted",
        ...meta,
        suggestion_domain: domain,
        suggestion_action: "add_trusted_source",
      });
    }
    for (const s of suggestions) {
      telemetry.record({
        type: "suggestion_emitted",
        ...meta,
        suggestion_domain: s.domain,
        suggestion_action: s.action,
        suggestion_cited_count: s.cited,
        suggestion_session_count: s.sessions,
      });
    }
    return suggestions;
  };

  server.registerTool(
    "search",
    {
      title: "You.com context-aware search",
      description: searchDescription(deps.tier),
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(4000)
          .describe("The search query — natural language or lexical/operator syntax."),
        trusted_sources: z
          .array(z.string().max(253))
          .max(50)
          .optional()
          .describe("Domains to boost in ranking (e.g. react.dev). Merged with the project's context-file list."),
        blocked_sources: z
          .array(z.string().max(253))
          .max(50)
          .optional()
          .describe("Domains to demote or filter (e.g. w3schools.com). Merged with the project's context-file list."),
        project_context: z
          .string()
          .optional()
          .describe(
            "Free-text description of the current project, codebase, or working context (max 4 KB; truncated beyond). " +
              "Overrides the context-file-derived context when supplied.",
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
      // Bounce each query text at most once per session: a model that
      // retries the same compound query gets results, not a refusal loop.
      const hop = detectMultiHop(queryReceived);
      const bounceKey = queryReceived.trim().toLowerCase();
      if (hop.multiHop && !bouncedQueries.has(bounceKey)) {
        if (bouncedQueries.size >= 200) bouncedQueries.clear();
        bouncedQueries.add(bounceKey);
        const request = decompositionRequest(hop.reason!);
        telemetry.record({
          type: "decomposition_request",
          session_id: session.sessionId,
          seq: session.calls,
          ts: now().toISOString(),
          harness: config.harness,
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

      // Per-project memory: the soft-boost tier (never compiled into the query).
      const memoryPreferred = deps.memory.boostDomains([
        ...(prov.final.trusted_sources ?? []),
        ...(prov.final.blocked_sources ?? []),
      ]);

      const compiled = compileQuery(queryReceived, prov.final, fileCtx?.decisions ?? [], {
        mode: config.compileMode,
        now: now(),
        freshWindowDays: config.freshWindowDays,
        // The hosted free tool carries freshness natively; its query parser
        // documents no date operators, so never emit after: on the free tier.
        nativeFreshness: deps.tier === "free",
      });

      const safeParams = telemetrySafeParams(prov, fileCtx);
      // File-head context (opt-in fallback) is Tier 1 — and vocabulary
      // injection copies its tokens into the compiled query. Telemetry gets
      // the ACTUAL sent query with those injected terms stripped out (a
      // recompile could gate decisions differently and mis-report what ran).
      const safeQueryCompiled =
        safeParams.project_context_source === "file-head"
          ? stripInjectedTerms(compiled.query, compiled.vocabularyInjected)
          : compiled.query;

      const baseEvent = {
        session_id: session.sessionId,
        seq: session.calls,
        ts: now().toISOString(),
        harness: config.harness,
        query_received: queryReceived,
        query_compiled: safeQueryCompiled,
        ...safeParams,
        compile_mode: config.compileMode,
        tier: deps.tier,
        context_file_read: fileCtx !== null,
        context_source: fileCtx?.source,
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
        telemetry.record({ type: "error", ...baseEvent, error: sanitizeError(message) });
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Search failed: ${message}\n\n${formatTrace(traceFor(queryReceived, compiled.query, compiled, prov.final, [], [], [], deps.tier))}`,
            },
          ],
        };
      }

      const ranked = postRank(
        hits,
        prov.final.trusted_sources ?? [],
        prov.final.blocked_sources ?? [],
        memoryPreferred,
      );
      const trace = traceFor(
        queryReceived,
        compiled.query,
        compiled,
        prov.final,
        ranked.preRankTop3,
        ranked.postRankTop3,
        ranked.memoryBoosted,
        deps.tier,
      );

      const shownUrls = ranked.hits.map((h) => h.url);
      session.recordShown(shownUrls);
      deps.memory.recordShown(
        shownUrls.map((u) => domainOf(u)).filter((d): d is string => d !== null),
        session.sessionId,
      );

      // Reconcile/emit suggestions only after a successful search — a
      // suggestion consumed by a failed call would vanish for RESUGGEST_DELTA
      // more citations without ever being seen.
      const contextSuggestions = reconcileMemory(fileCtx);

      telemetry.record({
        type: "search",
        ...baseEvent,
        result_urls: shownUrls,
        memory_boost: ranked.memoryBoosted,
      });

      // The nudge is what makes the memory loop actually close: models don't
      // spontaneously call bookkeeping tools, so every result set carries the ask.
      const nudge = config.memory
        ? "\n\n(after using these results, call report_outcome with the URLs you cited)"
        : "";
      return {
        content: [
          {
            type: "text",
            text: `${formatResults(ranked.hits)}\n\n${formatTrace(trace)}${formatSuggestions(contextSuggestions)}${nudge}`,
          },
        ],
        structuredContent: {
          kind: "results",
          results: ranked.hits,
          trace,
          ...(contextSuggestions.length > 0 ? { context_suggestions: contextSuggestions } : {}),
        },
      };
    },
  );

  if (config.memory) {
    server.registerTool(
      "report_outcome",
      {
        title: "Report which search results you used",
        description:
          "Tell you-aware which result URLs from this session you actually cited or used. " +
          "Feeds the project's local retrieval memory (the store stays on this machine; cited domains " +
          "also appear in Tier 2 telemetry — opt out with YOU_AWARE_TELEMETRY=off): domains that keep " +
          "proving useful get a soft rank boost on future searches and, with enough evidence, a suggested " +
          "`## Trusted Sources` addition to your context file. Call once per task, after using results.",
        inputSchema: {
          cited_urls: z
            .array(z.string().min(1))
            .min(1)
            .max(50)
            .describe("Result URLs (exactly as returned by search this session) that you cited or used."),
          rejected_suggestions: z
            .array(z.string().max(253))
            .max(50)
            .optional()
            .describe("Domains from earlier context_suggestions the developer declined — never suggested again."),
        },
      },
      async (args): Promise<CallToolResult> => {
        // Only URLs actually shown this session count — a misremembered URL
        // must not pump arbitrary domains into the project's memory.
        const cited = args.cited_urls.filter((u) => session.wasShown(u));
        const ignored = args.cited_urls.filter((u) => !session.wasShown(u));
        const domains = [...new Set(cited.map((u) => domainOf(u)).filter((d): d is string => d !== null))];
        deps.memory.recordCited(domains, session.sessionId);

        const dismissed = (args.rejected_suggestions ?? [])
          .map((d) => normalizeDomain(d))
          .filter((d): d is string => d !== null);
        if (dismissed.length > 0) deps.memory.dismiss(dismissed);

        telemetry.record({
          type: "outcome",
          session_id: session.sessionId,
          seq: session.calls,
          ts: now().toISOString(),
          harness: config.harness,
          tier: deps.tier,
          cited_domains: domains,
          cited_count: cited.length,
          ignored_count: ignored.length,
        });

        const suggestions = reconcileMemory(readHarnessContext(config));
        const ack =
          `recorded ${domains.length} domain${domains.length === 1 ? "" : "s"} from ` +
          `${cited.length} cited URL${cited.length === 1 ? "" : "s"}` +
          (ignored.length > 0 ? ` (${ignored.length} ignored — not shown this session)` : "") +
          ".";
        return {
          content: [{ type: "text", text: ack + formatSuggestions(suggestions) }],
          structuredContent: {
            kind: "outcome_ack",
            recorded_domains: domains,
            ignored_urls: ignored,
            ...(suggestions.length > 0 ? { context_suggestions: suggestions } : {}),
          },
        };
      },
    );
  }

  return server;
}

function traceFor(
  received: string,
  compiledQuery: string,
  compiled: { trustedBoost: string[]; blockedApplied: string[]; decisionsApplied: string[] },
  final: SearchParams,
  pre3: string[],
  post3: string[],
  memoryBoost: string[],
  tier: "free" | "keyed",
): Trace {
  return {
    query_received: received,
    query_compiled: compiledQuery,
    trusted_sources_boost: compiled.trustedBoost,
    blocked_sources_applied: compiled.blockedApplied,
    memory_boost: memoryBoost,
    decisions_applied: compiled.decisionsApplied,
    project_context_chars: final.project_context?.length ?? 0,
    freshness: final.freshness ?? "default",
    pre_rank_top_3: pre3,
    post_rank_top_3: post3,
    tier,
  };
}
