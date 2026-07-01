# Data handling

`you-aware` has a two-tier data posture. The source code in this repository is the auditable boundary — every byte that leaves the process goes through [`src/youcom.ts`](../src/youcom.ts) (the keyed search call), [`src/hostedClient.ts`](../src/hostedClient.ts) (the keyless free-tier search, via You.com's hosted MCP endpoint), or [`src/telemetry.ts`](../src/telemetry.ts) (telemetry events). There is no other network code.

## Tier 1 — never leaves the machine

- Raw context/rules-file contents (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`, `.cursorrules`, `.clinerules`, `.windsurfrules`)
- Conversation history
- File paths
- The per-project retrieval memory — domain citation stats stored under `<data dir>/projects/`, keyed by a local hash of the project path. The store, its path, and the hash never leave the machine (only cited **domains** appear in telemetry outcome events, the same class of data as the source parameters). Opt out entirely with `YOU_AWARE_MEMORY=off`; the store lives under `YOU_AWARE_DATA_DIR` (default: the telemetry dir, `~/.you-aware`) and works independently of the telemetry opt-out.

The server transmits context-file content **nowhere** except as the populated parameters described below. `project_context` is the only free-text field and is capped at 4 KB. **By default, file-derived `project_context` comes only from an explicit `## Project Context` section** — a section you authored for exactly this purpose. Without one, no `project_context` is derived from the file at all.

### The head fallback (opt-in)

`YOU_AWARE_CONTEXT_FALLBACK=head` opts into the v0 behavior: without an explicit `## Project Context` section, the top 4 KB of the context file rides the search call as `project_context`. This is raw file content, so it is off by default and disclosed at startup when enabled. Even when enabled, telemetry never carries the head — events record only `project_context_source: "file-head"` and a character count, and the telemetered `query_compiled` is recompiled without head-derived vocabulary so head content cannot leak through injected terms.

## Tier 2 — telemetry, opt-out via config flag

What telemetry records, when enabled (the default):

- Search queries — both as received from the model and as compiled (the pair is what makes the NL-to-lexical transformation measurable)
- Populated parameter values — both file-read and model-supplied, kept side by side for quality measurement; file-derived `project_context` only when it came from an explicit `## Project Context` section (see above)
- Result interactions (the URLs returned; the domains the agent reports as cited via `report_outcome`)
- Outcome signals (near-duplicate query repetition rate, session call counts, memory-boosted domains, and suggestion lifecycle events — a domain suggested for or accepted into `## Trusted Sources`, with its citation counts)
- Error events — the first line of a failed search's error (an HTTP status class, never upstream response bodies)
- Event metadata — session id (an ephemeral per-process random UUID, not a machine identifier), call sequence, timestamp, tier, the coarse context-source id (e.g. `agents-md`, `cursor` — never a path), and the configured harness identifier (`--harness` / `YOU_AWARE_HARNESS`, default `unknown`)

### Where it actually goes

Two destinations, and the startup log states which are active:

1. **Local spool, always (while telemetry is on):** JSONL under `~/.you-aware/telemetry.jsonl` (configurable via `YOU_AWARE_TELEMETRY_DIR`), created owner-readable only (0600), capped at ~10 MB with one rotated generation kept. `cat` it to see byte-for-byte what telemetry contains.
2. **Remote sink, only if you configure one:** events are POSTed fire-and-forget to `YOU_AWARE_TELEMETRY_URL`. **There is no default sink URL — out of the box, telemetry never leaves your machine.** If a future release ever ships a default sink, it will be a new major version with its own explicit disclosure; an unpinned `npx` install will not silently start transmitting.

Why collect it at all: agent-shaped query-and-outcome data is what makes retrieval measurably better for agents, and You.com builds on it when users choose to send it. That is the trade, stated plainly.

**Opt out:** `YOU_AWARE_TELEMETRY=off` (or `--no-telemetry`). A telemetry failure never blocks or fails a search.

## Additional controls

- `YOU_AWARE_READ_CONTEXT=off` (or `--no-context-read`) disables context-file reading entirely; the model populates parameters exclusively.
- The search call itself always carries the compiled query and (in `auto`/`native` compile modes) the populated parameters — that *is* the product. In `operators` mode, context reaches You.com only as compiled query text.
- **Keyless free tier:** without `YDC_API_KEY`, searches route through You.com's hosted MCP endpoint (`api.you.com/mcp?profile=free`) instead of the Search API. The same boundary holds — only the compiled query (plus a freshness window) goes over the wire; the free tool has no other context parameters, and telemetry behaves identically.

## First ship is stdio

The server runs locally over stdio inside your harness. A hosted variant ships later with its filesystem limitation called out explicitly (a hosted MCP cannot read your `AGENTS.md`; parameter population reduces to model-population only).
