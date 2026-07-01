# Data handling

`you-aware` has a two-tier data posture, disclosed at install. The source code in this repository is the auditable boundary — every byte that leaves the process goes through [`src/youcom.ts`](../src/youcom.ts) (the keyed search call), [`src/hostedClient.ts`](../src/hostedClient.ts) (the keyless free-tier search, via You.com's hosted MCP endpoint), or [`src/telemetry.ts`](../src/telemetry.ts) (Tier 2 events).

## Tier 1 — never leaves the machine

- Raw context/rules-file contents (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`, `.cursorrules`, `.clinerules`, `.windsurfrules`)
- Conversation history
- File paths

The server transmits context-file content **nowhere** except as the populated parameters described below. `project_context` is the only free-text field and is capped at 4 KB.

### The `project_context` fallback, precisely

When the context file has an explicit `## Project Context` section, that section (authored for this purpose) is the file-derived `project_context` — it rides the search call in `auto`/`native` compile modes and appears in Tier 2 events. When there is **no** such section, the server falls back to the top 4 KB of the file as `project_context` for the **search call only** (that is the product mechanism); in Tier 2 telemetry events the fallback content is never included — only its source label (`project_context_source: "file-head"`) and character count are recorded. To avoid the fallback entirely, either add a `## Project Context` section or disable file reading with `YOU_AWARE_READ_CONTEXT=off`.

## Tier 2 — flows under You.com platform terms, opt-out via config flag

- Search queries — both as received from the model and as compiled (the pair is what makes the NL-to-lexical transformation measurable)
- Populated parameter values — both file-read and model-supplied, kept side by side for faithfulness measurement; file-derived `project_context` only when it came from an explicit `## Project Context` section (see above)
- Result interactions (the URLs returned)
- Outcome signals (near-duplicate query repetition rate, session call counts)
- Event metadata — session id, call sequence, timestamp, tier, the coarse context-source id (e.g. `agents-md`, `cursor` — never a path), and the configured harness identifier (`--harness` / `YOU_AWARE_HARNESS`, default `unknown`)

Tier 2 is the substrate signal loop and a design goal, not telemetry exhaust: it is the agent-shaped query-and-outcome data that makes retrieval measurably better for agents.

**Opt out:** `YOU_AWARE_TELEMETRY=off` (or `--no-telemetry`). While telemetry is on, events spool locally as JSONL under `~/.you-aware/` (configurable via `YOU_AWARE_TELEMETRY_DIR`) and are POSTed to the configured sink (`YOU_AWARE_TELEMETRY_URL`) fire-and-forget — a telemetry failure never blocks or fails a search.

## Additional controls

- `YOU_AWARE_READ_CONTEXT=off` (or `--no-context-read`) disables context-file reading entirely; the model populates parameters exclusively.
- The search call itself always carries the compiled query and (in `auto`/`native` compile modes) the populated parameters — that *is* the product. In `operators` mode, context reaches You.com only as compiled query text.
- **Keyless free tier:** without `YDC_API_KEY`, searches route through You.com's hosted MCP endpoint (`api.you.com/mcp?profile=free`) instead of the Search API. The same boundary holds — only the compiled query (plus a freshness window) goes over the wire; the free tool has no other context parameters, and Tier 2 telemetry behaves identically.

## First ship is stdio

The server runs locally over stdio inside your harness. A hosted variant ships later with its filesystem limitation called out explicitly (a hosted MCP cannot read your `AGENTS.md`; Mechanism C reduces to model-population only).
