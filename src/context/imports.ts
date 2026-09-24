import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { log } from "../util/logger.js";

/**
 * `@path` import expansion for harness memory files.
 *
 * Claude Code lets a CLAUDE.md pull in other files with `@path/to/file`
 * (relative to the importing file, `~/` for the home directory, at most four
 * hops deep, ignored inside code spans and fenced blocks). Gemini CLI does the
 * same for GEMINI.md with `@./file.md`, restricted to Markdown files. A team
 * that keeps `## Trusted Sources` in an imported file sees it in the harness
 * but, without this module, you-aware would read the memory file verbatim and
 * miss every section that lives behind an import. Expansion follows each
 * harness's own rules so the server sees the same document the harness does.
 *
 * Tier 1 boundary (docs/data-handling.md): imported files are read in-process
 * exactly like the memory file itself. Their paths and contents never enter
 * telemetry; warnings carry basenames only.
 */

/** Which harness import grammar a context source uses. */
export type ImportSyntax = "claude" | "gemini";

/** Context-source ids (sources.ts) that carry an import grammar. AGENTS.md has none. */
export const IMPORT_SYNTAX_BY_SOURCE: Readonly<Record<string, ImportSyntax>> = {
  "claude-md": "claude",
  "gemini-md": "gemini",
};

/** Claude Code follows imports at most four hops from the root file (five files deep). */
export const MAX_IMPORT_DEPTH = 5;

export interface ExpandImportsOptions {
  syntax: ImportSyntax;
  /** Reads a file (already capped), or returns null when unreadable. */
  readFile: (path: string) => string | null;
  /**
   * Imports must resolve inside this directory (defaults to the root file's
   * directory) or, for `~/` paths, inside the home directory. Anything else
   * is skipped: Claude Code gates such imports behind an approval prompt that
   * a stdio server cannot show, so declining is the faithful behavior.
   */
  root?: string;
  /** Home directory for `~/` imports (injectable for tests). */
  home?: string;
  /** Root file plus hops; 1 disables following entirely. */
  maxDepth?: number;
  /** Stop following once the expanded document reaches this many UTF-8 bytes. */
  maxTotalBytes?: number;
}

export type ImportSkipReason =
  | "outside-root"
  | "not-markdown"
  | "cycle"
  | "duplicate"
  | "depth"
  | "budget"
  | "unreadable";

export interface ExpandImportsResult {
  /** The document with every followed import spliced in place of its `@path` token. */
  text: string;
  /** Absolute paths of files spliced in, in encounter order. Tier 1: never log or transmit. */
  imported: string[];
  /** Import tokens that were recognized but not followed, with the reason. */
  skipped: { path: string; reason: ImportSkipReason }[];
}

/**
 * One `@path` token: `@` at line start or after whitespace, followed by a
 * path run that stops at whitespace or markdown punctuation. Trailing
 * sentence punctuation is trimmed afterwards so "see @docs/x.md." works.
 */
