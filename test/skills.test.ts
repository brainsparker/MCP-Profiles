import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "../src/config.js";
import { ProjectMemory } from "../src/memory.js";
import { buildServer } from "../src/server.js";
import { SessionMemory } from "../src/session.js";
import {
  defaultSkillsDir,
  loadSkill,
  loadSkillsDir,
  parseFrontmatter,
  sha256Digest,
  SKILLS_EXTENSION_ID,
  SKILLS_TTL_MS,
  type SkillEntry,
} from "../src/skills.js";
import { Telemetry } from "../src/telemetry.js";
import type { SearchHit } from "../src/types.js";
import type { SearchClient } from "../src/youcom.js";

const SHIPPED_SKILL_MD = readFileSync(join(defaultSkillsDir(), "you-aware", "SKILL.md"));

function hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("parseFrontmatter", () => {
  it("reads flat scalars, quoted values, comments, and a one-level metadata map", () => {
    const fm = parseFrontmatter(
      [
        "---",
        "name: demo-skill",
        'description: "Does a thing: with a colon"',
        "# a comment",
        "license: MIT",
        "metadata:",
        "  author: someone",
        "  io.modelcontextprotocol/example: 'x'",
        "---",
        "",
        "# Body",
      ].join("\n"),
    );
    expect(fm).toEqual({
      name: "demo-skill",
      description: "Does a thing: with a colon",
      license: "MIT",
      metadata: { author: "someone", "io.modelcontextprotocol/example": "x" },
    });
  });

  it("rejects files that do not open with a frontmatter fence", () => {
    expect(() => parseFrontmatter("# no frontmatter\n")).toThrow(/must begin with YAML frontmatter/);
  });

  it("rejects shapes it cannot render verbatim (hosts verify frontmatter against the entry)", () => {
    expect(() => parseFrontmatter("---\nname: x\nitems:\n  - a\n---\n")).toThrow(/unparseable nested/);
    expect(() => parseFrontmatter("---\nname: x\n  stray: y\n---\n")).toThrow(/unexpected indented/);
  });
});

