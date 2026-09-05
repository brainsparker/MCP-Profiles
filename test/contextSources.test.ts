import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import {
  MAX_CONTEXT_FILE_BYTES,
  findContextSource,
  readContextSource,
} from "../src/context/read.js";
import { parseHarnessContext } from "../src/context/parse.js";
import { MAX_RULES_FILES, readFrontmatterField, walkRulesDir } from "../src/context/sources.js";

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

  it("lets AGENTS.override.md replace AGENTS.md in the same directory (Codex reads one, not both)", () => {
    writeFileSync(join(root, "AGENTS.md"), "# shared");
    writeFileSync(join(root, "AGENTS.override.md"), "# local override");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("agents-md");
    expect(resolved.paths).toEqual([join(root, "AGENTS.override.md")]);
  });

  it("loads CLAUDE.md, then CLAUDE.local.md, then .claude/rules/**/*.md in Claude Code's order", () => {
    writeFileSync(join(root, "CLAUDE.md"), "# claude");
    writeFileSync(join(root, "CLAUDE.local.md"), "# local");
    const rules = join(root, ".claude", "rules");
    mkdirSync(join(rules, "backend"), { recursive: true });
    writeFileSync(join(rules, "zz-style.md"), "style");
    writeFileSync(join(rules, "aa-core.md"), "core");
    writeFileSync(join(rules, "backend", "api.md"), "api");
    writeFileSync(join(rules, "notes.txt"), "ignored");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("claude-md");
    expect(resolved.paths.map((p) => relative(root, p))).toEqual([
      "CLAUDE.md",
      "CLAUDE.local.md",
      join(".claude", "rules", "aa-core.md"),
      join(".claude", "rules", "zz-style.md"),
      join(".claude", "rules", "backend", "api.md"),
    ]);
  });

  it("falls back to .claude/CLAUDE.md and treats a rules-only .claude/ as a hit", () => {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(join(root, ".claude", "rules", "sources.md"), "## Trusted Sources\n- react.dev\n");
    let resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("claude-md");
    expect(resolved.paths.map((p) => relative(root, p))).toEqual([join(".claude", "rules", "sources.md")]);

    writeFileSync(join(root, ".claude", "CLAUDE.md"), "# nested claude");
    resolved = findContextSource(root)!;
    expect(resolved.paths.map((p) => relative(root, p))).toEqual([
      join(".claude", "CLAUDE.md"),
      join(".claude", "rules", "sources.md"),
    ]);
  });

  it("combines Copilot's repo-wide file with .github/instructions/**/*.instructions.md", () => {
    mkdirSync(join(root, ".github", "instructions", "api"), { recursive: true });
    writeFileSync(join(root, ".github", "copilot-instructions.md"), "# repo-wide");
    writeFileSync(join(root, ".github", "instructions", "react.instructions.md"), "react");
    writeFileSync(join(root, ".github", "instructions", "api", "rest.instructions.md"), "rest");
    writeFileSync(join(root, ".github", "instructions", "README.md"), "not an instructions file");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("copilot");
    expect(resolved.paths.map((p) => relative(root, p))).toEqual([
      join(".github", "copilot-instructions.md"),
      join(".github", "instructions", "react.instructions.md"),
      join(".github", "instructions", "api", "rest.instructions.md"),
    ]);
  });

  it("finds .github/instructions/ even without a copilot-instructions.md", () => {
    mkdirSync(join(root, ".github", "instructions"), { recursive: true });
    writeFileSync(join(root, ".github", "instructions", "ts.instructions.md"), "ts");
    expect(findContextSource(root)!.sourceId).toBe("copilot");
  });

  it("merges .windsurf/rules/*.md with legacy .windsurfrules appended, skipping manual-trigger rules", () => {
    mkdirSync(join(root, ".windsurf", "rules"), { recursive: true });
    writeFileSync(join(root, ".windsurf", "rules", "b-always.md"), "---\ntrigger: always_on\n---\nalways");
    writeFileSync(join(root, ".windsurf", "rules", "a-glob.md"), "---\ntrigger: glob\nglobs: '**/*.ts'\n---\nglob");
    writeFileSync(join(root, ".windsurf", "rules", "c-manual.md"), "---\ntrigger: manual\n---\nmanual only");
    writeFileSync(join(root, ".windsurfrules"), "legacy");
    const resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("windsurf");
    expect(resolved.paths.map((p) => basename(p))).toEqual(["a-glob.md", "b-always.md", ".windsurfrules"]);
  });

  it("reads Kiro steering files, skipping inclusion: manual, after every other convention", () => {
    mkdirSync(join(root, ".kiro", "steering"), { recursive: true });
    writeFileSync(join(root, ".kiro", "steering", "product.md"), "product");
    writeFileSync(
      join(root, ".kiro", "steering", "tf.md"),
      '---\ninclusion: fileMatch\nfileMatchPattern: "*.tf"\n---\nterraform',
    );
    writeFileSync(join(root, ".kiro", "steering", "manual.md"), "---\ninclusion: manual\n---\nmanual");
    let resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("kiro");
    expect(resolved.paths.map((p) => basename(p))).toEqual(["product.md", "tf.md"]);

    writeFileSync(join(root, ".windsurfrules"), "windsurf");
    resolved = findContextSource(root)!;
    expect(resolved.sourceId).toBe("windsurf");
  });
});

