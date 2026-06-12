import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../src/config.js";
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
    compileMode: "auto",
    freshWindowDays: 180,
    count: 10,
    hostedMcpUrl: "https://api.you.com/mcp",
  };
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
  });
  client = await connect(server);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
});

describe("you-aware e2e", () => {
  it("exposes exactly one tool — search — with query plus the four Product A parameters", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search"]);
    const props = Object.keys((tools[0]!.inputSchema as { properties: object }).properties);
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

  it("keeps Tier 1 out of telemetry: no file paths, no raw harness file", () => {
    const raw = readFileSync(join(telemetryDir, "telemetry.jsonl"), "utf8");
    expect(raw).not.toContain("AGENTS.md");
    expect(raw).not.toContain("CLAUDE.md");
    expect(raw).not.toContain(projectRoot);
    expect(raw).not.toContain("## Trusted Sources");
    expect(raw).not.toContain("claude-code");
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
    // Context reaches the free tier compiled into the query (site: narrowing),
    // never as native parameters.
    expect(String(sc.trace.query_compiled)).toContain("(site:react.dev OR site:tanstack.com)");
    expect(String(sc.trace.query_compiled)).toContain("-site:w3schools.com");
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
});