const IMPORT_TOKEN = /(^|\s)@([^\s`'"()<>\[\],;]+)/g;

const utf8 = new TextEncoder();

/** Warn once per (reason, basename) for the process: reads happen on every search call. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(message);
}

/** Expand `@path` imports in `text`, which was read from `filePath`. */
export function expandImports(
  text: string,
  filePath: string,
  opts: ExpandImportsOptions,
): ExpandImportsResult {
  const rootFile = resolve(filePath);
  const root = realpathOr(resolve(opts.root ?? dirname(rootFile)));
  const home = realpathOr(resolve(opts.home ?? homedir()));
  const maxDepth = opts.maxDepth ?? MAX_IMPORT_DEPTH;
  const maxTotalBytes = opts.maxTotalBytes ?? Number.POSITIVE_INFINITY;

  const state: ExpandState = {
    ...opts,
    root,
    home,
    maxDepth,
    maxTotalBytes,
    bytes: utf8.encode(text).length,
    included: new Set([realpathOr(rootFile)]),
    imported: [],
    skipped: [],
  };
  const expanded = expandFile(text, rootFile, 1, [realpathOr(rootFile)], state);
  return { text: expanded, imported: state.imported, skipped: state.skipped };
}

interface ExpandState extends Required<Pick<ExpandImportsOptions, "syntax" | "readFile" | "root" | "home" | "maxDepth" | "maxTotalBytes">> {
  bytes: number;
  included: Set<string>;
  imported: string[];
  skipped: { path: string; reason: ImportSkipReason }[];
}

function expandFile(text: string, filePath: string, depth: number, chain: string[], state: ExpandState): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    // Fenced blocks are opaque, mirroring parse.ts's section splitter.
    if (fence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = open[1]!;
      out.push(line);
      continue;
    }
    out.push(expandLine(line, filePath, depth, chain, state));
  }
  return out.join("\n");
}

function expandLine(line: string, filePath: string, depth: number, chain: string[], state: ExpandState): string {
  if (!line.includes("@")) return line;
  // Inline code spans are masked (same length, so indices line up) before scanning.
  const masked = line.replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));
  const tokens: { start: number; end: number; raw: string }[] = [];
  for (const m of masked.matchAll(IMPORT_TOKEN)) {
    const lead = m[1]!;
    let raw = m[2]!.replace(/[.,:;!?]+$/, "");
    if (!raw) continue;
    const start = m.index! + lead.length;
    tokens.push({ start, end: start + 1 + raw.length, raw });
  }
  if (tokens.length === 0) return line;

  let result = "";
  let cursor = 0;
  for (const token of tokens) {
    const replacement = resolveImport(token.raw, filePath, depth, chain, state);
    if (replacement === null) continue; // not an import: leave the text as written
    // A token alone on its line is replaced in place; an inline mention gets
    // the content on its own lines so a heading inside it still starts a line.
    const whole = line.trim() === `@${token.raw}`;
    result += line.slice(cursor, token.start);
    result += whole ? replacement : `\n${replacement}\n`;
    cursor = token.end;
  }
  result += line.slice(cursor);
  return result;
}

/**
 * Returns the expanded content for an import, "" for a recognized-but-skipped
 * import, or null when the token is not an import at all (a path that does
 * not exist, e.g. a scoped package name like @tanstack/query in prose).
 */
function resolveImport(raw: string, filePath: string, depth: number, chain: string[], state: ExpandState): string | null {
  let target: string;
  let viaHome = false;
  if (raw === "~" || raw.startsWith("~/")) {
    target = resolve(state.home, raw.slice(2));
    viaHome = true;
  } else if (isAbsolute(raw)) {
    target = resolve(raw);
  } else {
    target = resolve(dirname(filePath), raw);
  }

  // Only regular files count; a missing path means the token was prose.
  let real: string;
  try {
    if (!statSync(target).isFile()) return null;
    real = realpathSync(target);
  } catch {
    return null;
  }

  const skip = (reason: ImportSkipReason, message?: string): string => {
    state.skipped.push({ path: target, reason });
    if (message) warnOnce(`${reason}:${basename(target)}`, message);
    return "";
  };

  if (state.syntax === "gemini" && !/\.md$/i.test(target)) {
    return skip("not-markdown", `GEMINI.md imports Markdown only; skipped ${basename(target)}`);
  }
  if (!(isInside(real, state.root) || (viaHome && isInside(real, state.home)))) {
    return skip(
      "outside-root",
      `import ${basename(target)} resolves outside the project (and is not a ~/ path); skipped. ` +
        `Move the file under the project or reference it with ~/.`,
    );
  }
  if (chain.includes(real)) return skip("cycle", `circular import skipped: ${basename(target)}`);
  if (state.included.has(real)) return skip("duplicate");
  if (depth >= state.maxDepth) {
    return skip(
      "depth",
      `import ${basename(target)} is more than ${state.maxDepth - 1} hops deep and was not followed`,
    );
  }
  if (state.bytes >= state.maxTotalBytes) {
    return skip("budget", `context imports exceed ${state.maxTotalBytes} bytes; ${basename(target)} was not followed`);
  }

  const content = state.readFile(target);
  if (content === null) return skip("unreadable", `import ${basename(target)} could not be read`);

  state.included.add(real);
  state.imported.push(target);
  state.bytes += utf8.encode(content).length;
  const body = content.replace(/\r?\n$/, "");
  return expandFile(body, target, depth + 1, [...chain, real], state);
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  if (rel === "") return true;
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
