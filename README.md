# you-aware

**Context-aware web search for AI agents — search that already knows what you're working on.**

`you-aware` is an opinionated, installable [MCP](https://modelcontextprotocol.io) server that makes web search measurably better when the caller is an AI agent. It delivers the You.com Search API's context-aware parameters into the agent harnesses developers already use (Claude Code, Cursor, Cline) by reading the harness context the developer has already written — `CLAUDE.md` — and compiling it into the lexical, operator-heavy query language production agents actually speak.

Your agent's harness already knows your trusted sources, your prior decisions, and your stack. The search API call should reflect all of it. With `you-aware`, it does — without configuring a second memory system.

```
"best way to handle date parsing in this project"
        │
        ▼  reads CLAUDE.md · merges model-supplied context · compiles
typescript date parsing "date-fns" -moment        + trusted/blocked/freshness params
        │
        ▼
ranked You.com results + an inspectable trace of exactly what ran
```

## Install

```bash
# Claude Code
claude mcp add you-aware --env YDC_API_KEY=your-key -- npx -y @youdotcom-oss/you-aware

# Cursor (one-click installer) and Cline (marketplace) ship at public GA
```

One command. No account creation. No memory setup. The API key is the same You.com Search API key you already have (or grab at [api.you.com](https://api.you.com)). First retrieval works immediately because your harness context is already in place.

**Data handling, in one sentence:** search queries (received and compiled), populated search parameters, returned result URLs, and outcome signals (e.g. near-duplicate rate) flow to You.com under platform terms to improve agentic retrieval (opt out with `YOU_AWARE_TELEMETRY=off`); your raw `CLAUDE.md`, conversation history, and file paths never leave your machine. Details in [docs/data-handling.md](./docs/data-handling.md).

## What it does

The server exposes **one tool — `search`** — with a `query` plus the four context-aware parameters of the You.com Search API (the durable contract, documented in [spec/search-parameters.md](./spec/search-parameters.md)):

| Parameter | Type | Retrieval mechanic |
|---|---|---|
| `trusted_sources` | `string[]` | per-domain boost at rank time |
| `blocked_sources` | `string[]` | per-domain filter / hard demotion |
| `project_context` | `string` (≤ 4 KB) | context-conditioned ranking + lexical vocabulary injection |
| `freshness` | `"fresh" \| "stable" \| "any"` | recency window tuning |

All parameters are optional. With everything omitted you get exactly today's Search API behavior — no regression.

### Parameter population (Mechanism C)

1. At call time, the server reads your project's `CLAUDE.md` (walking up from the project root).
2. It parses the [documented section conventions](./docs/context-conventions.md) — `## Trusted Sources`, `## Blocked Sources`, `## Decisions`, `## Project Context`, `## Freshness` — into ground-truth parameter values. No structured config required: any `CLAUDE.md` works (top-of-file content becomes `project_context`).
3. The calling model may *also* populate the same parameters from its working context.
4. The final API call uses whichever source produces the higher-quality parameter, with the deterministic file-read as the safety net: source lists are unioned, and a model-supplied `project_context` (which can fold in conversation-level context the file can't see) overrides the file-derived one.
5. Both populated values are logged for ongoing quality measurement.

Opt out of file reading entirely with `YOU_AWARE_READ_CONTEXT=off` (model-population only).

### Query compilation

Context delivers the most value compiled into the query shape the workload actually has — lexical, operator-heavy:

- `project_context` → vocabulary injection: stack disambiguation terms, topically relevant library names, and version numbers appended as quoted terms
- **Decisions ledger** → negative vocabulary: rejected options become exclusion terms (a project that rejected `moment.js` gets `-moment` on date-library queries — and never on queries that mention moment themselves)
- `trusted_sources` → `site:` constraints when narrowing is wanted (`operators` mode), or the boost parameter when recall must be preserved (`auto`, the default)
- `blocked_sources` → negation operators or the filter parameter
- `freshness` → date operators or the freshness parameter

Already-lexical queries (quotes, `site:`, `-term`) pass through untouched — the agent shaped them deliberately.

**Multi-hop queries** get a structured `decomposition_request` back instead of results: the harness's frontier model is the rewriter (it produces sub-queries at zero marginal cost), never a server-side rewriter you pay for.

### The trace

Every response includes an inspectable trace of the NL-to-lexical transformation — developers debug agents constantly, and if you can't see what `you-aware` did, you won't trust it:

```
trace:
  query_received: "best way to handle date parsing in this project"
  query_compiled: "typescript date parsing \"date-fns\" -moment"
  trusted_sources_boost: [react.dev, tanstack.com]
  blocked_sources_applied: [w3schools.com]
  decisions_applied: ["moment.js rejected → -moment"]
  project_context_chars: 1284
  freshness: "stable"
  pre_rank_top_3: [...]
  post_rank_top_3: [...]
```

## Configuration

CLI flag > environment variable > default.

| Flag | Env | Default | Purpose |
|---|---|---|---|
| `--api-key` | `YDC_API_KEY` (or `YOU_API_KEY`) | — | You.com Search API key |
| `--project-root` | `YOU_AWARE_PROJECT_ROOT` | cwd | where to look for `CLAUDE.md` |
| `--no-context-read` | `YOU_AWARE_READ_CONTEXT=off` | on | disable the deterministic file-read |
| `--no-telemetry` | `YOU_AWARE_TELEMETRY=off` | on | opt out of Tier 2 telemetry |
| `--telemetry-url` | `YOU_AWARE_TELEMETRY_URL` | — | remote Tier 2 sink (events always spool locally while telemetry is on) |
| `--telemetry-dir` | `YOU_AWARE_TELEMETRY_DIR` | `~/.you-aware` | where the local Tier 2 JSONL spool lives |
| `--compile-mode` | `YOU_AWARE_COMPILE_MODE` | `auto` | `auto` (native params + query vocabulary) · `operators` (portable `site:`/`-site:`/`after:` compilation) · `native` (params only) |
| `--fresh-window-days` | `YOU_AWARE_FRESH_WINDOW_DAYS` | `180` | recency window compiled from `freshness: fresh` in operators mode |
| `--count` | `YOU_AWARE_COUNT` | `10` | results requested per call |
| `--base-url` | `YOU_API_BASE_URL` | `https://api.ydc-index.io` | Search API endpoint |

A sample `CLAUDE.md` showing all section conventions is in [examples/CLAUDE.md](./examples/CLAUDE.md); a Claude Desktop config in [examples/client-config/claude-desktop.json](./examples/client-config/claude-desktop.json).

## Evaluation

The ablation-controlled eval harness (control passthrough vs. compiled lexical vs. compiled + decomposition) lives in [`eval/`](./eval), with uniform-weight UDCG@K as the primary metric (agents consume all K results — position-discounted metrics mis-measure the workload), plus citation precision/recall@10 and calls-per-task. See [eval/README.md](./eval/README.md).

```bash
YDC_API_KEY=… npm run eval -- --goldset eval/goldset.sample.jsonl --arm all
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (unit + e2e against an in-memory MCP client)
npm run build       # tsup → dist/
npm run inspect     # MCP Inspector against the built server
```

## Status & roadmap

**v1 (this repo):** standalone stdio MCP; four parameters via Mechanism C plus query compilation; decisions-ledger compilation; inspectable trace; two-tier telemetry with near-duplicate-rate baseline collection; ablation eval harness.

**Later:** Cursor-rules / Cline-memory adapters and hosted variant (v2 GA) · `prior_decisions` native parameter, `workflow_stage`, smart `CLAUDE.md` slicing, session anti-loop mechanic GA (v2.1) · multiple retrieval profiles, budget parameters, enterprise source policy (v2.2+).

## License

MIT © Brian Sparker