describe("walkRulesDir", () => {
  it("orders files before subdirectories, bounds depth, and caps the file count", () => {
    const rules = join(root, "rules");
    mkdirSync(join(rules, "a", "b", "c", "d"), { recursive: true });
    writeFileSync(join(rules, "z.md"), "z");
    writeFileSync(join(rules, "a", "x.md"), "x");
    writeFileSync(join(rules, "a", "b", "y.md"), "y");
    writeFileSync(join(rules, "a", "b", "c", "deep.md"), "deep");
    writeFileSync(join(rules, "a", "b", "c", "d", "too-deep.md"), "too deep");
    expect(walkRulesDir(rules, ".md").map((p) => relative(rules, p))).toEqual([
      "z.md",
      join("a", "x.md"),
      join("a", "b", "y.md"),
      join("a", "b", "c", "deep.md"),
    ]);

    const many = join(root, "many");
    mkdirSync(many);
    for (let i = 0; i < MAX_RULES_FILES + 5; i++) {
      writeFileSync(join(many, `${String(i).padStart(3, "0")}.md`), "r");
    }
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    const found = walkRulesDir(many, ".md");
    spy.mockRestore();
    expect(found).toHaveLength(MAX_RULES_FILES);
    expect(walkRulesDir(join(root, "missing"), ".md")).toEqual([]);
  });
});

describe("readFrontmatterField", () => {
  it("reads a flat scalar field and ignores files without frontmatter", () => {
    const withFm = join(root, "fm.md");
    writeFileSync(withFm, '---\ndescription: "Style rules"\ntrigger: "model_decision"\npaths:\n  - "src/**"\n---\nbody');
    expect(readFrontmatterField(withFm, "trigger")).toBe("model_decision");
    expect(readFrontmatterField(withFm, "paths")).toBeNull();
    expect(readFrontmatterField(withFm, "inclusion")).toBeNull();

    const plain = join(root, "plain.md");
    writeFileSync(plain, "---\nnot frontmatter, just a rule\n");
    expect(readFrontmatterField(plain, "trigger")).toBeNull();
    expect(readFrontmatterField(join(root, "missing.md"), "trigger")).toBeNull();
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

  it("strips frontmatter from rules-directory .md files and from a file ending at the closing fence", () => {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "rules", "api.md"),
      '---\npaths:\n  - "src/api/**/*.ts"\n---\n## Trusted Sources\n- react.dev\n',
    );
    writeFileSync(join(root, ".claude", "rules", "empty.md"), "---\npaths: [\"**/*.md\"]\n---");
    const resolved = findContextSource(root)!;
    const raw = readContextSource(resolved)!;
    expect(raw).toBe("## Trusted Sources\n- react.dev\n");
    expect(raw).not.toContain("paths");
    const ctx = parseHarnessContext(raw, resolved.paths[0]!);
    expect(ctx.trustedSources).toEqual(["react.dev"]);
  });

  it("parses section conventions spread across Copilot instructions files", () => {
    mkdirSync(join(root, ".github", "instructions"), { recursive: true });
    writeFileSync(join(root, ".github", "copilot-instructions.md"), "## Trusted Sources\n- react.dev\n");
    writeFileSync(
      join(root, ".github", "instructions", "docs.instructions.md"),
      '---\napplyTo: "docs/**/*.md"\n---\n## Blocked Sources\n- w3schools.com\n\n## Freshness\nfresh\n',
    );
    const resolved = findContextSource(root)!;
    const ctx = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!);
    expect(ctx.trustedSources).toEqual(["react.dev"]);
    expect(ctx.blockedSources).toEqual(["w3schools.com"]);
    expect(ctx.freshness).toBe("fresh");
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

  it("marks fallback-derived project context as not explicit (opt-in head fallback)", () => {
    writeFileSync(join(root, "AGENTS.md"), "# My project\nJust prose, no sections.");
    const resolved = findContextSource(root)!;
    const ctx = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!, {
      headFallback: true,
    });
    expect(ctx.projectContextExplicit).toBe(false);
    expect(ctx.projectContext).toContain("Just prose");

    // Default: the raw head never becomes project_context.
    const dflt = parseHarnessContext(readContextSource(resolved)!, resolved.paths[0]!);
    expect(dflt.projectContext).toBeUndefined();
  });
});
