import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { log } from "../util/logger.js";
import { IMPORT_SYNTAX_BY_SOURCE, expandImports } from "./imports.js";
import { CONTEXT_SOURCES, type ResolvedContext } from "./sources.js";

/**
 * Context discovery walks up from the project root the way harnesses resolve
 * their own memory files, checking each directory against the adapter list in
 * sources.ts (AGENTS.md first, then per-harness conventions). Nearest
 * directory wins; within a directory the adapter order decides.
 */

/** Per-file read cap: a runaway rules file must not be slurped whole. */
export const MAX_CONTEXT_FILE_BYTES = 262_144; // 256 KiB

/** Walk up from `start` looking for a context source. Returns null when none is found. */
export function findContextSource(start: string, maxDepth = 6): ResolvedContext | null {
  let dir = resolve(start);
  for (let i = 0; i < maxDepth; i++) {
    for (const source of CONTEXT_SOURCES) {
      const paths = source.resolve(dir);
      if (paths.length > 0) return { sourceId: source.id, paths };
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
 *
 * Multi-file sources (.cursor/rules/*.mdc) are concatenated in resolve order;
 * .mdc YAML frontmatter (description/globs/alwaysApply) is stripped so it
 * can't pollute the compiled query's content tokens.
 *
 * Sources whose harness defines an import grammar (CLAUDE.md's `@path`,
 * GEMINI.md's `@./file.md`) have their imports spliced in the way the harness
 * itself loads them (imports.ts), so a `## Trusted Sources` section kept in an
 * imported file is seen. Imported files are Tier 1 like the memory file itself.
 */
export interface ReadContextOptions {
  /** Follow `@path` imports for sources that define them. Default true. */
  followImports?: boolean;
}

export function readContextSource(resolved: ResolvedContext, opts: ReadContextOptions = {}): string | null {
  const syntax = opts.followImports === false ? undefined : IMPORT_SYNTAX_BY_SOURCE[resolved.sourceId];
  const parts: string[] = [];
  for (const path of resolved.paths) {
    let raw = readFileCapped(path);
    if (raw === null) continue;
    if (path.endsWith(".mdc")) raw = stripFrontmatter(raw);
    if (syntax) {
      raw = expandImports(raw, path, {
        syntax,
        readFile: readFileCapped,
        maxTotalBytes: MAX_CONTEXT_FILE_BYTES,
      }).text;
    }
    if (raw.trim()) parts.push(raw);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n---\n\n");
}

function readFileCapped(path: string): string | null {
  try {
    const size = statSync(path).size;
    if (size <= MAX_CONTEXT_FILE_BYTES) return readFileSync(path, "utf8");
    // Oversized: read the head only. Basename only in the warning — full
    // paths stay Tier 1 and stderr is the only safe stream under stdio.
    log.warn(
      `context file exceeds ${MAX_CONTEXT_FILE_BYTES} bytes; reading head only: ${basename(path)}`,
    );
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(MAX_CONTEXT_FILE_BYTES);
      const read = readSync(fd, buf, 0, MAX_CONTEXT_FILE_BYTES, 0);
      // A multi-byte code point cut at the boundary decodes to U+FFFD — trim it.
      return buf.subarray(0, read).toString("utf8").replace(/�+$/, "");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}
