import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../src/config.js";
import { ProjectMemory } from "../src/memory.js";
import { buildServer } from "../src/server.js";
import { SessionMemory } from "../src/session.js";
import { Telemetry } from "../src/telemetry.js";
import type { SearchHit } from "../src/types.js";
import type { SearchClient, SearchRequest } from "../src/youcom.js";

const AGENTS_MD = `# Test Project

## Trusted Sources
- react.dev
- [TanStack](https://tanstack.com)

## Blocked Sources
- w3schools.com

## Decisions
- Rejected moment.js in favor of date-fns for date handling.
- Chose pnpm over npm for package management.

## Project Context
TypeScript app using date-fns for date handling.
@tanstack/query for data fetching.

## Freshness
stable
`;

const FIXTURE_HITS: SearchHit[] = [
  { url: "https://www.w3schools.com/js/js_dates.asp", title: "W3Schools dates", snippet: "blocked" },
  { url: "https://blog.example.com/date-parsing", title: "Some blog", snippet: "neutral" },
  { url: "https://react.dev/learn/dates", title: "React docs", snippet: "trusted" },
];

class FakeClient implements SearchClient {
  requests: SearchRequest[] = [];
  async search(req: SearchRequest): Promise<SearchHit[]> {
    this.requests.push(req);
    return FIXTURE_HITS;
  }
}

let projectRoot: string;
let telemetryDir: string;
let fake: FakeClient;
let client: Client;
let server: ReturnType<typeof buildServer>;

function makeConfig(root: string, tDir: string): Config {
  return {
    apiKey: "test-key",
    baseUrl: "https://api.example.test",
    projectRoot: root,
    readContext: true,
    harness: "test-harness",
    telemetry: true,
    telemetryDir: tDir,
    memory: true,
    dataDir: tDir,
    contextHeadFallback: false,
    compileMode: "auto",
    freshWindowDays: 180,
    count: 10,
    hostedMcpUrl: "https://api.you.com/mcp",
  };
}

function makeMemory(config: Config): ProjectMemory {
  return new ProjectMemory({
    enabled: config.memory,
    dir: config.dataDir,
    projectRoot: config.projectRoot,
  });
}

async function connect(s: ReturnType<typeof buildServer>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await s.connect(serverTransport);
  const c = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await c.connect(clientTransport);
  return c;
}

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "you-aware-project-"));
  telemetryDir = mkdtempSync(join(tmpdir(), "you-aware-events-"));
  writeFileSync(join(projectRoot, "AGENTS.md"), AGENTS_MD);
  fake = new FakeClient();
  server = buildServer({
    config: makeConfig(projectRoot, telemetryDir),
    client: fake,
    tier: "keyed",
    telemetry: new Telemetry({ enabled: true, dir: telemetryDir }),
    session: new SessionMemory(),
    memory: makeMemory(makeConfig(projectRoot, telemetryDir)),
  });
  client = await connect(server);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
});

