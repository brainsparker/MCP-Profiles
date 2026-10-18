/**
 * Skills over MCP (extension `io.modelcontextprotocol/skills`, SEP-2640).
 *
 * The companion Agent Skill in skills/you-aware/ used to reach a host only by
 * copying the folder into a skills directory by hand. This module serves it
 * through the server itself: every file in the skill becomes a resource under
 * the `skill://` scheme, `skills/list` and `skills/get` return the entry a host
 * verifies against (verbatim frontmatter plus a complete manifest of files with
 * SHA-256 digests and byte sizes), and `resources/read` serves the bytes.
 *
 * The skill format is owned by the Agent Skills specification; this file only
 * implements the transport binding. Hosts that do not implement the extension
 * see ordinary resources and nothing else changes.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";
export const SKILL_URI_SCHEME = "skill://";
/** Freshness hint on skills/list and skills/get results. Content is static for the process lifetime. */
export const SKILLS_TTL_MS = 300_000;
/** Per-skill limits fixed by the extension: a conforming host accepts up to these. */
export const MAX_SKILL_RESOURCES = 512;
export const MAX_SKILL_BYTES = 16 * 1024 * 1024;

/** Agent Skills spec: 1 to 64 chars, lowercase alphanumerics and single hyphens, no leading or trailing hyphen. */
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export interface SkillResource {
  uri: string;
  /** `sha256:` followed by 64 lowercase hex characters, over the file's raw bytes. */
  digest: string;
  /** Byte length of the raw content the digest covers. */
  size: number;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

/** The `Skill` entry shape returned by both skills/list and skills/get. */
export interface SkillEntry {
  uri: string;
  frontmatter: SkillFrontmatter;
  resources: SkillResource[] | "dynamic";
}

export interface SkillFile {
  uri: string;
  /** Path relative to the skill root, `/`-separated. */
  path: string;
  bytes: Buffer;
  mimeType: string;
}

export interface LoadedSkill {
  entry: SkillEntry;
  files: SkillFile[];
}

export interface SkillsCatalog {
  skills: LoadedSkill[];
  /** Directories that looked like skills but were not served, with the reason. */
  skipped: { dir: string; reason: string }[];
}

/** The skills/ directory shipped in the npm package (works from src/ under tsx and from dist/ after tsup). */
export function defaultSkillsDir(): string {
  return fileURLToPath(new URL("../skills/", import.meta.url));
}

/**
 * Parse SKILL.md YAML frontmatter without a YAML dependency. The Agent Skills
 * frontmatter is a flat map of scalars plus an optional one-level `metadata`
 * map, which is all this parser accepts: anything else is reported as an
 * error so an unparseable skill is skipped rather than served with a
 * frontmatter that does not match the file (hosts verify that).
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    throw new Error("SKILL.md must begin with YAML frontmatter");
  }
  const open = content.indexOf("\n") + 1;
  const closeMatch = /\n---\r?\n/.exec(content.slice(open));
  if (!closeMatch) throw new Error("frontmatter close fence not found");
  const block = content.slice(open, open + closeMatch.index);
  const out: Record<string, unknown> = {};
  let nested: { key: string; map: Record<string, string> } | null = null;
  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;
    const indented = /^\s+/.test(rawLine);
    if (indented) {
      if (!nested) throw new Error(`unexpected indented frontmatter line: ${rawLine}`);
      const m = /^\s+([A-Za-z0-9_.\/-]+):\s*(.*)$/.exec(rawLine);
      if (!m) throw new Error(`unparseable nested frontmatter line: ${rawLine}`);
      nested.map[m[1]!] = unquote(m[2]!);
      continue;
    }
    if (nested) {
      out[nested.key] = nested.map;
      nested = null;
    }
    const m = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(rawLine);
    if (!m) throw new Error(`unparseable frontmatter line: ${rawLine}`);
    const [, key, value] = m;
    if (value === "") {
      nested = { key: key!, map: {} };
    } else {
      out[key!] = unquote(value!);
    }
  }
  if (nested) out[nested.key] = nested.map;
  return out;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Byte-order comparison: deterministic across locales, unlike localeCompare. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256Digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "application/xml",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".ts": "text/typescript",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
};

export function mimeTypeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/yaml" ||
    mimeType === "application/toml" || mimeType === "application/xml";
}

function listFilesRecursive(root: string, dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name));
  for (const e of entries) {
    const full = join(dir, e.name);
    // Symlinks are not followed: a skill is the bytes inside its directory.
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) listFilesRecursive(root, full, out);
    else if (st.isFile()) out.push(relative(root, full).split(sep).join("/"));
  }
}

/**
 * Load one skill directory. Throws with a reason when the directory does not
 * hold a skill this server can serve faithfully.
 */
export function loadSkill(dir: string, name: string): LoadedSkill {
  const skillMdPath = join(dir, "SKILL.md");
  let raw: Buffer;
  try {
    raw = readFileSync(skillMdPath);
  } catch {
    throw new Error("no SKILL.md at the skill root");
  }
  const fm = parseFrontmatter(raw.toString("utf8"));
  const fmName = fm.name;
  const fmDescription = fm.description;
  if (typeof fmName !== "string" || !SKILL_NAME_RE.test(fmName) || fmName.length > MAX_NAME_LENGTH) {
    throw new Error("frontmatter name is missing or violates the Agent Skills naming rules");
  }
  if (fmName !== name) {
    throw new Error(`frontmatter name "${fmName}" does not match directory "${name}"`);
  }
  if (typeof fmDescription !== "string" || fmDescription.length < 1 || fmDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error("frontmatter description is missing or outside the 1 to 1024 character bound");
  }

  const relPaths: string[] = [];
  listFilesRecursive(dir, dir, relPaths);
  // SKILL.md first, then every supporting file in a deterministic order.
  relPaths.sort((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : byCodeUnit(a, b)));
  if (relPaths.length > MAX_SKILL_RESOURCES) {
    throw new Error(`${relPaths.length} files exceeds the ${MAX_SKILL_RESOURCES} resources per skill limit`);
  }

  const files: SkillFile[] = [];
  const resources: SkillResource[] = [];
  let total = 0;
  for (const rel of relPaths) {
    const bytes = rel === "SKILL.md" ? raw : readFileSync(join(dir, rel));
    total += bytes.byteLength;
    const uri = `${SKILL_URI_SCHEME}${name}/${rel}`;
    files.push({ uri, path: rel, bytes, mimeType: mimeTypeFor(rel) });
    resources.push({ uri, digest: sha256Digest(bytes), size: bytes.byteLength });
  }
  if (total > MAX_SKILL_BYTES) {
    throw new Error(`${total} bytes exceeds the ${MAX_SKILL_BYTES} total size per skill limit`);
  }

  return {
    entry: {
      uri: `${SKILL_URI_SCHEME}${name}/SKILL.md`,
      frontmatter: { ...fm, name: fmName, description: fmDescription },
      resources,
    },
    files,
  };
}

/** Load every `<dir>/<name>/SKILL.md` skill. Missing or empty directories yield an empty catalog. */
export function loadSkillsDir(dir: string): SkillsCatalog {
  const catalog: SkillsCatalog = { skills: [], skipped: [] };
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return catalog;
  }
  for (const name of entries) {
    const skillDir = join(dir, name);
    try {
      catalog.skills.push(loadSkill(skillDir, name));
    } catch (err) {
      catalog.skipped.push({ dir: skillDir, reason: (err as Error).message });
    }
  }
  return catalog;
}

