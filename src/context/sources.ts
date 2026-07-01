import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Context-source adapters: each maps a directory to the context file(s) a
 * given harness convention keeps there. The adapter layer only answers
 * "which files, in what order" — parsing stays in parse.ts regardless of
 * source, so a `## Trusted Sources` section works in a .cursorrules exactly
 * as it does in AGENTS.md.
 */
export interface ContextSource {
  /**
   * Coarse source id, safe for telemetry (never a path):
   * "agents-md" | "claude-md" | "gemini-md" | "copilot" | "cursor" | "cline" | "windsurf".
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
 * Per-directory precedence: the first source with hits wins. AGENTS.md (the
 * open convention) first, single-file agent-memory conventions next, free-form
 * rules files last — they were never authored for the section conventions, so
 * they mostly feed the project_context path.
 */
export const CONTEXT_SOURCES: readonly ContextSource[] = [
  singleFile("agents-md", "AGENTS.md"),
  singleFile("claude-md", "CLAUDE.md"),
  singleFile("gemini-md", "GEMINI.md"),
  singleFile("copilot", ".github", "copilot-instructions.md"),
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
  singleFile("windsurf", ".windsurfrules"),
];
