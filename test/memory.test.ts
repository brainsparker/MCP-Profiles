import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOST_MIN_CITED,
  MAX_DOMAINS,
  MAX_SESSIONS_TRACKED,
  ProjectMemory,
  RESUGGEST_DELTA,
  SUGGEST_MIN_CITED,
  type MemoryFile,
} from "../src/memory.js";

let dir: string;
let clock: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "you-aware-memory-"));
  clock = new Date("2026-07-01T00:00:00.000Z");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function memory(over: Partial<ConstructorParameters<typeof ProjectMemory>[0]> = {}): ProjectMemory {
  return new ProjectMemory({
    enabled: true,
    dir,
    projectRoot: "/home/dev/project",
    now: () => clock,
    ...over,
  });
}

function storeFile(): string {
  const files = readdirSync(join(dir, "projects"));
  expect(files).toHaveLength(1);
  return join(dir, "projects", files[0]!);
}

/** Cite a domain in N distinct sessions (one citation per session unless told otherwise). */
function cite(m: ProjectMemory, domain: string, sessions: number, perSession = 1): void {
  for (let s = 0; s < sessions; s++) {
    for (let c = 0; c < perSession; c++) m.recordCited([domain], `session-${s}`);
  }
}

describe("ProjectMemory store", () => {
  it("persists shown/cited stats across instances (roundtrip)", () => {
    const a = memory();
    a.recordShown(["react.dev", "example.com"], "s1");
    a.recordCited(["react.dev"], "s1");

    const b = memory();
    b.recordCited(["react.dev"], "s2");
    const parsed = JSON.parse(readFileSync(storeFile(), "utf8")) as MemoryFile;
    expect(parsed.version).toBe(1);
    expect(parsed.domains["react.dev"]).toMatchObject({ shown: 1, cited: 2, sessions: ["s1", "s2"] });
    expect(parsed.domains["example.com"]).toMatchObject({ shown: 1, cited: 0 });
  });

  it("writes atomically — no .tmp file left behind", () => {
    memory().recordShown(["react.dev"], "s1");
    expect(readdirSync(join(dir, "projects")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("starts fresh (with a stderr warning) on corrupt JSON or an unknown schema version", () => {
    const warnings: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((c: unknown) => {
      warnings.push(String(c));
      return true;
    }) as typeof process.stderr.write);

    mkdirSync(join(dir, "projects"), { recursive: true });
    const a = memory();
    a.recordShown(["react.dev"], "s1"); // establish the file name
    writeFileSync(storeFile(), "{corrupt");
    const b = memory();
    expect(b.boostDomains([])).toEqual([]);
    expect(warnings.some((w) => w.includes("starting fresh"))).toBe(true);

    writeFileSync(storeFile(), JSON.stringify({ version: 99, domains: {}, suggestions: {} }));
    const c = memory();
    expect(c.boostDomains([])).toEqual([]);
  });

  it("prunes least-recently-shown domains at the cap", () => {
    const m = memory();
    for (let i = 0; i < MAX_DOMAINS; i++) {
      clock = new Date(clock.getTime() + 1000);
      m.recordShown([`domain-${String(i).padStart(3, "0")}.dev`], "s1");
    }
    clock = new Date(clock.getTime() + 1000);
    m.recordShown(["newcomer.dev"], "s1");
    const parsed = JSON.parse(readFileSync(storeFile(), "utf8")) as MemoryFile;
    expect(Object.keys(parsed.domains)).toHaveLength(MAX_DOMAINS);
    expect(parsed.domains["domain-000.dev"]).toBeUndefined();
    expect(parsed.domains["newcomer.dev"]).toBeDefined();
  });

  it("caps tracked cited-session ids per domain", () => {
    const m = memory();
    for (let s = 0; s < MAX_SESSIONS_TRACKED + 3; s++) m.recordCited(["react.dev"], `session-${s}`);
    const parsed = JSON.parse(readFileSync(storeFile(), "utf8")) as MemoryFile;
    expect(parsed.domains["react.dev"]!.sessions).toHaveLength(MAX_SESSIONS_TRACKED);
    expect(parsed.domains["react.dev"]!.cited).toBe(MAX_SESSIONS_TRACKED + 3);
  });

  it("re-reads the store per operation, so concurrent instances never clobber each other", () => {
    const a = memory();
    const b = memory();
    a.recordCited(["react.dev"], "s1");
    b.recordCited(["tanstack.com"], "s2"); // b must see a's write, not stale state
    a.recordCited(["react.dev"], "s3"); // and a must see b's
    const parsed = JSON.parse(readFileSync(storeFile(), "utf8")) as MemoryFile;
    expect(parsed.domains["react.dev"]!.cited).toBe(2);
    expect(parsed.domains["tanstack.com"]!.cited).toBe(1);
  });

  it("preserves dismissals through LRU eviction — a declined suggestion never resurrects", () => {
    const m = memory();
    cite(m, "declined.dev", 2, 2);
    m.reconcileAndSuggest([], []);
    m.dismiss(["declined.dev"]);
    for (let i = 0; i < MAX_DOMAINS + 10; i++) {
      clock = new Date(clock.getTime() + 1000);
      m.recordShown([`filler-${String(i).padStart(3, "0")}.dev`], "s1");
    }
    // declined.dev's stats were evicted, but the dismissal survives…
    const parsed = JSON.parse(readFileSync(storeFile(), "utf8")) as MemoryFile;
    expect(parsed.domains["declined.dev"]).toBeUndefined();
    expect(parsed.suggestions["declined.dev"]!.status).toBe("dismissed");
    // …so re-earning the evidence still never re-suggests.
    cite(m, "declined.dev", 3, 3);
    expect(m.reconcileAndSuggest([], []).suggestions).toEqual([]);
  });

  it("ignores dismissals for domains it has never seen or suggested", () => {
    const m = memory();
    m.recordShown(["known.dev"], "s1");
    m.dismiss(["never-seen.dev", "known.dev"]);
    const parsed = JSON.parse(readFileSync(storeFile(), "utf8")) as MemoryFile;
    expect(parsed.suggestions["never-seen.dev"]).toBeUndefined();
    expect(parsed.suggestions["known.dev"]!.status).toBe("dismissed");
  });

  it("is a complete no-op when disabled — never touches disk", () => {
    const m = memory({ enabled: false });
    m.recordShown(["react.dev"], "s1");
    m.recordCited(["react.dev"], "s1");
    m.dismiss(["react.dev"]);
    expect(m.boostDomains([])).toEqual([]);
    expect(m.reconcileAndSuggest([], [])).toEqual({ suggestions: [], accepted: [] });
    expect(existsSync(join(dir, "projects"))).toBe(false);
  });
});

describe("boostDomains", () => {
  it("boosts only past the cited/session thresholds", () => {
    const m = memory();
    cite(m, "react.dev", BOOST_MIN_CITED); // enough citations across enough sessions
    cite(m, "one-session.dev", 1, BOOST_MIN_CITED); // enough citations, one session
    m.recordCited(["once.dev"], "s1"); // one citation
    expect(m.boostDomains([])).toEqual(["react.dev"]);
  });

  it("excludes domains already covered by trusted/blocked (suffix-aware)", () => {
    const m = memory();
    cite(m, "docs.react.dev", BOOST_MIN_CITED);
    cite(m, "tanstack.com", BOOST_MIN_CITED);
    expect(m.boostDomains(["react.dev"])).toEqual(["tanstack.com"]);
  });
});

describe("reconcileAndSuggest", () => {
  it("suggests a trusted-source edit once the evidence threshold is crossed", () => {
    const m = memory();
    cite(m, "react.dev", 2, 2); // 4 citations across 2 sessions ≥ (3, 2)
    const { suggestions } = m.reconcileAndSuggest([], []);
    expect(suggestions).toEqual([
      {
        action: "add_trusted_source",
        domain: "react.dev",
        section: "## Trusted Sources",
        line: "- react.dev",
        evidence: "cited 4 times across 2 sessions",
        cited: 4,
        sessions: 2,
      },
    ]);
  });

  it("stays silent below the threshold and for domains already in the file", () => {
    const m = memory();
    cite(m, "react.dev", 2); // 2 citations < SUGGEST_MIN_CITED
    cite(m, "tanstack.com", 2, 2);
    cite(m, "w3schools.com", 2, 2);
    const { suggestions } = m.reconcileAndSuggest(["tanstack.com"], ["w3schools.com"]);
    expect(suggestions).toEqual([]);
  });

  it("does not re-suggest until RESUGGEST_DELTA more citations accrue", () => {
    const m = memory();
    cite(m, "react.dev", 2, 2);
    expect(m.reconcileAndSuggest([], []).suggestions).toHaveLength(1);
    expect(m.reconcileAndSuggest([], []).suggestions).toEqual([]); // anti-nag

    for (let i = 0; i < RESUGGEST_DELTA - 1; i++) m.recordCited(["react.dev"], "s0");
    expect(m.reconcileAndSuggest([], []).suggestions).toEqual([]);
    m.recordCited(["react.dev"], "s0");
    expect(m.reconcileAndSuggest([], []).suggestions).toHaveLength(1);
  });

  it("never suggests a dismissed domain again", () => {
    const m = memory();
    cite(m, "react.dev", 2, SUGGEST_MIN_CITED);
    m.dismiss(["react.dev"]);
    expect(m.reconcileAndSuggest([], []).suggestions).toEqual([]);
    cite(m, "react.dev", 4, 5);
    expect(m.reconcileAndSuggest([], []).suggestions).toEqual([]);
  });

  it("flips an emitted suggestion to accepted when the domain shows up in the file", () => {
    const m = memory();
    cite(m, "react.dev", 2, 2);
    expect(m.reconcileAndSuggest([], []).suggestions).toHaveLength(1);

    const first = m.reconcileAndSuggest(["react.dev"], []);
    expect(first.accepted).toEqual(["react.dev"]);
    expect(first.suggestions).toEqual([]);
    // Acceptance is reported once, then stays quiet.
    expect(m.reconcileAndSuggest(["react.dev"], []).accepted).toEqual([]);
  });
});
