# Search API context-aware parameters (Product A contract)

Four optional parameters on the You.com Search API that change retrieval behavior based on caller-supplied context. This is the durable, monetizable surface: the contract lands on the live wrapped product now and carries forward to the owned substrate — and into the Decomposed-tier SDK — unchanged.

**Compatibility guarantee:** all parameters are optional and independent. Default behavior with all parameters omitted is exactly today's Search API behavior. No regression.

| Parameter | Type | Description | Retrieval mechanic |
|---|---|---|---|
| `trusted_sources` | `string[]` of domains | Domains the caller wants boosted in ranking | Per-domain score boost at rank time (lexical-compatible) |
| `blocked_sources` | `string[]` of domains | Domains the caller wants demoted or filtered | Per-domain filter or hard demotion at rank time |
| `project_context` | `string`, max 4 KB | Free-text description of the caller's current project, codebase, or working context | Context-conditioned ranking signal; implementation selected by v1 eval from three candidates: (a) server-side lexical expansion derived from context, (b) embedding-similarity rerank against result snippets (experiment arm), (c) no retrieval-side mechanic — query-side compilation only |
| `freshness` | `"fresh" \| "stable" \| "any"` | Whether the caller prefers recent or evergreen results | Recency window tuning + diversity adjustment |

Parameters can be combined freely. Each is documented with a clear retrieval-side mechanic so callers know what they buy.

## Wire format (current wrapped product)

Sent as query parameters on `GET /search`:

```
GET /search?query=...&count=10
    &trusted_sources=react.dev,tanstack.com
    &blocked_sources=w3schools.com
    &project_context=TypeScript%20app%20using%20date-fns...
    &freshness=stable
X-API-Key: <YDC_API_KEY>
```

- Domain lists are comma-joined bare domains (no protocol, no `www.`, no paths).
- `project_context` is truncated by conforming clients before send to at most 4096 bytes of UTF-8 (4 KB), on a code-point boundary — the cap is a privacy bound on what leaves the caller's machine, so it is denominated in bytes.
- Servers that have not yet shipped the parameters ignore them — clients (like the `you-aware` MCP) keep the mechanics working through query-side operator compilation and client-side rank adjustment until the native surface lands.

## Deferred parameters

| Parameter | When |
|---|---|
| `prior_decisions` (native decisions-ledger parameter) | v2.1, once extraction quality is proven — query-side ledger compilation ships in v1 |
| `workflow_stage` (researching vs. deciding) | v2.1 |
| Budget parameters (`count`/K semantics, latency budget, token-efficiency mode) | v2.2 |
