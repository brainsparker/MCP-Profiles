# you-aware

**Context-aware web search for AI agents — search that already knows what you're working on.**

`you-aware` is an opinionated, installable [MCP](https://modelcontextprotocol.io) server that makes web search measurably better when the caller is an AI agent. It delivers the You.com Search API's context-aware parameters into the agent harnesses developers already use by reading the context the developer has already written — the project's `AGENTS.md` (or `CLAUDE.md`) — and compiling it into the lexical, operator-heavy query language production agents actually speak.

Your agent's harness already knows your trusted sources, your prior decisions, and your stack. The search API call should reflect all of it. With `you-aware`, it does — without configuring a second memory system.

```
"best way to handle date parsing in this project"
        │
        ▼  reads AGENTS.md · merges model-supplied context · compiles
typescript date parsing "date-fns" -moment        + trusted/blocked/freshness params
        │
        ▼
ranked You.com results + an inspectable trace of exactly what ran
```

## Install

The server is a single `npx`-runnable stdio binary — add it to any MCP client. In your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "you-aware": {
      "type": "local",
      "command": ["npx", "-y", "@youdotcom-oss/you-aware"],
      "enabled": true,
      "timeout": 60000,
      "environment": { "YOU_AWARE_HARNESS": "opencode" }
    }
  }
}
```

In Claude Code:

```bash
claude mcp add you-aware -- npx -y @youdotcom-oss/you-aware
```

The same `npx` command works in any MCP client. Full config examples (including the keyed variants) are in [examples/client-config/](./examples/client-config):

| Client | Config file | Example | Context file read |
|---|---|---|---|
| OpenCode | `opencode.json` | [opencode.json](./examples/client-config/opencode.json) | `AGENTS.md` |
| Claude Code | `claude mcp add you-aware -- npx -y @youdotcom-oss/you-aware` | — | `AGENTS.md` / `CLAUDE.md` |
| Claude Desktop | `claude_desktop_config.json` | [claude-desktop.json](./examples/client-config/claude-desktop.json) | `AGENTS.md` / `CLAUDE.md` |
| Codex CLI | `~/.codex/config.toml` | [codex-cli.toml](./examples/client-config/codex-cli.toml) | `AGENTS.md` |
| Cursor | `.cursor/mcp.json` | [cursor.json](./examples/client-config/cursor.json) | `.cursor/rules/*.mdc`, `.cursorrules` |
| Gemini CLI | `.gemini/settings.json` | [gemini-cli.json](./examples/client-config/gemini-cli.json) | `GEMINI.md` |
| Cline | `cline_mcp_settings.json` | [cline.json](./examples/client-config/cline.json) | `.clinerules` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | [windsurf.json](./examples/client-config/windsurf.json) | `.windsurfrules` |
| VS Code / Copilot & anything else | varies | [generic-mcpservers.json](./examples/client-config/generic-mcpservers.json) | `.github/copilot-instructions.md`, `AGENTS.md` |

"Context file read" is what the server falls back to for that client's native convention — `AGENTS.md` (then `CLAUDE.md`) always wins when present, so one `AGENTS.md` serves every client identically. Full discovery order in [docs/context-conventions.md](./docs/context-conventions.md).

One config block (or one command). No account creation. No memory setup. First retrieval works immediately because your project's `AGENTS.md` (or `CLAUDE.md`) is already in place. Without a key, searches run through You.com's hosted free tier (the same keyless tier the official You.com MCP uses — search-only, roughly 100 queries/day, context compiled into the query). Setting `YDC_API_KEY` — the same You.com Search API key you may already have, from [you.com/platform](https://you.com/platform) — switches to the direct Search API with higher limits and the native context parameters. Add it to the `environment` block:

```json
"YDC_API_KEY": "{env:YDC_API_KEY}"
```

(An `{env:…}` reference that's unset in your shell substitutes to an empty string — the server treats it as absent and stays on the free tier. Clients that use the `mcpServers` config shape call this block `"env"` and don't substitute `{env:…}` — put the key itself there. The generous `timeout` covers `npx`'s first-run package download.)

**Data handling, in one sentence:** search queries (received and compiled), populated search parameters (file-derived project context only when authored in an explicit `## Project Context` section), returned result URLs, and outcome signals (e.g. near-duplicate rate) flow to You.com under platform terms to improve agentic retrieval (opt out with `YOU_AWARE_TELEMETRY=off`); your raw context/rules files, conversation history, and file paths never leave your machine. Details in [docs/data-handling.md](./docs/data-handling.md).

### Companion skill

[`skills/you-aware/`](./skills/you-aware) is an [Agent Skill](https://agentskills.io) that teaches an agent both halves of the loop — when and how to call `search`, and how to keep the `AGENTS.md` sections current. Install it by copying the folder into your client's skills directory — project-level `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`, or their global equivalents (`~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`):

```bash
cp -r node_modules/@youdotcom-oss/you-aware/skills/you-aware .opencode/skills/
```

(or copy it straight from this repo). The skill body loads only when relevant — its at-rest cost is one description line.

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

1. At call time, the server reads your project's context file — `AGENTS.md` first, then `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, and Cursor/Cline/Windsurf rules files — walking up from the project root (the nearest directory wins; within a directory, `AGENTS.md` wins).
2. It parses the [documented section conventions](./docs/context-conventions.md) — `## Trusted Sources`, `## Blocked Sources`, `## Decisions`, `## Project Context`, `## Freshness` — into ground-truth parameter values, whatever file they live in. No structured config required: any context file works (top-of-file content becomes `project_context`).
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
  tier: "keyed"
```

## Configuration

CLI flag > environment variable > default.

| Flag | Env | Default | Purpose |
|---|---|---|---|
| `--api-key` | `YDC_API_KEY` (or `YOU_API_KEY`) | — | You.com Search API key; without one, the keyless hosted free tier is used |
| `--hosted-mcp-url` | `YOU_AWARE_HOSTED_MCP_URL` | `https://api.you.com/mcp` | hosted MCP endpoint backing the keyless free tier |
| `--project-root` | `YOU_AWARE_PROJECT_ROOT` | cwd | where to look for the context file (`AGENTS.md`, `CLAUDE.md`, rules files, …) |
| `--harness` | `YOU_AWARE_HARNESS` | `unknown` | harness identifier stamped on Tier 2 telemetry events |
| `--no-context-read` | `YOU_AWARE_READ_CONTEXT=off` | on | disable the deterministic file-read |
| `--no-telemetry` | `YOU_AWARE_TELEMETRY=off` | on | opt out of Tier 2 telemetry |
| `--telemetry-url` | `YOU_AWARE_TELEMETRY_URL` | — | remote Tier 2 sink (events always spool locally while telemetry is on) |
| `--telemetry-dir` | `YOU_AWARE_TELEMETRY_DIR` | `~/.you-aware` | where the local Tier 2 JSONL spool lives |
| `--compile-mode` | `YOU_AWARE_COMPILE_MODE` | `auto` | `auto` (native params + query vocabulary) · `operators` (portable `site:`/`-site:`/`after:` compilation) · `native` (params only). Forced to `operators` on the keyless free tier, which has no native params |
| `--fresh-window-days` | `YOU_AWARE_FRESH_WINDOW_DAYS` | `180` | recency window compiled from `freshness: fresh` in operators mode |
| `--count` | `YOU_AWARE_COUNT` | `10` | results requested per call |
| `--base-url` | `YOU_API_BASE_URL` | `https://api.ydc-index.io` | Search API endpoint |

A sample `AGENTS.md` showing all section conventions is in [examples/AGENTS.md](./examples/AGENTS.md); client configs in [examples/client-config/](./examples/client-config).

## Evaluation

The ablation-controlled eval harness (control passthrough vs. compiled lexical vs. compiled + decomposition) lives in [`eval/`](./eval), with uniform-weight UDCG@K as the primary metric (agents consume all K results — position-discounted metrics mis-measure the workload), plus citation precision/recall@10 and calls-per-task. See [eval/README.md](./eval/README.md).

```bash
YDC_API_KEY=… npm run eval -- --goldset eval/goldset.sample.jsonl --arm all
```

Without `YDC_API_KEY`, the eval runs against the keyless hosted free tier — fine for smoke-testing the sample goldset, but its ~100 queries/day limit will truncate a real run.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (unit + e2e against an in-memory MCP client)
npm run build       # tsup → dist/
npm run inspect     # MCP Inspector against the built server
```

## Status & roadmap

**v1 (this repo):** standalone stdio MCP; four parameters via Mechanism C plus query compilation; decisions-ledger compilation; inspectable trace; two-tier telemetry with near-duplicate-rate baseline collection; ablation eval harness; companion Agent Skill.

**Later:** Cursor-rules / Cline-memory adapters and hosted variant (v2 GA) · `prior_decisions` native parameter, `workflow_stage`, smart context-file slicing, session anti-loop mechanic GA (v2.1) · multiple retrieval profiles, budget parameters, enterprise source policy (v2.2+).

## License

MIT © Brian Sparker
