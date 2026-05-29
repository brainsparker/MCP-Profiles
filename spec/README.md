# MCP Profile Spec (`mcp-profiles/v1`)

A **Profile** is a portable, model-independent "operating system" for an agent. It is a YAML document validated against [`profile.schema.json`](./profile.schema.json) (JSON Schema draft 2020-12). The schema is the durable primitive — any language can validate and consume the same profiles. The TypeScript gateway in this repo is the reference implementation.

## Top-level fields

| Field | Required | Purpose |
|---|---|---|
| `apiVersion` | ✅ | Must be `mcp-profiles/v1`. |
| `kind` | ✅ | Must be `Profile`. |
| `metadata` | ✅ | `id` (slug, used as switch key + namespace), `name`, and optional `description`/`version`/`author`/`tags`. |
| `persona` | | `role`, `objectives[]`, `voice` — surfaced as the agent's operating-system prompt. |
| `memory` | | `sources[]` (`inline` / `mcp-resource` / `file`) + `retentionHint`. Surfaced as MCP resources. |
| `retrieval` | | `strategy` (`semantic`/`keyword`/`hybrid`/`recency`), `topK`, `sources[]` (each `via` a downstream server id), `fallback`. Declarative metadata in v1. |
| `tools` | ✅ | **The enforcement surface.** `defaultPolicy` (`deny`/`allow`) + `allow[]`/`deny[]` rules. |
| `workflow` | | `rules[]` + `procedures[]`. Surfaced as MCP prompts. |
| `settings` | | `toolTimeoutMs`, `exposeProcedureAsPrompt`, `exposeMemoryAsResource`. |

## Tool permissions

Profiles reference downstream MCP servers **by id only** (e.g. `amplitude-mcp`). The actual connection details and secrets live in the gateway's separate config (`mcp-profiles.config.json`), never in a shareable profile.

```yaml
tools:
  defaultPolicy: deny          # deny everything not explicitly allowed
  allow:
    - server: amplitude-mcp
      tools: ["query_event", "get_funnel"]
    - server: notion-mcp
      tools: ["*"]             # all tools from this server
      rename: { create_page: new_doc }   # optional display rename
  deny:
    - server: notion-mcp
      tools: ["delete_page"]   # carve-out, even under a wildcard allow
```

Resolution order: start from `defaultPolicy`, apply `allow`, then subtract `deny`. The gateway re-exposes upstream tools under the namespaced name `"<server>__<tool>"` to avoid collisions across servers; `rename` changes only the exposed display name.

See [`/profiles`](../profiles) for complete example profiles.
