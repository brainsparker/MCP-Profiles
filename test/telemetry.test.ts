import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPOOL_MAX_BYTES, Telemetry, type Tier2Event } from "../src/telemetry.js";

const event = (over: Partial<Tier2Event> = {}): Tier2Event => ({
  type: "search",
  session_id: "s-1",
  seq: 1,
  ts: "2026-06-09T00:00:00.000Z",
  harness: "unknown",
  query_received: "date parsing",
  query_compiled: 'typescript date parsing "date-fns" -moment',
  params_file: { trusted_sources: ["react.dev"] },
  params_model: { trusted_sources: ["nodejs.org"] },
  params_final: { trusted_sources: ["react.dev", "nodejs.org"] },
  ...over,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "you-aware-telemetry-"));
});

describe("Telemetry (two-tier posture, §8.3)", () => {
  it("spools Tier 2 events locally as JSONL", () => {
    const t = new Telemetry({ enabled: true, dir });
    t.record(event());
    t.record(event({ seq: 2 }));
    const lines = readFileSync(join(dir, "telemetry.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.params_file).toEqual({ trusted_sources: ["react.dev"] });
    expect(parsed.params_model).toEqual({ trusted_sources: ["nodejs.org"] });
  });

  it("is a complete no-op when the developer opts out", () => {
    const t = new Telemetry({ enabled: false, dir });
    t.record(event());
    expect(existsSync(join(dir, "telemetry.jsonl"))).toBe(false);
  });

  it("POSTs to the remote sink when configured", async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("ok");
    }) as typeof fetch;
    const t = new Telemetry({ enabled: true, dir, url: "https://example.com/t", fetchImpl: fakeFetch });
    t.record(event());
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body).query_compiled).toContain("-moment");
  });

  it("rotates the spool past the size cap and creates it owner-readable only", () => {
    const t = new Telemetry({ enabled: true, dir });
    t.record(event());
    const spool = join(dir, "telemetry.jsonl");
    if (process.platform !== "win32") {
      expect(statSync(spool).mode & 0o777).toBe(0o600);
    }
    // Blow past the cap, then record again — the spool rolls to .1.
    writeFileSync(spool, "x".repeat(SPOOL_MAX_BYTES + 1024));
    t.record(event({ seq: 2 }));
    expect(existsSync(`${spool}.1`)).toBe(true);
    const lines = readFileSync(spool, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).seq).toBe(2);
  });

  it("never throws when the remote sink fails (fire-and-forget)", async () => {
    const fakeFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const t = new Telemetry({ enabled: true, dir, url: "https://example.com/t", fetchImpl: fakeFetch });
    expect(() => t.record(event())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