// Request shapes for the two extension methods. Params carry the base
// protocol's `_meta` on newer revisions; passthrough keeps it opaque here.
const ListSkillsRequestSchema = z.object({
  method: z.literal("skills/list"),
  params: z.object({ cursor: z.string().optional() }).passthrough().optional(),
});

const GetSkillRequestSchema = z.object({
  method: z.literal("skills/get"),
  params: z.object({ uri: z.string() }).passthrough(),
});

/**
 * Wire a catalog into the server: declare the extension and the resources
 * capability, register one resource per skill file, and answer skills/list
 * and skills/get. Must run before the server connects to a transport.
 */
export function registerSkills(server: McpServer, skills: LoadedSkill[]): void {
  const sorted = [...skills].sort((a, b) => byCodeUnit(a.entry.uri, b.entry.uri));
  const byUri = new Map(sorted.map((s) => [s.entry.uri, s.entry] as const));

  // The extension depends on the Resources primitive, so both are declared
  // together. registerResource below also asserts the resources capability.
  server.server.registerCapabilities({
    resources: {},
    extensions: { [SKILLS_EXTENSION_ID]: {} },
  });

  for (const skill of sorted) {
    const skillName = skill.entry.frontmatter.name;
    for (const file of skill.files) {
      const isEntry = file.path === "SKILL.md";
      server.registerResource(
        isEntry ? skillName : `${skillName}/${file.path}`,
        file.uri,
        {
          title: isEntry ? `${skillName} skill` : `${skillName}: ${file.path}`,
          description: isEntry ? skill.entry.frontmatter.description : `Supporting file of the ${skillName} skill.`,
          mimeType: file.mimeType,
        },
        async () => ({
          contents: [
            isTextMime(file.mimeType)
              ? { uri: file.uri, mimeType: file.mimeType, text: file.bytes.toString("utf8") }
              : { uri: file.uri, mimeType: file.mimeType, blob: file.bytes.toString("base64") },
          ],
        }),
      );
    }
  }

  server.server.setRequestHandler(ListSkillsRequestSchema, async () => ({
    resultType: "complete",
    skills: sorted.map((s) => s.entry),
    ttlMs: SKILLS_TTL_MS,
    cacheScope: "public",
  }));

  server.server.setRequestHandler(GetSkillRequestSchema, async (request) => {
    const entry = byUri.get(request.params.uri);
    if (!entry) {
      throw new McpError(ErrorCode.InvalidParams, `No skill is served at ${request.params.uri}`);
    }
    return {
      resultType: "complete",
      skill: entry,
      ttlMs: SKILLS_TTL_MS,
      cacheScope: "public",
    };
  });
}
