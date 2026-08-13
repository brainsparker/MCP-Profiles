# test-harness

Two dependency-free scripts for exercising the built server exactly the way an MCP client does — over stdio, with real JSON-RPC. Nothing here ships in the npm package (`files` in package.json doesn't include it); it exists for local smoke tests and debugging.

Build first: `npm run build`.

## mcp-client.mjs — end-to-end smoke test

Spawns `dist/index.js`, does the `initialize` handshake, asserts the tool list and the `search` input schema, runs a live search, and closes the loop with `report_outcome`. Prints `PASS`/`FAIL` per check and exits non-zero on any failure.

```sh
# Keyless free tier, from any project directory containing an AGENTS.md:
node test-harness/mcp-client.mjs --cwd /path/to/project

# Keyed tier:
node test-harness/mcp-client.mjs --cwd /path/to/project --env YDC_API_KEY=$YDC_API_KEY

# Handshake + schema checks only (no search call, no quota spent):
node test-harness/mcp-client.mjs --scenario list
```

Flags: `--server` (default `../dist/index.js` relative to this directory), `--cwd` (project root whose context file the server reads), `--scenario list|search|full` (default `full`), `--query "..."`, `--env KEY=VAL` (repeatable, forwarded to the server process).

## mock-search-api.mjs — offline keyed-tier verification

A local stand-in for the Search API: returns the documented `{ results: { web: [...] } }` shape and logs every request (path, query params, `X-API-Key` header) as JSONL, so you can see precisely what the server sends — compiled query, native context parameters, auth header — without touching the network.

```sh
node test-harness/mock-search-api.mjs &
node test-harness/mcp-client.mjs --cwd /path/to/project \
  --env YDC_API_KEY=any-value --env YOU_API_BASE_URL=http://127.0.0.1:8787
cat /tmp/mock-api-log.jsonl
```

The three canned results are ordered adversarially (neutral, memory-preferred, trusted) so a working rank adjustment visibly reorders them in the trace's `post_rank_top_3`. Env: `MOCK_PORT` (default 8787), `MOCK_LOG` (default `/tmp/mock-api-log.jsonl`).
