# you-aware

**Context-aware web search for AI agents — search that already knows what you're working on.**

`you-aware` is an opinionated, installable [MCP](https://modelcontextprotocol.io) server that makes web search context-aware when the caller is an AI agent. It reads the context the developer has already written — the project's `AGENTS.md` (or `CLAUDE.md`, or Cursor/Cline/Windsurf rules) — and compiles it into the lexical, operator-heavy query language production agents actually speak, delivered through the You.com Search API. Every response carries a trace of exactly what ran, and an ablation [eval harness](./eval) ships in the repo so the claim is testable, not vibes: `npm run eval` compares plain passthrough against compiled queries on your own goldset.

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

**Data handling, plainly:** the search call itself carries your query and populated parameters to You.com — that's the product. Everything else stays local: raw context/rules files, conversation history, file paths, and the per-project memory never leave your machine, and file content becomes search context only when you author an explicit `## Project Context` section. Telemetry (queries, parameters, result URLs, outcome signals) is on by default but **ships nowhere out of the box** — it spools to a capped, owner-readable local file, and is only transmitted if you explicitly configure `YOU_AWARE_TELEMETRY_URL`. Turn it off entirely with `YOU_AWARE_TELEMETRY=off`. Full details, including exactly which three source files can emit bytes, in [docs/data-handling.md](./docs/data-handling.md). If you want a fixed dependency, pin the version: `npx -y @youdotcom-oss/you-aware@0.1`.

### Companion skill

[`skills/you-aware/`](./skills/you-aware) is an [Agent Skill](https://agentskills.io) that teaches an agent both halves of the loop — when and how to call `search`, and how to keep the `AGENTS.md` sections current. Install it by copying the folder into your client's skills directory — project-level `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`, or their global equivalents (`~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`):

```bash
cp -r node_modules/@youdotcom-oss/you-aware/skills/you-aware .opencode/skills/
```

(or copy it straight from this repo). The skill body loads only when relevant — its at-rest cost is one description line.

## What it does

The server exposes two tools. **`search`** takes a `query` plus the four context-aware parameters of the You.com Search API (the durable contract, documented in [spec/search-parameters.md](./spec/search-parameters.md)); **`report_outcome`** closes the loop, feeding the [per-project retrieval memory](#retrieval-memory-the-write-back-loop) with the result URLs the agent actually used.

| Parameter | Type | Retrieval mechanic |
|---|---|---|
| `trusted_sources` | `string[]` | per-domain boost at rank time |
| `blocked_sources` | `string[]` | per-domain filter / hard demotion |
| `project_context` | `string` (≤ 4 KB) | context-conditioned ranking + lexical vocabulary injection |
| `freshness` | `"fresh" \| "stable" \| "any"` | recency window tuning |

All parameters are optional. With everything omitted you get exactly today's Search API behavior — no regression.

### Parameter population: deterministic file-read + model merge

1. At call time, the server reads your project's context file — `AGENTS.md` first, then `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, and Cursor/Cline/Windsurf rules files — walking up from the project root (the nearest directory wins; within a directory, `AGENTS.md` wins).
2. It parses [the section conventions this server defines](./docs/context-conventions.md) — `## Trusted Sources`, `## Blocked Sources`, `## Decisions`, `## Project Context`, `## Freshness` — into ground-truth parameter values, whatever file they live in. No structured config required, and no section is: a file with just `## Trusted Sources` already improves ranking. File content becomes free-text search context only from an explicit `## Project Context` section (an opt-in head fallback exists: `YOU_AWARE_CONTEXT_FALLBACK=head`).
3. The calling model may *also* populate the same parameters from its working context.
4. The final API call uses whichever source produces the higher-quality parameter, with the deterministic file-read as the safety net: source lists are unioned, and a model-supplied `project_context` (which can fold in conversation-level context the file can't see) overrides the file-derived one.
5. Both populated values are logged for ongoing quality measurement.

Opt out of file reading entirely with `YOU_AWARE_READ_CONTEXT=off` (model-population only).

### Retrieval memory (the write-back loop)

Reading context makes the first search good; remembering outcomes makes every search after it better. After the agent uses results, it calls `report_outcome` with the URLs it actually cited (every result set carries a one-line reminder, and the [companion skill](#companion-skill) reinforces it). The server keeps per-project domain stats locally — the store never leaves the machine; cited domains appear in telemetry like any other parameter — and puts them to work twice:

- **Soft rank boost:** domains cited in 2+ sessions get a `preferred` tier between your explicit trusted sources and the rest, visible in the trace as `memory_boost`. Memory never touches the query or the native parameters — it is rank-only, reversible, and inspectable.
- **Context-file suggestions:** past 3 citations across 2+ sessions, responses carry a concrete `context_suggestions` edit ("add `- react.dev` to `## Trusted Sources` — cited 4 times across 3 sessions") for the agent to apply. The server never edits your context file itself; a declined suggestion is never repeated, an applied one is detected and goes quiet.

Cited URLs are validated against what search actually returned this session, so a confused agent can't pump arbitrary domains into memory. Opt out with `YOU_AWARE_MEMORY=off`. The store lives under `~/.you-aware/projects/`, keyed by a local hash of the project path ([data handling](./docs/data-handling.md)).

### Query compilation

Context delivers the most value compiled into the query shape the workload actually has — lexical, operator-heavy:

- `project_context` → vocabulary injection: stack disambiguation terms, topically relevant library names, and version numbers appended as quoted terms
- **Decisions ledger** → negative vocabulary: rejected options become exclusion terms (a project that rejected `moment.js` gets `-moment` on date-library queries — and never on queries that mention moment themselves)
- `trusted_sources` → always recall-preserving boost: the native boost parameter in `auto`/`native`, the client-side rank partition in `operators` — never a positive `site:` whitelist (an answer that lives off your trusted domains must still be findable)
- `blocked_sources` → `-site:` negation operators or the filter parameter
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
  memory_boost: [blog.example.com]
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
| `--context-fallback head` | `YOU_AWARE_CONTEXT_FALLBACK=head` | off | opt in: without a `## Project Context` section, send the top 4 KB of the context file as `project_context` |
| `--no-memory` | `YOU_AWARE_MEMORY=off` | on | disable per-project retrieval memory (boosts, suggestions, `report_outcome`) |
| `--data-dir` | `YOU_AWARE_DATA_DIR` | telemetry dir | where the local (Tier 1) per-project memory store lives |
| `--no-telemetry` | `YOU_AWARE_TELEMETRY=off` | on | opt out of Tier 2 telemetry |
| `--telemetry-url` | `YOU_AWARE_TELEMETRY_URL` | — | remote Tier 2 sink (events always spool locally while telemetry is on) |
| `--telemetry-dir` | `YOU_AWARE_TELEMETRY_DIR` | `~/.you-aware` | where the local Tier 2 JSONL spool lives |
| `--compile-mode` | `YOU_AWARE_COMPILE_MODE` | `auto` | `auto` (native params + query vocabulary) · `operators` (portable `-site:`/`after:` compilation) · `native` (native params; query side keeps keywordization + ledger exclusions). Forced to `operators` on the keyless free tier, which has no native params |
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

**v1 (this repo):** standalone stdio MCP; four parameters via deterministic file-read + model merge, plus query compilation; decisions-ledger compilation; inspectable trace; per-project retrieval memory with outcome reporting, rank boosts, and context-file suggestions; two-tier data posture with local-first telemetry; ablation eval harness; companion Agent Skill.

## Who's behind this

Built by [Brian Sparker](https://github.com/brainsparker) at [You.com](https://you.com) and published under the `@youdotcom-oss` npm org, MIT-licensed. The interesting parts — context parsing, query compilation, the memory loop — are a thin deterministic layer you can read in an afternoon; the search itself runs on the You.com Search API (`SearchClient` in [`src/youcom.ts`](./src/youcom.ts) is the seam if you want to point the compiler somewhere else).

**Later:** Cursor-rules / Cline-memory adapters and hosted variant (v2 GA) · `prior_decisions` native parameter, `workflow_stage`, smart context-file slicing, session anti-loop mechanic GA (v2.1) · multiple retrieval profiles, budget parameters, enterprise source policy (v2.2+).

## License

MIT © Brian Sparker
