import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/logger.js";

/**
 * Context-source adapters: each maps a directory to the context file(s) a
 * given harness convention keeps there. The adapter layer only answers
 * "which files, in what order" — parsing stays in parse.ts regardless of
 * source, so a `## Trusted Sources` section works in a .cursorrules exactly
 * as it does in AGENTS.md.
 *
 * Harnesses have moved from one root file to rules directories (Claude Code
 * .claude/rules/, Copilot .github/instructions/, Windsurf .windsurf/rules/,
 * Kiro .kiro/steering/). An adapter returns every file the harness itself
 * would load for the directory, in the harness's own load order, so the
 * section conventions keep working wherever a team actually keeps them.
 */
export interface ContextSource {
  /**
   * Coarse source id, safe for telemetry (never a path):
   * "agents-md" | "claude-md" | "gemini-md" | "copilot" | "cursor" | "cline" | "windsurf" | "kiro".
   */
  id: string;
  /** Absolute paths found in `dir`, in merge order; [] when absent. */
  resolve(dir: string): string[];
}

export interface ResolvedContext {
  sourceId: string;
  /** At least one entry; readContextSource concatenates them in order. */
  paths: string[];
}

/** Rules directories are walked at most this deep below their root. */
export const MAX_RULES_DEPTH = 3;

/** Per-adapter cap on rules files: a runaway rules tree must not turn one search into hundreds of reads. */
export const MAX_RULES_FILES = 50;

function singleFile(id: string, ...segments: string[]): ContextSource {
  return {
    id,
    resolve(dir: string): string[] {
      const candidate = join(dir, ...segments);
      return isFile(candidate) ? [candidate] : [];
    },
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Files in `dir` matching `ext`, lexically sorted for a deterministic merge order. */
function sortedDirFiles(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(ext))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Recursive, lexically ordered walk of a rules directory: files in a
 * directory come before its subdirectories, both sorted by name, so the merge
 * order is deterministic across machines. Depth and file count are bounded.
 */
export function walkRulesDir(root: string, ext: string, depth = MAX_RULES_DEPTH): string[] {
  if (!isDirectory(root)) return [];
  const out: string[] = [];
  let truncated = false;
  const visit = (dir: string, remaining: number): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const name of names) {
      const path = join(dir, name);
      if (name.endsWith(ext) && isFile(path)) {
        if (out.length >= MAX_RULES_FILES) {
          truncated = true;
          return;
        }
        out.push(path);
      } else if (remaining > 0 && isDirectory(path)) {
        subdirs.push(path);
      }
    }
    for (const sub of subdirs) visit(sub, remaining - 1);
  };
  visit(root, depth);
  if (truncated) {
    // Basename only: rules-directory paths stay Tier 1.
    log.warn(`rules directory has more than ${MAX_RULES_FILES} files; reading the first ${MAX_RULES_FILES} only`);
  }
  return out;
}

/** Bytes of a file head that can hold any reasonable YAML frontmatter block. */
const FRONTMATTER_PROBE_BYTES = 4096;

/**
 * Read one scalar frontmatter field (`key: value`) from the head of a file.
 * Only flat `key: value` lines are recognized; lists and nested maps are
 * ignored. Returns null when the file has no frontmatter or no such key.
 */
export function readFrontmatterField(path: string, key: string): string | null {
  let head: string;
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(FRONTMATTER_PROBE_BYTES);
      const read = readSync(fd, buf, 0, FRONTMATTER_PROBE_BYTES, 0);
      head = buf.subarray(0, read).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(head);
  if (!block) return null;
  const line = new RegExp(`^${key}:\\s*["']?([A-Za-z0-9_-]+)["']?\\s*$`, "m").exec(block[1]!);
  return line ? line[1]! : null;
}

/**
 * Windsurf (`trigger: manual`) and Kiro (`inclusion: manual`) rules load only
 * when the developer invokes them by name. They are never live in a session
 * on their own, so they must not become live search parameters either.
 */
function isManualOnly(path: string, key: "trigger" | "inclusion"): boolean {
  return readFrontmatterField(path, key) === "manual";
}

