import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  MAX_CONTEXT_FILE_BYTES,
  findContextSource,
  readContextSource,
} from "../src/context/read.js";
import { parseHarnessContext } from "../src/context/parse.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "you-aware-sources-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("findContextSource", () => {
  it("prefers AGENTS.md over other conventions in the same directory", () => {
    writeFileSync(join(root, "AGENTS.md"), "# agents");
    writeFileSync(join(root, "CLAUDE.md"), "# claude");
    writeFileSync(join(root, ".cursorrules"), "cursor rules");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("agents-md");
    expect(resolved.paths).toEqual([join(root, "AGENTS.md")]);
  });

  it("prefers CLAUDE.md over GEMINI.md, and GEMINI.md over rules files", () => {
    writeFileSync(join(root, "GEMINI.md"), "# gemini");
    writeFileSync(join(root, ".windsurfrules"), "windsurf");
    expect(findContextSource(root)!.sourceId).toBe("gemini-md");
    writeFileSync(join(root, "CLAUDE.md"), "# claude");
    expect(findContextSource(root)!.sourceId).toBe("claude-md");
  });

  it("finds .github/copilot-instructions.md", () => {
    mkdirSync(join(root, ".github"));
    writeFileSync(join(root, ".github", "copilot-instructions.md"), "# copilot");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("copilot");
  });

  it("lets a nearer directory's source win over a parent's higher-precedence one", () => {
    writeFileSync(join(root, "AGENTS.md"), "# parent agents");
    const child = join(root, "packages", "web");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, ".cursorrules"), "child cursor rules");
    const resolved = findContextSource(child)!;
    expect(resolved.sourceId).toBe("cursor");
    expect(resolved.paths).toEqual([join(child, ".cursorrules")]);
  });

  it("merges .cursor/rules/*.mdc lexically with legacy .cursorrules appended", () => {
    const rules = join(root, ".cursor", "rules");
    mkdirSync(rules, { recursive: true });
    writeFileSync(join(rules, "b-style.mdc"), "b");
    writeFileSync(join(rules, "a-core.mdc"), "a");
    writeFileSync(join(rules, "notes.txt"), "ignored");
    writeFileSync(join(root, ".cursorrules"), "legacy");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("cursor");
    expect(resolved.paths.map((p) => basename(p))).toEqual(["a-core.mdc", "b-style.mdc", ".cursorrules"]);
  });

  it("supports .clinerules as a file and as a directory of .md files", () => {
    writeFileSync(join(root, ".clinerules"), "cline file");
    expect(findContextSource(root)!.paths).toEqual([join(root, ".clinerules")]);

    const dirRoot = mkdtempSync(join(tmpdir(), "you-aware-cline-"));
    try {
      mkdirSync(join(dirRoot, ".clinerules"));
      writeFileSync(join(dirRoot, ".clinerules", "02-api.md"), "api");
      writeFileSync(join(dirRoot, ".clinerules", "01-general.md"), "general");
      const resolved = findContextSource(dirRoot)!;
      expect(resolved.sourceId).toBe("cline");
      expect(resolved.paths.map((p) => basename(p))).toEqual(["01-general.md", "02-api.md"]);
    } finally {
      rmSync(dirRoot, { recursive: true, force: true });
    }
  });

  it("returns null when nothing is found within maxDepth", () => {
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect(findContextSource(deep)).toBeNull();
  });
});

describe("readContextSource", () => {
  it("strips .mdc YAML frontmatter and joins files with a separator", () => {
    const rules = join(root, ".cursor", "rules");
    mkdirSync(rules, { recursive: true });
    writeFileSync(join(rules, "a.mdc"), "---\ndescription: core\nglobs: '**/*.ts'\n---\nUse strict mode.");
    writeFileSync(join(rules, "b.mdc"), "Prefer named exports.");
    const raw = readContextSource(findContextSource(root)!)!;
    expect(raw).toBe("Use strict mode.\n\n---\n\nPrefer named exports.");
    expect(raw).not.toContain("globs");
  });

  it("caps oversized files at the head and warns to stderr with the basename only", () => {
    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    writeFileSync(join(root, "AGENTS.md"), "x".repeat(MAX_CONTEXT_FILE_BYTES + 1000));
    const raw = readContextSource(findContextSource(root)!)!;
    spy.mockRestore();
    expect(raw.length).toBe(MAX_CONTEXT_FILE_BYTES);
    const warning = warnings.find((w) => w.includes("reading head only"));
    expect(warning).toBeDefined();
    expect(warning).toContain("AGENTS.md");
    expect(warning).not.toContain(root);
  });

  it("feeds section conventions in a .cursorrules through the normal parser", () => {
    writeFileSync(
      join(root, ".cursorrules"),
      "## Trusted Sources\n- react.dev\n- https://nodejs.org/docs\n\n## Project Context\nNext.js app.\n",
    );
    const resolved = findContextSource(root)!;
    const ctx = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!);
    expect(ctx.trustedSources).toEqual(["react.dev", "nodejs.org"]);
    expect(ctx.projectContext).toBe("Next.js app.");
    expect(ctx.projectContextExplicit).toBe(true);
  });

  it("marks fallback-derived project context as not explicit", () => {
    writeFileSync(join(root, "AGENTS.md"), "# My project\nJust prose, no sections.");
    const resolved = findContextSource(root)!;
    const ctx = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!);
    expect(ctx.projectContextExplicit).toBe(false);
    expect(ctx.projectContext).toContain("Just prose");
  });
});