describe("you-aware e2e", () => {
  it("exposes search (query + the four Product A parameters) and report_outcome", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["report_outcome", "search"]);
    const search = tools.find((t) => t.name === "search")!;
    const props = Object.keys((search.inputSchema as { properties: object }).properties);
    expect(props.sort()).toEqual(
      ["blocked_sources", "freshness", "project_context", "query", "trusted_sources"].sort(),
    );
  });

  it("runs the §9.2 flow: file-read, compilation, ranked results, inspectable trace", async () => {
    const res = (await client.callTool({
      name: "search",
      arguments: { query: "best way to handle date parsing in this project" },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    const sc = res.structuredContent as {
      kind: string;
      results: SearchHit[];
      trace: Record<string, unknown>;
    };
    expect(sc.kind).toBe("results");

    // NL→lexical compilation: stack term + relevant library + ledger exclusion.
    expect(sc.trace.query_compiled).toBe('typescript date parsing "date-fns" -moment');
    expect(sc.trace.trusted_sources_boost).toEqual(["react.dev", "tanstack.com"]);
    expect(sc.trace.blocked_sources_applied).toEqual(["w3schools.com"]);
    expect(sc.trace.decisions_applied).toEqual(["moment.js rejected → -moment"]);
    expect(sc.trace.freshness).toBe("stable");
    expect(sc.trace.project_context_chars).toBeGreaterThan(0);
    expect(sc.trace.tier).toBe("keyed");

    // Rank-time mechanics: trusted boosted to the front, blocked demoted to the tail.
    expect(sc.results[0]!.url).toContain("react.dev");
    expect(sc.results[sc.results.length - 1]!.url).toContain("w3schools");
    expect((sc.trace.pre_rank_top_3 as string[])[0]).toContain("w3schools");
    expect((sc.trace.post_rank_top_3 as string[])[0]).toContain("react.dev");

    // The human-readable §9.3 trace block rides along in the text content.
    const text = (res.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
    expect(text).toContain("trace:");
    expect(text).toContain("query_compiled:");

    // Native params were sent (auto mode).
    const req = fake.requests.at(-1)!;
    expect(req.sendNativeParams).toBe(true);
    expect(req.params.trusted_sources).toEqual(["react.dev", "tanstack.com"]);
  });

  it("merges model-supplied parameters with the file-read (Mechanism C)", async () => {
    const res = (await client.callTool({
      name: "search",
      arguments: {
        query: "node stream backpressure handling",
        trusted_sources: ["https://nodejs.org/api/"],
        project_context: "Working on a Node.js streaming pipeline with backpressure issues",
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    const req = fake.requests.at(-1)!;
    expect(req.params.trusted_sources).toEqual(["react.dev", "tanstack.com", "nodejs.org"]);
    // Model-supplied project_context wins over the file-derived one.
    expect(req.params.project_context).toContain("backpressure");
  });

  it("returns a structured decomposition request for multi-hop queries, without searching", async () => {
    const before = fake.requests.length;
    const res = (await client.callTool({
      name: "search",
      arguments: {
        query: "What is the best date library? And how should we handle timezones?",
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { kind: string; instructions: string; trace: object };
    expect(sc.kind).toBe("decomposition_request");
    expect(sc.instructions).toContain("sub-quer");
    expect(fake.requests.length).toBe(before);
    // §9.3: even the decomposition response carries the inspectable trace block.
    expect(sc.trace).toBeDefined();
    const text = (res.content as { text: string }[]).map((c) => c.text).join("\n");
    expect(text).toContain("trace:");
  });

  it("collects the near-duplicate baseline in Tier 2 telemetry (§8.2)", async () => {
    await client.callTool({ name: "search", arguments: { query: "vitest coverage v8 provider" } });
    await client.callTool({ name: "search", arguments: { query: "vitest coverage v8 provider" } });
    const lines = readFileSync(join(telemetryDir, "telemetry.jsonl"), "utf8").trim().split("\n");
    const last = JSON.parse(lines.at(-1)!);
    expect(last.type).toBe("search");
    expect(last.near_duplicate).toBe(true);
    expect(last.params_file).toBeDefined();
    expect(last.params_model).toBeDefined();
    expect(last.tier).toBe("keyed");
    // The harness tag is config-driven on every event type — never hardcoded.
    expect(last.harness).toBe("test-harness");

    // The tier rides every event type, decomposition_request included.
    const decomposition = lines.map((l) => JSON.parse(l)).find((e) => e.type === "decomposition_request");
    expect(decomposition).toBeDefined();
    expect(decomposition.tier).toBe("keyed");
  });

  it("keeps Tier 1 out of telemetry: no file paths, no raw harness file, no memory-store hash", () => {
    const raw = readFileSync(join(telemetryDir, "telemetry.jsonl"), "utf8");
    expect(raw).not.toContain("AGENTS.md");
    expect(raw).not.toContain("CLAUDE.md");
    expect(raw).not.toContain(projectRoot);
    expect(raw).not.toContain("## Trusted Sources");
    expect(raw).not.toContain("claude-code");
    const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
    expect(raw).not.toContain(hash);
    expect(raw).not.toContain("projects/");
  });

  it("records only the status line in error telemetry — never upstream response bodies", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-err-"));
    const tDir = mkdtempSync(join(tmpdir(), "you-aware-err-events-"));
    writeFileSync(join(root, "AGENTS.md"), AGENTS_MD);
    const failing: SearchClient = {
      async search() {
        throw new Error('You.com Search API error 500\n{"error":"quota exceeded for account ACCT-SECRET-9931"}');
      },
    };
    const cfg = makeConfig(root, tDir);
    const s = buildServer({
      config: cfg,
      client: failing,
      tier: "keyed",
      telemetry: new Telemetry({ enabled: true, dir: tDir }),
      session: new SessionMemory(),
      memory: makeMemory(cfg),
    });
    const c = await connect(s);
    const res = (await c.callTool({ name: "search", arguments: { query: "react suspense" } })) as CallToolResult;
    expect(res.isError).toBe(true);
    const raw = readFileSync(join(tDir, "telemetry.jsonl"), "utf8");
    expect(raw).not.toContain("ACCT-SECRET-9931");
    const event = JSON.parse(raw.trim().split("\n").at(-1)!);
    expect(event.type).toBe("error");
    expect(event.error).toBe("You.com Search API error 500");
    await c.close();
    await s.close();
  });

  it("carries explicit-section project_context in telemetry, with its source and length", () => {
    const lines = readFileSync(join(telemetryDir, "telemetry.jsonl"), "utf8").trim().split("\n");
    const search = lines.map((l) => JSON.parse(l)).find((e) => e.type === "search");
    // The fixture has an explicit ## Project Context section — content may flow.
    expect(search.project_context_source).toBe("section");
    expect(search.params_file.project_context).toContain("date-fns");
    expect(search.project_context_chars).toBeGreaterThan(0);
    expect(search.context_source).toBe("agents-md");
  });

  it("never sends the file head anywhere by default (no ## Project Context section)", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-no-head-"));
    const tDir = mkdtempSync(join(tmpdir(), "you-aware-no-head-events-"));
    writeFileSync(
      join(root, "AGENTS.md"),
      "# Secret Project Notes\nInternal roadmap: the SECRET-CODENAME launch.\n\n## Trusted Sources\n- react.dev\n",
    );
    const plainFake = new FakeClient();
    const s = buildServer({
      config: makeConfig(root, tDir),
      client: plainFake,
      tier: "keyed",
      telemetry: new Telemetry({ enabled: true, dir: tDir }),
      session: new SessionMemory(),
      memory: makeMemory(makeConfig(root, tDir)),
    });
    const c = await connect(s);
    await c.callTool({ name: "search", arguments: { query: "react suspense data fetching" } });

    // Neither the search call nor telemetry carries the raw head.
    expect(plainFake.requests.at(-1)!.params.project_context).toBeUndefined();
    expect(plainFake.requests.at(-1)!.params.trusted_sources).toEqual(["react.dev"]);
    const raw = readFileSync(join(tDir, "telemetry.jsonl"), "utf8");
    expect(raw).not.toContain("SECRET-CODENAME");
    expect(JSON.parse(raw.trim().split("\n").at(-1)!).project_context_source).toBe("none");
    await c.close();
    await s.close();
  });

  it("redacts opt-in file-head project_context from telemetry end to end (§8.3: file head is Tier 1)", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-fallback-head-"));
    const tDir = mkdtempSync(join(tmpdir(), "you-aware-fallback-head-events-"));
    writeFileSync(
      join(root, "AGENTS.md"),
      "# Secret Project Notes\nTypeScript app; internal SDK acme-internal-sdk everywhere.\nThe SECRET-CODENAME launch.\n\n## Trusted Sources\n- react.dev\n",
    );
    const cfg: Config = { ...makeConfig(root, tDir), contextHeadFallback: true };
    const headFake = new FakeClient();
    const s = buildServer({
      config: cfg,
      client: headFake,
      tier: "keyed",
      telemetry: new Telemetry({ enabled: true, dir: tDir }),
      session: new SessionMemory(),
      memory: makeMemory(cfg),
    });
    const c = await connect(s);
    // "sdk" overlaps the head's acme-internal-sdk line, so vocabulary
    // injection would copy the internal name into the compiled query.
    await c.callTool({ name: "search", arguments: { query: "sdk error handling patterns" } });

    // The search call carries the opted-in fallback head…
    expect(headFake.requests.at(-1)!.params.project_context).toContain("SECRET-CODENAME");

    // …but no telemetry field leaks head content — not even query_compiled.
    const raw = readFileSync(join(tDir, "telemetry.jsonl"), "utf8");
    expect(raw).not.toContain("SECRET-CODENAME");
    expect(raw).not.toContain("acme-internal-sdk");
    const event = JSON.parse(raw.trim().split("\n").at(-1)!);
    expect(event.project_context_source).toBe("file-head");
    expect(event.project_context_chars).toBeGreaterThan(0);
    expect(event.params_file.project_context).toBeUndefined();
    expect(event.params_final.project_context).toBeUndefined();
    await c.close();
    await s.close();
  });

  it("falls back to CLAUDE.md when no AGENTS.md exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-fallback-"));
    writeFileSync(join(root, "CLAUDE.md"), AGENTS_MD);
    const fallbackFake = new FakeClient();
    const s = buildServer({
      config: makeConfig(root, telemetryDir),
      client: fallbackFake,
      tier: "keyed",
      telemetry: new Telemetry({ enabled: false, dir: telemetryDir }),
      session: new SessionMemory(),
      memory: makeMemory(makeConfig(root, telemetryDir)),
    });
    const c = await connect(s);
    await c.callTool({ name: "search", arguments: { query: "react query caching strategy" } });
    expect(fallbackFake.requests.at(-1)!.params.trusted_sources).toEqual(["react.dev", "tanstack.com"]);
    await c.close();
    await s.close();
  });

  it("prefers AGENTS.md over CLAUDE.md when both exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-both-"));
    writeFileSync(join(root, "AGENTS.md"), "## Trusted Sources\n- agents.example.com\n");
    writeFileSync(join(root, "CLAUDE.md"), "## Trusted Sources\n- claude.example.com\n");
    const bothFake = new FakeClient();
    const s = buildServer({
      config: makeConfig(root, telemetryDir),
      client: bothFake,
      tier: "keyed",
      telemetry: new Telemetry({ enabled: false, dir: telemetryDir }),
      session: new SessionMemory(),
      memory: makeMemory(makeConfig(root, telemetryDir)),
    });
    const c = await connect(s);
    await c.callTool({ name: "search", arguments: { query: "react query caching strategy" } });
    expect(bothFake.requests.at(-1)!.params.trusted_sources).toEqual(["agents.example.com"]);
    await c.close();
    await s.close();
  });

  it("uses the nearest context file when walking up: CLAUDE.md in cwd beats AGENTS.md in a parent", async () => {
    const parent = mkdtempSync(join(tmpdir(), "you-aware-walk-"));
    const child = join(parent, "packages", "app");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(parent, "AGENTS.md"), "## Trusted Sources\n- parent.example.com\n");
    writeFileSync(join(child, "CLAUDE.md"), "## Trusted Sources\n- child.example.com\n");
    const walkFake = new FakeClient();
    const s = buildServer({
      config: makeConfig(child, telemetryDir),
      client: walkFake,
      tier: "keyed",
      telemetry: new Telemetry({ enabled: false, dir: telemetryDir }),
      session: new SessionMemory(),
      memory: makeMemory(makeConfig(child, telemetryDir)),
    });
    const c = await connect(s);
    await c.callTool({ name: "search", arguments: { query: "react query caching strategy" } });
    expect(walkFake.requests.at(-1)!.params.trusted_sources).toEqual(["child.example.com"]);
    await c.close();
    await s.close();
  });

  it("runs keyless on the free tier: operators compilation, no native params, tier in the trace", async () => {
    const freeFake = new FakeClient();
    const keyless = buildServer({
      config: { ...makeConfig(projectRoot, telemetryDir), apiKey: undefined, compileMode: "operators" },
      client: freeFake,
      tier: "free",
      telemetry: new Telemetry({ enabled: false, dir: telemetryDir }),
      session: new SessionMemory(),
      memory: makeMemory({ ...makeConfig(projectRoot, telemetryDir), apiKey: undefined, compileMode: "operators" }),
    });
    const c = await connect(keyless);
    const res = (await c.callTool({
      name: "search",
      arguments: { query: "best way to handle date parsing in this project" },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    const sc = res.structuredContent as { kind: string; trace: Record<string, unknown> };
    expect(sc.kind).toBe("results");
    expect(sc.trace.tier).toBe("free");
    // Context reaches the free tier compiled into the query (blocked-source
    // negations) plus the client-side rank boost — trusted sources are never
    // compiled into a positive site: whitelist, and no native params are sent.
    expect(String(sc.trace.query_compiled)).not.toContain("site:react.dev");
    expect(String(sc.trace.query_compiled)).toContain("-site:w3schools.com");
    expect((sc.trace.post_rank_top_3 as string[])[0]).toContain("react.dev");
    const req = freeFake.requests.at(-1)!;
    expect(req.sendNativeParams).toBe(false);

    // freshness:"fresh" must ride the hosted tool's native argument, never an
    // after: operator the hosted query parser doesn't document.
    const freshRes = (await c.callTool({
      name: "search",
      arguments: { query: "react 19 changelog highlights", freshness: "fresh" },
    })) as CallToolResult;
    const freshSc = freshRes.structuredContent as { trace: Record<string, unknown> };
    expect(String(freshSc.trace.query_compiled)).not.toContain("after:");
    expect(freeFake.requests.at(-1)!.params.freshness).toBe("fresh");
    await c.close();
    await keyless.close();
  });

  it("ignores report_outcome URLs that were never shown this session", async () => {
    const res = (await client.callTool({
      name: "report_outcome",
      arguments: {
        cited_urls: ["https://react.dev/learn/dates", "https://never-shown.example.com/x"],
      },
    })) as CallToolResult;
    const sc = res.structuredContent as {
      kind: string;
      recorded_domains: string[];
      ignored_urls: string[];
    };
    expect(sc.kind).toBe("outcome_ack");
    expect(sc.recorded_domains).toEqual(["react.dev"]);
    expect(sc.ignored_urls).toEqual(["https://never-shown.example.com/x"]);
  });

  it("closes the memory loop: cited domains earn a rank boost and a trusted-source suggestion", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-loop-"));
    const dataDir = mkdtempSync(join(tmpdir(), "you-aware-loop-data-"));
    writeFileSync(join(root, "AGENTS.md"), "## Trusted Sources\n- react.dev\n");
    const cfg = makeConfig(root, dataDir);
    const LOOP_HITS: SearchHit[] = [
      { url: "https://stackoverflow.com/q/1", title: "SO", snippet: "" },
      { url: "https://blog.example.com/a", title: "Blog", snippet: "" },
      { url: "https://react.dev/learn", title: "React", snippet: "" },
    ];

    // One harness session = one server process sharing the on-disk store.
    const runSession = async (outcomeCalls: number) => {
      const s = buildServer({
        config: cfg,
        client: { search: async () => LOOP_HITS },
        tier: "keyed",
        telemetry: new Telemetry({ enabled: true, dir: dataDir }),
        session: new SessionMemory(),
        memory: makeMemory(cfg),
      });
      const c = await connect(s);
      await c.callTool({ name: "search", arguments: { query: "react suspense data fetching" } });
      let lastOutcome: CallToolResult | undefined;
      for (let i = 0; i < outcomeCalls; i++) {
        lastOutcome = (await c.callTool({
          name: "report_outcome",
          arguments: { cited_urls: ["https://blog.example.com/a"] },
        })) as CallToolResult;
      }
      const secondSearch = (await c.callTool({
        name: "search",
        arguments: { query: "typescript generics variance" },
      })) as CallToolResult;
      await c.close();
      await s.close();
      return { lastOutcome, secondSearch };
    };

    // Session 1: 2 citations, but a single session — no boost, no suggestion yet.
    const first = await runSession(2);
    expect(first.lastOutcome!.structuredContent).not.toHaveProperty("context_suggestions");
    const firstTrace = (first.secondSearch.structuredContent as { trace: { memory_boost: string[] } }).trace;
    expect(firstTrace.memory_boost).toEqual([]);

    // Session 2: third citation in a second session crosses the suggestion threshold.
    const second = await runSession(1);
    const ack = second.lastOutcome!.structuredContent as { context_suggestions: unknown[] };
    expect(ack.context_suggestions).toEqual([
      expect.objectContaining({
        action: "add_trusted_source",
        domain: "blog.example.com",
        section: "## Trusted Sources",
        line: "- blog.example.com",
        evidence: "cited 3 times across 2 sessions",
      }),
    ]);
    const ackText = (second.lastOutcome!.content as { text: string }[]).map((c) => c.text).join("\n");
    expect(ackText).toContain('add "- blog.example.com" to ## Trusted Sources');

    // And the boost now applies: blog.example.com jumps ahead of the middle tier.
    const sc = second.secondSearch.structuredContent as {
      results: SearchHit[];
      trace: { memory_boost: string[] };
    };
    expect(sc.trace.memory_boost).toEqual(["blog.example.com"]);
    expect(sc.results.map((h) => h.url)).toEqual([
      "https://react.dev/learn", // trusted (file)
      "https://blog.example.com/a", // preferred (memory)
      "https://stackoverflow.com/q/1", // middle
    ]);

    // Once the agent applies the edit, the suggestion flips to accepted and goes quiet.
    writeFileSync(join(root, "AGENTS.md"), "## Trusted Sources\n- react.dev\n- blog.example.com\n");
    const third = await runSession(1);
    expect(third.lastOutcome!.structuredContent).not.toHaveProperty("context_suggestions");
    const events = readFileSync(join(dataDir, "telemetry.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events.some((e) => e.type === "suggestion_emitted" && e.suggestion_domain === "blog.example.com")).toBe(true);
    expect(events.some((e) => e.type === "suggestion_accepted" && e.suggestion_domain === "blog.example.com")).toBe(true);
    expect(events.some((e) => e.type === "outcome" && e.cited_domains?.includes("blog.example.com"))).toBe(true);
  });

  it("disables the whole memory surface with memory: false — one tool, no disk, empty boost", async () => {
    const root = mkdtempSync(join(tmpdir(), "you-aware-nomem-"));
    const dataDir = mkdtempSync(join(tmpdir(), "you-aware-nomem-data-"));
    writeFileSync(join(root, "AGENTS.md"), AGENTS_MD);
    const cfg: Config = { ...makeConfig(root, dataDir), memory: false };
    const s = buildServer({
      config: cfg,
      client: new FakeClient(),
      tier: "keyed",
      telemetry: new Telemetry({ enabled: false, dir: dataDir }),
      session: new SessionMemory(),
      memory: makeMemory(cfg),
    });
    const c = await connect(s);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search"]);
    const res = (await c.callTool({
      name: "search",
      arguments: { query: "react query caching strategy" },
    })) as CallToolResult;
    expect((res.structuredContent as { trace: { memory_boost: string[] } }).trace.memory_boost).toEqual([]);
    expect(existsSync(join(dataDir, "projects"))).toBe(false);
    await c.close();
    await s.close();
  });
});