/**
 * Per-directory precedence: the first source with hits wins. AGENTS.md (the
 * open convention) first, single-file agent-memory conventions next, free-form
 * rules files last — they were never authored for the section conventions, so
 * they mostly feed the project_context path.
 */
export const CONTEXT_SOURCES: readonly ContextSource[] = [
  {
    // Codex reads at most one of these per directory, AGENTS.override.md
    // taking precedence over AGENTS.md (the override is the developer's local
    // replacement, usually gitignored). Mirror that: never merge the two.
    id: "agents-md",
    resolve(dir: string): string[] {
      const override = join(dir, "AGENTS.override.md");
      if (isFile(override)) return [override];
      const agents = join(dir, "AGENTS.md");
      return isFile(agents) ? [agents] : [];
    },
  },
  {
    // Claude Code loads, together: CLAUDE.md (or .claude/CLAUDE.md), then the
    // gitignored CLAUDE.local.md, then every .md under .claude/rules/ (the
    // modular rules directory; its `paths:` frontmatter scopes a rule to
    // files Claude is editing). All rules are included regardless of `paths`,
    // the same v1 simplification applied to Cursor globs: a search call has
    // no "current file" to scope against.
    id: "claude-md",
    resolve(dir: string): string[] {
      const paths: string[] = [];
      const root = join(dir, "CLAUDE.md");
      const nested = join(dir, ".claude", "CLAUDE.md");
      if (isFile(root)) paths.push(root);
      else if (isFile(nested)) paths.push(nested);
      const local = join(dir, "CLAUDE.local.md");
      if (isFile(local)) paths.push(local);
      paths.push(...walkRulesDir(join(dir, ".claude", "rules"), ".md"));
      return paths;
    },
  },
  singleFile("gemini-md", "GEMINI.md"),
  {
    // Copilot combines the repo-wide .github/copilot-instructions.md with the
    // path-specific .github/instructions/**/*.instructions.md files (their
    // `applyTo:` frontmatter scopes them to file globs; included regardless).
    id: "copilot",
    resolve(dir: string): string[] {
      const paths: string[] = [];
      const repoWide = join(dir, ".github", "copilot-instructions.md");
      if (isFile(repoWide)) paths.push(repoWide);
      paths.push(...walkRulesDir(join(dir, ".github", "instructions"), ".instructions.md"));
      return paths;
    },
  },
  {
    // Modern .cursor/rules/*.mdc first (lexical order), legacy .cursorrules
    // appended. All .mdc files are included regardless of their `globs`
    // frontmatter — glob-scoped inclusion is a documented v1 simplification.
    id: "cursor",
    resolve(dir: string): string[] {
      const paths = sortedDirFiles(join(dir, ".cursor", "rules"), ".mdc");
      const legacy = join(dir, ".cursorrules");
      if (isFile(legacy)) paths.push(legacy);
      return paths;
    },
  },
  {
    // Cline accepts .clinerules as a single file or as a directory of .md files.
    id: "cline",
    resolve(dir: string): string[] {
      const root = join(dir, ".clinerules");
      if (isFile(root)) return [root];
      if (isDirectory(root)) return sortedDirFiles(root, ".md");
      return [];
    },
  },
  {
    // Modern .windsurf/rules/*.md first (lexical order; `trigger: manual`
    // rules skipped), legacy .windsurfrules appended.
    id: "windsurf",
    resolve(dir: string): string[] {
      const paths = walkRulesDir(join(dir, ".windsurf", "rules"), ".md").filter(
        (p) => !isManualOnly(p, "trigger"),
      );
      const legacy = join(dir, ".windsurfrules");
      if (isFile(legacy)) paths.push(legacy);
      return paths;
    },
  },
  {
    // Kiro steering files: every .md under .kiro/steering/ (`inclusion:
    // manual` files skipped; `always`, `fileMatch`, and `auto` included).
    // Kiro also reads AGENTS.md at the workspace root, which the agents-md
    // adapter above already covers.
    id: "kiro",
    resolve(dir: string): string[] {
      return walkRulesDir(join(dir, ".kiro", "steering"), ".md").filter(
        (p) => !isManualOnly(p, "inclusion"),
      );
    },
  },
];
