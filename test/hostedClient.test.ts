import { describe, it, expect, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { extractHits, HostedMcpClient, UPGRADE_HINT } from "../src/hostedClient.js";

/**
 * Stands in for https://api.you.com/mcp?profile=free: an MCP server exposing
 * only you-search, wired to the client over an in-memory transport.
 */
function mockHostedServer(
  impl: (args: Record<string, unknown>) => { isError?: boolean; text?: string; structured?: object },
) {
  const received: Record<string, unknown>[] = [];
  const server = new McpServer({ name: "You.com", version: "3.4.0" });
  server.registerTool(
    "you-search",
    {
      description: "Web Search",
      inputSchema: { query: z.string(), count: z.number().optional(), freshness: z.string().optional() },
    },
    async (args) => {
      received.push(args as Record<string, unknown>);
      const out = impl(args as Record<string, unknown>);
      return {
        isError: out.isError,
        content: [{ type: "text" as const, text: out.text ?? "ok" }],
        structuredContent: out.structured,
      };
    },
  );
  return { server, received };
}

interface FactoryOpts {
  /** Make this many tools/call sends throw before letting calls through. */
  failCalls?: number;
  failWith?: () => Error;
  connects?: { count: number };
}

function transportFactory(server: McpServer, opts: FactoryOpts = {}) {
  let remaining = opts.failCalls ?? 0;
  return () => {
    if (opts.connects) opts.connects.count++;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    void server.connect(serverTransport);
    const original = clientTransport.send.bind(clientTransport);
    clientTransport.send = async (msg, sendOpts) => {
      if ((msg as { method?: string }).method === "tools/call" && remaining > 0) {
        remaining--;
        throw opts.failWith?.() ?? new Error("fetch failed (transient)");
      }
      return original(msg, sendOpts);
    };
    return clientTransport;
  };
}

function clientFor(
  server: McpServer,
  opts: { freshWindowDays?: number; now?: () => Date } & FactoryOpts = {},
) {
  return new HostedMcpClient(
    { url: "https://api.you.com/mcp", freshWindowDays: opts.freshWindowDays ?? 180, now: opts.now },
    transportFactory(server, opts),
  );
}

let client: HostedMcpClient | null = null;
afterEach(async () => {
  await client?.close();
  client = null;
});

const HITS = {
  results: [
    { url: "https://react.dev/learn", title: "React docs", description: "learn react" },
    { url: "https://blog.example.com/x", title: "Blog", snippets: ["snippet text"] },
  ],
};

describe("HostedMcpClient (keyless free tier)", () => {
  it("calls you-search with the compiled query and parses hits", async () => {
    const { server, received } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server);
    const hits = await client.search({
      query: 'typescript date parsing "date-fns" -moment',
      count: 10,
      params: {},
      sendNativeParams: false,
    });
    expect(received[0]!.query).toBe('typescript date parsing "date-fns" -moment');
    expect(received[0]!.count).toBe(10);
    expect(received[0]!.freshness).toBeUndefined();
    expect(hits).toEqual([
      { url: "https://react.dev/learn", title: "React docs", snippet: "learn react" },
      { url: "https://blog.example.com/x", title: "Blog", snippet: "snippet text" },
    ]);
  });

  it('maps freshness:"fresh" to the native YYYY-MM-DDtoYYYY-MM-DD range', async () => {
    const { server, received } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server, {
      freshWindowDays: 180,
      now: () => new Date("2026-06-09T00:00:00Z"),
    });
    await client.search({
      query: "react 19 changelog",
      count: 5,
      params: { freshness: "fresh" },
      sendNativeParams: false,
    });
    expect(received[0]!.freshness).toBe("2025-12-11to2026-06-09");
  });

  it("omits the freshness argument for stable/any", async () => {
    const { server, received } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server);
    await client.search({ query: "a b c", count: 3, params: { freshness: "stable" }, sendNativeParams: false });
    await client.search({ query: "d e f", count: 3, params: { freshness: "any" }, sendNativeParams: false });
    expect(received[0]!.freshness).toBeUndefined();
    expect(received[1]!.freshness).toBeUndefined();
  });

  it("reuses one MCP session across calls", async () => {
    const connects = { count: 0 };
    const { server } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server, { connects });
    await client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false });
    await client.search({ query: "d e f", count: 3, params: {}, sendNativeParams: false });
    expect(connects.count).toBe(1);
  });

  it("dedupes concurrent first calls onto one handshake", async () => {
    const connects = { count: 0 };
    const { server } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server, { connects });
    await Promise.all([
      client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false }),
      client.search({ query: "d e f", count: 3, params: {}, sendNativeParams: false }),
    ]);
    expect(connects.count).toBe(1);
  });

  it("drops the session on a connection-level error and reconnects on the next call", async () => {
    const connects = { count: 0 };
    const { server } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server, { connects, failCalls: 1 });
    await expect(
      client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false }),
    ).rejects.toThrow("fetch failed");
    const hits = await client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false });
    expect(hits.length).toBeGreaterThan(0);
    expect(connects.count).toBe(2);
  });

  it("detects HTTP 429 by status code (empty body), upsells, and keeps the session", async () => {
    const connects = { count: 0 };
    const { server } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server, {
      connects,
      failCalls: 1,
      failWith: () => Object.assign(new Error("Streamable HTTP error: Error POSTing to endpoint: "), { code: 429 }),
    });
    await expect(
      client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false }),
    ).rejects.toThrow(UPGRADE_HINT.slice(0, 40));
    // A quota rejection is request-scoped: the session survives, no reconnect.
    const hits = await client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false });
    expect(hits.length).toBeGreaterThan(0);
    expect(connects.count).toBe(1);
  });

  it("refuses to search after close()", async () => {
    const { server } = mockHostedServer(() => ({ structured: HITS }));
    client = clientFor(server);
    await client.search({ query: "a b c", count: 3, params: {}, sendNativeParams: false });
    await client.close();
    await expect(
      client.search({ query: "d e f", count: 3, params: {}, sendNativeParams: false }),
    ).rejects.toThrow(/closed/);
  });

  it("surfaces rate-limit errors with the key-upgrade hint (passive upsell)", async () => {
    const { server } = mockHostedServer(() => ({
      isError: true,
      text: "Rate limit exceeded: free tier daily quota reached",
    }));
    client = clientFor(server);
    await expect(
      client.search({ query: "q r s", count: 3, params: {}, sendNativeParams: false }),
    ).rejects.toThrow(UPGRADE_HINT.slice(0, 40));
  });

  it("surfaces other tool errors without the upsell", async () => {
    const { server } = mockHostedServer(() => ({ isError: true, text: "internal error" }));
    client = clientFor(server);
    await expect(
      client.search({ query: "t u v", count: 3, params: {}, sendNativeParams: false }),
    ).rejects.toThrow(/hosted search error/);
  });
});

