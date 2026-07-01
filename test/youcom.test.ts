import { describe, it, expect } from "vitest";
import { KEYED_RATE_LIMIT_HINT, YouComClient, parseHits, type SearchRequest } from "../src/youcom.js";

const req = (over: Partial<SearchRequest> = {}): SearchRequest => ({
  query: "typescript date parsing",
  count: 10,
  params: {},
  sendNativeParams: false,
  ...over,
});

const okBody = JSON.stringify({ hits: [{ url: "https://a.dev", title: "A", description: "d" }] });

interface Harness {
  client: YouComClient;
  urls: URL[];
  sleeps: number[];
}

/** Client with a scripted fetch and a sleep that records delays and resolves immediately. */
function harness(
  responses: Array<Response | Error | "hang">,
  opts: Partial<ConstructorParameters<typeof YouComClient>[0]> = {},
): Harness {
  const urls: URL[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
    urls.push(new URL(String(url)));
    const next = responses[Math.min(i++, responses.length - 1)]!;
    if (next === "hang") {
      // Resolve only when the per-attempt AbortController fires.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const client = new YouComClient(
    { apiKey: "test-key", baseUrl: "https://api.ydc-index.io", ...opts },
    fetchImpl,
    async (ms) => {
      sleeps.push(ms);
    },
  );
  return { client, urls, sleeps };
}

describe("YouComClient", () => {
  it("sends query/count and the X-API-Key header; native params only when sendNativeParams", async () => {
    const captured: RequestInit[] = [];
    const urls: URL[] = [];
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      urls.push(new URL(String(url)));
      captured.push(init!);
      return new Response(okBody);
    }) as typeof fetch;
    const client = new YouComClient({ apiKey: "test-key", baseUrl: "https://api.ydc-index.io" }, fetchImpl);

    await client.search(
      req({
        sendNativeParams: true,
        params: { trusted_sources: ["react.dev", "nodejs.org"], freshness: "fresh", project_context: "ctx" },
      }),
    );
    expect(urls[0]!.searchParams.get("query")).toBe("typescript date parsing");
    expect(urls[0]!.searchParams.get("count")).toBe("10");
    expect(urls[0]!.searchParams.get("trusted_sources")).toBe("react.dev,nodejs.org");
    expect(urls[0]!.searchParams.get("freshness")).toBe("fresh");
    expect(urls[0]!.searchParams.get("project_context")).toBe("ctx");
    expect((captured[0]!.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");

    await client.search(req({ params: { trusted_sources: ["react.dev"] } }));
    expect(urls[1]!.searchParams.get("trusted_sources")).toBeNull();
  });

  it("retries a 500 with backoff and succeeds on the next attempt", async () => {
    const h = harness([new Response("boom", { status: 500 }), new Response(okBody)]);
    const hits = await h.client.search(req());
    expect(hits).toHaveLength(1);
    expect(h.urls).toHaveLength(2);
    expect(h.sleeps).toHaveLength(1);
    expect(h.sleeps[0]!).toBeGreaterThanOrEqual(500);
  });

  it("honors Retry-After on 429", async () => {
    const h = harness([
      new Response("slow down", { status: 429, headers: { "Retry-After": "2" } }),
      new Response(okBody),
    ]);
    await h.client.search(req());
    expect(h.sleeps).toEqual([2000]);
  });

  it("gives up immediately when Retry-After exceeds the cap", async () => {
    const h = harness([new Response("slow down", { status: 429, headers: { "Retry-After": "3600" } })]);
    await expect(h.client.search(req())).rejects.toThrow(/429/);
    expect(h.urls).toHaveLength(1);
  });

  it("surfaces the plan-limits hint when 429 retries are exhausted", async () => {
    const h = harness([new Response("quota", { status: 429 })], { maxAttempts: 2 });
    await expect(h.client.search(req())).rejects.toThrow(KEYED_RATE_LIMIT_HINT);
    expect(h.urls).toHaveLength(2);
  });

  it("does not retry other 4xx errors, and keeps the body off the first line", async () => {
    const h = harness([new Response("bad request", { status: 400 })]);
    const err = await h.client.search(req()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    // Status on line 1 (all telemetry ever sees), body below for humans.
    expect((err as Error).message.split("\n")[0]).toBe("You.com Search API error 400");
    expect((err as Error).message).toContain("bad request");
    expect(h.urls).toHaveLength(1);
    expect(h.sleeps).toHaveLength(0);
  });

  it("times out a hung request per attempt, retries, then reports the timeout", async () => {
    const h = harness(["hang"], { timeoutMs: 10, maxAttempts: 2 });
    await expect(h.client.search(req())).rejects.toThrow(/timed out after 10ms/);
    expect(h.urls).toHaveLength(2);
  });

  it("retries network failures", async () => {
    const h = harness([new Error("socket hang up"), new Response(okBody)]);
    const hits = await h.client.search(req());
    expect(hits).toHaveLength(1);
    expect(h.urls).toHaveLength(2);
  });

  it("does not retry malformed JSON", async () => {
    const h = harness([new Response("not json {")]);
    await expect(h.client.search(req())).rejects.toThrow(/malformed JSON/);
    expect(h.urls).toHaveLength(1);
  });
});

describe("parseHits", () => {
  it("reads the flat hits[] shape", () => {
    const hits = parseHits({ hits: [{ url: "https://a.dev", title: "A", description: "desc" }] });
    expect(hits).toEqual([{ url: "https://a.dev", title: "A", snippet: "desc" }]);
  });

  it("reads the results.web[] shape and falls back to snippets[0]", () => {
    const hits = parseHits({ results: { web: [{ url: "https://b.dev", snippets: ["s1", "s2"] }] } });
    expect(hits).toEqual([{ url: "https://b.dev", title: "https://b.dev", snippet: "s1" }]);
  });

  it("skips entries without a string url and tolerates junk", () => {
    expect(parseHits({ hits: [{ title: "no url" }, 42, null] })).toEqual([]);
    expect(parseHits("garbage")).toEqual([]);
    expect(parseHits(null)).toEqual([]);
  });

  it("parses non-array hits/results.web shapes as empty instead of throwing", () => {
    expect(parseHits({ hits: { total: 0 } })).toEqual([]);
    expect(parseHits({ results: { web: { count: 0 } } })).toEqual([]);
  });
});

describe("base URL handling", () => {
  it("keeps the path component of a gateway base URL", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (url: URL | RequestInfo) => {
      urls.push(new URL(String(url)));
      return new Response(okBody);
    }) as typeof fetch;
    const client = new YouComClient(
      { apiKey: "k", baseUrl: "https://gateway.corp/youcom/v1" },
      fetchImpl,
    );
    await client.search(req());
    expect(urls[0]!.pathname).toBe("/youcom/v1/search");
  });
});

describe("body-phase timeout", () => {
  it("aborts a response whose body stalls after headers arrive", async () => {
    const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      // Headers arrive instantly; the body never does — until the signal fires.
      const body = new Promise<string>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      return { ok: true, status: 200, headers: new Headers(), text: () => body } as unknown as Response;
    }) as typeof fetch;
    const client = new YouComClient(
      { apiKey: "k", baseUrl: "https://api.ydc-index.io", timeoutMs: 10, maxAttempts: 1 },
      fetchImpl,
      async () => {},
    );
    await expect(client.search(req())).rejects.toThrow(/timed out after 10ms/);
  });
});