describe("loadSkill / loadSkillsDir", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "you-aware-skills-"));
    // A valid skill with a supporting file in a subdirectory and a symlink that must be ignored.
    mkdirSync(join(root, "demo-skill", "references"), { recursive: true });
    writeFileSync(
      join(root, "demo-skill", "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo.\nlicense: MIT\n---\n\n# Demo\n",
    );
    writeFileSync(join(root, "demo-skill", "references", "FORMAT.md"), "# Format\n");
    writeFileSync(join(root, "demo-skill", "references", "data.bin"), Buffer.from([0, 1, 2, 255]));
    try {
      symlinkSync(join(root, "demo-skill", "SKILL.md"), join(root, "demo-skill", "link.md"));
    } catch {
      // symlinks unavailable on this filesystem; the test below tolerates either case
    }
    // Directory name and frontmatter name disagree: must be skipped, not served.
    mkdirSync(join(root, "mismatch"));
    writeFileSync(join(root, "mismatch", "SKILL.md"), "---\nname: other-name\ndescription: x\n---\n");
    // No SKILL.md at all.
    mkdirSync(join(root, "empty-dir"));
    // Description over the Agent Skills bound.
    mkdirSync(join(root, "too-long"));
    writeFileSync(join(root, "too-long", "SKILL.md"), `---\nname: too-long\ndescription: ${"a".repeat(1025)}\n---\n`);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("builds a complete manifest: SKILL.md first, every file once, sha256 digests and byte sizes", () => {
    const skill = loadSkill(join(root, "demo-skill"), "demo-skill");
    expect(skill.entry.uri).toBe("skill://demo-skill/SKILL.md");
    expect(skill.entry.frontmatter).toEqual({ name: "demo-skill", description: "Demo.", license: "MIT" });

    const resources = skill.entry.resources;
    expect(Array.isArray(resources)).toBe(true);
    if (resources === "dynamic") throw new Error("unexpected dynamic");
    expect(resources.map((r) => r.uri)).toEqual([
      "skill://demo-skill/SKILL.md",
      "skill://demo-skill/references/FORMAT.md",
      "skill://demo-skill/references/data.bin",
    ]);
    for (const r of resources) {
      const file = skill.files.find((f) => f.uri === r.uri)!;
      expect(r.digest).toBe(`sha256:${hex(file.bytes)}`);
      expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(r.size).toBe(file.bytes.byteLength);
    }
    expect(skill.files.find((f) => f.path === "references/data.bin")!.mimeType).toBe("application/octet-stream");
    expect(skill.files.find((f) => f.path === "SKILL.md")!.mimeType).toBe("text/markdown");
  });

  it("skips directories that are not faithful skills and says why", () => {
    const catalog = loadSkillsDir(root);
    expect(catalog.skills.map((s) => s.entry.frontmatter.name)).toEqual(["demo-skill"]);
    const reasons = Object.fromEntries(catalog.skipped.map((s) => [s.dir.split("/").pop(), s.reason]));
    expect(reasons["mismatch"]).toMatch(/does not match directory/);
    expect(reasons["empty-dir"]).toMatch(/no SKILL.md/);
    expect(reasons["too-long"]).toMatch(/1 to 1024/);
  });

  it("returns an empty catalog for a missing directory", () => {
    expect(loadSkillsDir(join(root, "does-not-exist"))).toEqual({ skills: [], skipped: [] });
  });

  it("serves the shipped you-aware skill with a digest over the exact bytes on disk", () => {
    const catalog = loadSkillsDir(defaultSkillsDir());
    expect(catalog.skipped).toEqual([]);
    const shipped = catalog.skills.find((s) => s.entry.frontmatter.name === "you-aware")!;
    expect(shipped.entry.uri).toBe("skill://you-aware/SKILL.md");
    const entry = (shipped.entry.resources as { uri: string; digest: string; size: number }[]).find(
      (r) => r.uri === shipped.entry.uri,
    )!;
    expect(entry.digest).toBe(sha256Digest(SHIPPED_SKILL_MD));
    expect(entry.size).toBe(SHIPPED_SKILL_MD.byteLength);
  });
});

// ---- Over the wire: capability declaration, skills/list, skills/get, resources/read ----

const SkillEntrySchema = z.object({
  uri: z.string(),
  frontmatter: z.object({ name: z.string(), description: z.string() }).passthrough(),
  resources: z.union([z.literal("dynamic"), z.array(z.object({ uri: z.string(), digest: z.string(), size: z.number() }))]),
});
const ListSkillsResultSchema = z
  .object({ skills: z.array(SkillEntrySchema), ttlMs: z.number(), cacheScope: z.string() })
  .passthrough();
const GetSkillResultSchema = z.object({ skill: SkillEntrySchema, ttlMs: z.number(), cacheScope: z.string() }).passthrough();

class NullClient implements SearchClient {
  async search(): Promise<SearchHit[]> {
    return [];
  }
}

function makeConfig(dir: string, skills: boolean): Config {
  return {
    apiKey: "test-key",
    baseUrl: "https://api.example.test",
    projectRoot: dir,
    readContext: false,
    harness: "test-harness",
    telemetry: false,
    telemetryDir: dir,
    memory: false,
    dataDir: dir,
    contextHeadFallback: false,
    compileMode: "auto",
    freshWindowDays: 180,
    count: 10,
    hostedMcpUrl: "https://api.you.com/mcp",
    skills,
  };
}