describe("extractHits (tolerant hosted response parsing)", () => {
  it("parses the live hosted shape: structuredContent.results.web[]", () => {
    const live = {
      results: {
        web: [
          {
            url: "https://react.dev/learn/typescript",
            title: "Using TypeScript – React",
            description: "TypeScript is a popular way…",
            snippets: ["snippet one"],
            thumbnail_url: "https://react.dev/images/og-learn.png",
          },
        ],
      },
      metadata: { search_uuid: "x", latency: 0.4 },
    };
    expect(extractHits({ content: [], structuredContent: live })).toEqual([
      {
        url: "https://react.dev/learn/typescript",
        title: "Using TypeScript – React",
        snippet: "TypeScript is a popular way…",
      },
    ]);
  });

  it("finds hits under results / hits / web variants", () => {
    const shapes = [
      { results: HITS.results },
      { hits: HITS.results },
      { web: { results: HITS.results } },
    ];
    for (const structured of shapes) {
      const hits = extractHits({ content: [], structuredContent: structured });
      expect(hits.map((h) => h.url)).toContain("https://react.dev/learn");
    }
  });

  it("scans unknown shapes for the first plausible array of {url,…} objects", () => {
    const hits = extractHits({
      content: [],
      structuredContent: { latency: 12, items: HITS.results },
    });
    expect(hits).toHaveLength(2);
  });

  it("prefers results.web over sibling sections regardless of key order", () => {
    const hits = extractHits({
      content: [],
      structuredContent: {
        results: {
          news: [{ url: "https://news.example.com/a", title: "News" }],
          web: HITS.results,
        },
      },
    });
    expect(hits[0]!.url).toBe("https://react.dev/learn");
  });

  it("falls through hit-less candidate arrays to the structural scan", () => {
    const hits = extractHits({
      content: [],
      structuredContent: {
        results: { related_searches: ["a", "b"] },
        web_results: HITS.results,
      },
    });
    expect(hits).toHaveLength(2);
  });

  it("returns empty (not garbage) when nothing matches", () => {
    expect(extractHits({ content: [{ type: "text", text: "no structure" }] })).toEqual([]);
    expect(extractHits({ content: [], structuredContent: { latency: 5 } })).toEqual([]);
  });

  it("treats a present-but-empty results.web as authoritative — never substitutes a sibling vertical", () => {
    const hits = extractHits({
      content: [],
      structuredContent: {
        results: {
          web: [],
          news: [{ url: "https://news.example.com/story", title: "News story", description: "newsy" }],
        },
      },
    });
    expect(hits).toEqual([]);
  });
});
