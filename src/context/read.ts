import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * v1 reads CLAUDE.md only (PRD §8.4: Cursor-rules / Cline-memory adapters land
 * at v2 GA). Order matters: the first match wins.
 */
const CONTEXT_FILE_NAMES = ["CLAUDE.md"];

/**
 * Walk up from `start` looking for a harness-context file, the way harnesses
 * resolve their own memory files. Returns the absolute path or null.
 */
export function findContextFile(start: string, maxDepth = 6): string | null {
  let dir = resolve(start);
  for (let i = 0; i < maxDepth; i++) {
    for (const name of CONTEXT_FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Tier 1 boundary (§8.3): the raw file contents stay in-process. Only the
 * populated parameters derived from them may travel further.
 */
export function readContextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