async function startServer(skills: boolean): Promise<{ client: Client; server: ReturnType<typeof buildServer> }> {
  const dir = mkdtempSync(join(tmpdir(), "you-aware-skills-e2e-"));
  const config = makeConfig(dir, skills);
  const server = buildServer({
    config,
    client: new NullClient(),
    tier: "keyed",
    telemetry: new Telemetry({ enabled: false, dir }),
    session: new SessionMemory(),
    memory: new ProjectMemory({ enabled: false, dir, projectRoot: dir }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "skills-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, server };
}

describe("Skills over MCP (io.modelcontextprotocol/skills)", () => {
  let client: Client;
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    ({ client, server } = await startServer(true));
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
  });

  it("declares the extension together with the resources capability it depends on", () => {
    const caps = client.getServerCapabilities()!;
    expect(caps.resources).toBeDefined();
    expect(caps.extensions).toMatchObject({ [SKILLS_EXTENSION_ID]: {} });
    expect(client.getInstructions()).toContain("skill://you-aware/SKILL.md");
  });

  it("skills/list returns the you-aware entry with cache hints", async () => {
    const res = await client.request({ method: "skills/list", params: {} }, ListSkillsResultSchema);
    expect(res.resultType).toBe("complete");
    expect(res.ttlMs).toBe(SKILLS_TTL_MS);
    expect(res.cacheScope).toBe("public");
    expect(res.skills).toHaveLength(1);
    const entry = res.skills[0]!;
    expect(entry.uri).toBe("skill://you-aware/SKILL.md");
    expect(entry.frontmatter.name).toBe("you-aware");
    expect(entry.frontmatter.license).toBe("MIT");
    expect(entry.resources).toEqual([
      { uri: "skill://you-aware/SKILL.md", digest: sha256Digest(SHIPPED_SKILL_MD), size: SHIPPED_SKILL_MD.byteLength },
    ]);
  });

  it("skills/get returns the same entry by URI and rejects unknown URIs with -32602", async () => {
    const list = await client.request({ method: "skills/list", params: {} }, ListSkillsResultSchema);
    const got = await client.request(
      { method: "skills/get", params: { uri: "skill://you-aware/SKILL.md" } },
      GetSkillResultSchema,
    );
    expect(got.resultType).toBe("complete");
    expect(got.skill).toEqual(list.skills[0]);
    expect(got.ttlMs).toBe(SKILLS_TTL_MS);

    const err = await client
      .request({ method: "skills/get", params: { uri: "skill://nope/SKILL.md" } }, GetSkillResultSchema)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(-32602);
    expect((err as McpError).message).toContain("skill://nope/SKILL.md");
  });

  it("resources/read serves bytes a host can verify against the entry's digest and size", async () => {
    const got = await client.request(
      { method: "skills/get", params: { uri: "skill://you-aware/SKILL.md" } },
      GetSkillResultSchema,
    );
    const manifest = (got.skill as SkillEntry).resources as { uri: string; digest: string; size: number }[];
    const read = await client.readResource({ uri: "skill://you-aware/SKILL.md" });
    const content = read.contents[0]!;
    expect(content.mimeType).toBe("text/markdown");
    const bytes = Buffer.from(content.text as string, "utf8");
    expect(`sha256:${hex(bytes)}`).toBe(manifest[0]!.digest);
    expect(bytes.byteLength).toBe(manifest[0]!.size);
    expect(content.text).toBe(SHIPPED_SKILL_MD.toString("utf8"));
  });

  it("lists the skill as an ordinary resource for clients without the extension", async () => {
    const { resources } = await client.listResources();
    const skill = resources.find((r) => r.uri === "skill://you-aware/SKILL.md")!;
    expect(skill).toBeDefined();
    expect(skill.name).toBe("you-aware");
    expect(skill.mimeType).toBe("text/markdown");
    expect(skill.description).toContain("you-aware");
  });

  it("reading a file the server does not serve is -32602, per the base Resources spec", async () => {
    const err = await client.readResource({ uri: "skill://you-aware/references/missing.md" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(-32602);
  });

  it("leaves the tool surface unchanged", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search"]);
  });
});

describe("Skills over MCP: opt-out", () => {
  it("--no-skills declares neither the extension nor resources, and the instructions carry no pointer", async () => {
    const { client, server } = await startServer(false);
    try {
      const caps = client.getServerCapabilities()!;
      expect(caps.extensions?.[SKILLS_EXTENSION_ID]).toBeUndefined();
      expect(caps.resources).toBeUndefined();
      expect(client.getInstructions()).not.toContain("skill://");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
