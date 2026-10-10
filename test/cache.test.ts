import { describe, it, expect } from "vitest";
import { DEFAULT_CACHE_TTL_SECONDS, SessionCache, cacheKey } from "../src/cache.js";
import type { SearchHit } from "../src/types.js";
import type { SearchRequest } from "../src/youcom.js";

const HITS: SearchHit[] = [
  { url: "https://react.dev/learn", title: "React", snippet: "docs" },
  { url: "https://blog.example.com/a", title: "Blog", snippet: "" },
];

function req(over: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: 'typescript date parsing "date-fns" -moment',
    count: 10,
    params: { trusted_sources: ["react.dev", "tanstack.com"], freshness: "stable" },
    sendNativeParams: true,
    ...over,
  };
}

describe("SessionCache", () => {
  it("misses, then hits on the identical upstream request without spending anything", () => {
    let t = new Date("2026-10-10T13:00:00.000Z");
    const cache = new SessionCache({ enabled: true, now: () => t });
    expect(cache.lookup(req())).toEqual({ status: "miss" });
    cache.store(req(), HITS);
    t = new Date(t.getTime() + 42_000);
    const hit = cache.lookup(req());
    expect(hit.status).toBe("hit");
    expect(hit.ageSeconds).toBe(42);
    expect(hit.hits).toEqual(HITS);
    // Returned hits are copies: a caller re-ranking in place must not mutate the cache.
    hit.hits![0]!.title = "mutated";
    expect(cache.lookup(req()).hits![0]!.title).toBe("React");
    expect(cache.hits).toBe(2);
    expect(cache.misses).toBe(1);
  });

  it("keys on everything that changes the upstream call, and on nothing else", () => {
    const base = cacheKey(req());
    // Same lists in a different order are the same request.
    expect(cacheKey(req({ params: { trusted_sources: ["tanstack.com", "react.dev"], freshness: "stable" } }))).toBe(
      base,
    );
    expect(cacheKey(req({ query: "typescript date parsing" }))).not.toBe(base);
    expect(cacheKey(req({ count: 5 }))).not.toBe(base);
    expect(cacheKey(req({ sendNativeParams: false }))).not.toBe(base);
    expect(cacheKey(req({ params: { trusted_sources: ["react.dev"], freshness: "stable" } }))).not.toBe(base);
    expect(cacheKey(req({ params: { ...req().params, project_context: "node streams" } }))).not.toBe(base);
    expect(cacheKey(req({ params: { ...req().params, freshness: "fresh" } }))).not.toBe(base);
    expect(cacheKey(req({ params: { ...req().params, blocked_sources: ["w3schools.com"] } }))).not.toBe(base);
  });

  it("expires entries after the TTL, measured from the fetch and not from the last hit", () => {
    let t = new Date("2026-10-10T13:00:00.000Z");
    const cache = new SessionCache({ enabled: true, ttlSeconds: 60, now: () => t });
    cache.store(req(), HITS);
    t = new Date(t.getTime() + 50_000);
    expect(cache.lookup(req()).status).toBe("hit");
    t = new Date(t.getTime() + 20_000);
    expect(cache.lookup(req()).status).toBe("miss");
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry past the size bound", () => {
    const cache = new SessionCache({ enabled: true, maxEntries: 2 });
    cache.store(req({ query: "a" }), HITS);
    cache.store(req({ query: "b" }), HITS);
    expect(cache.lookup(req({ query: "a" })).status).toBe("hit"); // a is now most recent
    cache.store(req({ query: "c" }), HITS);
    expect(cache.size).toBe(2);
    expect(cache.lookup(req({ query: "b" })).status).toBe("miss");
    expect(cache.lookup(req({ query: "a" })).status).toBe("hit");
    expect(cache.lookup(req({ query: "c" })).status).toBe("hit");
  });

  it("is inert when disabled", () => {
    const cache = new SessionCache({ enabled: false });
    cache.store(req(), HITS);
    expect(cache.lookup(req())).toEqual({ status: "disabled" });
    expect(cache.size).toBe(0);
  });

  it("defaults to a 15 minute TTL", () => {
    expect(DEFAULT_CACHE_TTL_SECONDS).toBe(900);
    expect(new SessionCache({ enabled: true }).ttlMs).toBe(900_000);
  });
});
