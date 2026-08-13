#!/usr/bin/env node
/**
 * Mock You.com Search API for keyed-tier verification, entirely offline.
 * Logs every request (path, query params, X-API-Key header) as JSONL and
 * returns the documented { results: { web: [...] } } response shape.
 *
 * Point the server at it and inspect what actually went over the wire:
 *   node test-harness/mock-search-api.mjs &
 *   node test-harness/mcp-client.mjs --cwd <project> \
 *     --env YDC_API_KEY=test-key --env YOU_API_BASE_URL=http://127.0.0.1:8787
 *   cat /tmp/mock-api-log.jsonl
 *
 * Result order is deliberately adversarial to the expected ranking:
 *   1. neutral-blog.dev        (nothing special)
 *   2. www.npmjs.com           (memory-preferred once cited in 2+ sessions)
 *   3. developer.apple.com     (explicit trusted source in the test AGENTS.md)
 * If you-aware's client-side rank adjustment works on the keyed tier,
 * post-rank order should promote trusted above memory-preferred above neutral.
 *
 * Env: MOCK_PORT (default 8787), MOCK_LOG (default /tmp/mock-api-log.jsonl).
 */
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const LOG = process.env.MOCK_LOG ?? "/tmp/mock-api-log.jsonl";

const body = JSON.stringify({
  results: {
    web: [
      {
        title: "Date parsing tips (neutral blog)",
        url: "https://neutral-blog.dev/date-parsing-tips",
        description: "A neutral blog post about date parsing.",
      },
      {
        title: "date-fns - npm",
        url: "https://www.npmjs.com/package/date-fns",
        description: "Modern JavaScript date utility library.",
      },
      {
        title: "DateFormatter | Apple Developer Documentation",
        url: "https://developer.apple.com/documentation/foundation/dateformatter",
        description: "Apple's official date formatting documentation.",
      },
    ],
  },
});

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  appendFileSync(
    LOG,
    JSON.stringify({
      ts: new Date().toISOString(),
      method: req.method,
      path: u.pathname,
      params: Object.fromEntries(u.searchParams.entries()),
      apiKeyHeader: req.headers["x-api-key"] ?? null,
    }) + "\n",
  );
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock listening on ${PORT}`));
