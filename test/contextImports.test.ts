import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandImports, MAX_IMPORT_DEPTH } from "../src/context/imports.js";
import { findContextSource, readContextSource } from "../src/context/read.js";
import { parseHarnessContext } from "../src/context/parse.js";
import { loadConfig } from "../src/config.js";

let root: string;
const read = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const write = (rel: string, content: string): string => {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "you-aware-imports-"));
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("expandImports (Claude Code grammar)", () => {
  it("splices a file imported on its own line, so its sections become live configuration", () => {
    write("docs/sources.md", "## Trusted Sources\n- react.dev\n- tanstack.com\n");
    const file = write("CLAUDE.md", "# Project\n\n@docs/sources.md\n\n## Freshness\nstable\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    expect(out.imported).toEqual([join(root, "docs", "sources.md")]);
    const ctx = parseHarnessContext(out.text, file);
    expect(ctx.trustedSources).toEqual(["react.dev", "tanstack.com"]);
    expect(ctx.freshness).toBe("stable");
  });

  it("splices in place, so an import under a heading supplies that section's body", () => {
    write("docs/trusted.txt", "- react.dev\n- nodejs.org\n");
    const file = write("CLAUDE.md", "## Trusted Sources\n@docs/trusted.txt\n\n## Blocked Sources\n- w3schools.com\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    const ctx = parseHarnessContext(out.text, file);
    expect(ctx.trustedSources).toEqual(["react.dev", "nodejs.org"]);
    expect(ctx.blockedSources).toEqual(["w3schools.com"]);
  });

  it("follows an inline mention mid-sentence, placing the content on its own lines", () => {
    write("CONTEXT.md", "## Project Context\nTypeScript app using date-fns.\n");
    const file = write("CLAUDE.md", "See @CONTEXT.md for the stack, then read on.\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    expect(out.text).toContain("See \n## Project Context\n");
    // The rest of the sentence lands inside the imported section, exactly as it
    // would if the file were pasted at that point.
    expect(parseHarnessContext(out.text, file).projectContext).toMatch(/^TypeScript app using date-fns\./);
  });

  it("resolves nested imports relative to the importing file, and ~/ against the home directory", () => {
    write("docs/index.md", "@./sub/more.md\n");
    write("docs/sub/more.md", "## Blocked Sources\n- geeksforgeeks.org\n");
    const home = join(root, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "shared.md"), "## Trusted Sources\n- developer.mozilla.org\n");
    const file = write("CLAUDE.md", "@docs/index.md\n@~/.claude/shared.md\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read, home });
    expect(out.imported).toEqual([
      join(root, "docs", "index.md"),
      join(root, "docs", "sub", "more.md"),
      join(home, ".claude", "shared.md"),
    ]);
    const ctx = parseHarnessContext(out.text, file);
    expect(ctx.blockedSources).toEqual(["geeksforgeeks.org"]);
    expect(ctx.trustedSources).toEqual(["developer.mozilla.org"]);
  });

  it("stops after four hops, like Claude Code", () => {
    // CLAUDE.md -> h1 -> h2 -> h3 -> h4 (included) -> h5 (not followed)
    for (let i = 1; i <= 5; i++) write(`h${i}.md`, `hop ${i}\n${i < 5 ? `@h${i + 1}.md` : ""}\n`);
    const file = write("CLAUDE.md", "@h1.md\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    expect(MAX_IMPORT_DEPTH).toBe(5);
    expect(out.text).toContain("hop 4");
    expect(out.text).not.toContain("hop 5");
    expect(out.skipped).toEqual([{ path: join(root, "h5.md"), reason: "depth" }]);
  });

  it("breaks import cycles and includes each file once", () => {
    write("a.md", "A\n@b.md\n");
    write("b.md", "B\n@a.md\n");
    const file = write("CLAUDE.md", "@a.md\n@a.md\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    expect(out.text.match(/^A$/gm)).toHaveLength(1);
    expect(out.text.match(/^B$/gm)).toHaveLength(1);
    expect(out.skipped.map((s) => s.reason).sort()).toEqual(["cycle", "duplicate"]);
  });

  it("ignores imports inside fenced blocks and inline code spans", () => {
    write("docs/example.md", "## Blocked Sources\n- should-not-load.example\n");
    const file = write(
      "CLAUDE.md",
      "```markdown\n@docs/example.md\n```\n\nUse `@docs/example.md` to import, or ``@docs/example.md`` as shown.\n",
    );
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    expect(out.imported).toEqual([]);
    expect(out.text).toBe(read(file));
  });

  it("leaves @-prefixed prose that is not a file alone (scoped package names, handles)", () => {
    const file = write("CLAUDE.md", "## Decisions\n- Rejected @tanstack/query in favor of swr.\nPing @maintainer.\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
    expect(out.text).toBe(read(file));
    expect(out.imported).toEqual([]);
    expect(parseHarnessContext(out.text, file).decisions[0]?.rejected).toBe("@tanstack/query");
  });

  it("refuses imports that resolve outside the project unless referenced via ~/", () => {
    const outside = mkdtempSync(join(tmpdir(), "you-aware-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "## Trusted Sources\n- leaked.example\n");
      const file = write("CLAUDE.md", `@${join(outside, "secret.md")}\n@../../${outside.split("/").pop()}/secret.md\n`);
      const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read });
      expect(out.imported).toEqual([]);
      expect(out.skipped.length).toBeGreaterThanOrEqual(1);
      expect(out.skipped.every((s) => s.reason === "outside-root")).toBe(true);
      expect(parseHarnessContext(out.text, file).trustedSources).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("stops following imports once the byte budget is spent", () => {
    write("big.md", "x".repeat(2000) + "\n");
    write("small.md", "## Freshness\nfresh\n");
    const file = write("CLAUDE.md", "@big.md\n@small.md\n");
    const out = expandImports(read(file)!, file, { syntax: "claude", readFile: read, maxTotalBytes: 1000 });
    expect(out.imported).toEqual([join(root, "big.md")]);
    expect(out.skipped).toEqual([{ path: join(root, "small.md"), reason: "budget" }]);
  });
});

describe("expandImports (Gemini CLI grammar)", () => {
  it("follows @./file.md imports but skips non-Markdown targets", () => {
    write("ctx/sources.md", "## Trusted Sources\n- ai.google.dev\n");
    write("ctx/notes.txt", "## Blocked Sources\n- nope.example\n");
    const file = write("GEMINI.md", "@./ctx/sources.md\n@./ctx/notes.txt\n");
    const out = expandImports(read(file)!, file, { syntax: "gemini", readFile: read });
    expect(out.imported).toEqual([join(root, "ctx", "sources.md")]);
    expect(out.skipped).toEqual([{ path: join(root, "ctx", "notes.txt"), reason: "not-markdown" }]);
    const ctx = parseHarnessContext(out.text, file);
    expect(ctx.trustedSources).toEqual(["ai.google.dev"]);
    expect(ctx.blockedSources).toEqual([]);
  });
});

describe("readContextSource import handling", () => {
  it("expands CLAUDE.md imports by default and not when followImports is false", () => {
    write("docs/sources.md", "## Trusted Sources\n- react.dev\n");
    write("CLAUDE.md", "@docs/sources.md\n");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("claude-md");
    const expanded = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!);
    expect(expanded.trustedSources).toEqual(["react.dev"]);
    const verbatim = readContextSource(resolved, { followImports: false })!;
    expect(verbatim).toBe("@docs/sources.md\n");
  });

  it("expands GEMINI.md imports", () => {
    write("ctx.md", "## Blocked Sources\n- w3schools.com\n");
    write("GEMINI.md", "@./ctx.md\n");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("gemini-md");
    const ctx = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!);
    expect(ctx.blockedSources).toEqual(["w3schools.com"]);
  });

  it("does not treat @ tokens in AGENTS.md as imports (the open convention has no import grammar)", () => {
    write("docs/sources.md", "## Trusted Sources\n- react.dev\n");
    write("AGENTS.md", "@docs/sources.md\n");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("agents-md");
    expect(readContextSource(resolved)).toBe("@docs/sources.md\n");
  });
});

describe("loadConfig followImports", () => {
  it("defaults on, and honors --no-imports and YOU_AWARE_FOLLOW_IMPORTS=off", () => {
    expect(loadConfig([], {} as NodeJS.ProcessEnv).followImports).toBe(true);
    expect(loadConfig(["--no-imports"], {} as NodeJS.ProcessEnv).followImports).toBe(false);
    expect(loadConfig([], { YOU_AWARE_FOLLOW_IMPORTS: "off" } as NodeJS.ProcessEnv).followImports).toBe(false);
    expect(loadConfig([], { YOU_AWARE_FOLLOW_IMPORTS: "" } as NodeJS.ProcessEnv).followImports).toBe(true);
  });
});
