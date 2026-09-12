import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_CONTEXT_FILE_BYTES } from "./read.js";

/**
 * Dependency-manifest context: the one source of project context nobody has
 * to author. A project's package.json / pyproject.toml / requirements.txt /
 * go.mod / Cargo.toml already says which libraries it uses and at which
 * versions, and version drift is the single most common way a coding agent
 * goes wrong on library questions (it answers for the version in its training
 * data, not the one installed). When a query names a dependency, the version
 * the project actually runs is compiled into the query as a quoted term
 * ("react 19.2"), so results land on the right major/minor of the docs.
 *
 * Tier 1 boundary (§8.3): manifests are read in-process. The only thing that
 * can leave the machine is the pin term for a dependency the query itself
 * already named, i.e. the version number of a library the agent was already
 * asking about. Nothing about unrelated dependencies, paths, or the manifest
 * contents travels anywhere.
 */

export type Ecosystem = "npm" | "pypi" | "go" | "cargo";

/**
 * How precisely the version is known:
 *  - "installed": read from the resolved package on disk (node_modules)
 *  - "locked":    read from a lockfile (package-lock.json, uv.lock, poetry.lock, Cargo.lock)
 *  - "exact":     pinned exactly in the manifest (==1.2.3, =1.2.3, v1.2.3)
 *  - "minor":     the manifest locks the minor (~1.2.x, ~=1.2.3)
 *  - "major":     the manifest only fixes the major (^1.2, >=1.2, 1.0 in Cargo)
 */
export type VersionPrecision = "installed" | "locked" | "exact" | "minor" | "major";

export interface DeclaredDependency {
  /** Canonical name as the ecosystem spells it: react, @tanstack/react-query, pydantic, github.com/gin-gonic/gin, serde. */
  name: string;
  ecosystem: Ecosystem;
  /** Version number extracted from the manifest specifier (no operators), e.g. "18.2.0". Undefined when unpinnable (*, latest, git URLs). */
  version?: string;
  precision?: "exact" | "minor" | "major";
}

export interface ManifestSet {
  /** Directory the manifests were found in (Tier 1: never copied into telemetry or responses). */
  dir: string;
  /** Manifest basenames found in `dir`, e.g. ["package.json", "pyproject.toml"] (safe for logs). */
  files: string[];
  dependencies: DeclaredDependency[];
}

export interface DependencyPin {
  /** Canonical dependency name. */
  name: string;
  ecosystem: Ecosystem;
  /** Resolved version as found, e.g. "19.2.1". */
  version: string;
  precision: VersionPrecision;
  /** Quoted-phrase-ready term compiled into the query, e.g. `react 19.2` or `react 18`. */
  term: string;
}

/** Manifest files recognised per directory; the nearest directory with any of them wins. */
const MANIFEST_FILES: ReadonlyArray<{ file: string; ecosystem: Ecosystem }> = [
  { file: "package.json", ecosystem: "npm" },
  { file: "pyproject.toml", ecosystem: "pypi" },
  { file: "requirements.txt", ecosystem: "pypi" },
  { file: "go.mod", ecosystem: "go" },
  { file: "Cargo.toml", ecosystem: "cargo" },
];

/** A runaway manifest must not turn every search into a full parse of a monorepo. */
export const MAX_DEPENDENCIES = 500;

/** Most pins injected per query: one library question rarely spans more than two libraries. */
export const MAX_PINS = 2;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readCapped(path: string): string | null {
  try {
    if (statSync(path).size > MAX_CONTEXT_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Walk up from `start` to the nearest directory holding a recognised manifest; parse everything found there. */
export function findManifests(start: string, maxDepth = 6): ManifestSet | null {
  let dir = resolve(start);
  for (let i = 0; i < maxDepth; i++) {
    const present = MANIFEST_FILES.filter((m) => isFile(join(dir, m.file)));
    if (present.length > 0) {
      const dependencies: DeclaredDependency[] = [];
      const seen = new Set<string>();
      for (const m of present) {
        const raw = readCapped(join(dir, m.file));
        if (raw === null) continue;
        for (const dep of parseManifest(m.file, raw)) {
          const key = `${dep.ecosystem}:${dep.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          dependencies.push(dep);
          if (dependencies.length >= MAX_DEPENDENCIES) break;
        }
        if (dependencies.length >= MAX_DEPENDENCIES) break;
      }
      return { dir, files: present.map((m) => m.file), dependencies };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Dispatch on the manifest basename. Exported for tests and library consumers. */
export function parseManifest(file: string, raw: string): DeclaredDependency[] {
  switch (basename(file)) {
    case "package.json":
      return parsePackageJson(raw);
    case "pyproject.toml":
      return parsePyproject(raw);
    case "requirements.txt":
      return parseRequirements(raw);
    case "go.mod":
      return parseGoMod(raw);
    case "Cargo.toml":
      return parseCargoToml(raw);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Version specifiers
// ---------------------------------------------------------------------------

const VERSION_NUMBER = /\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?/;

/** Interpret an npm/Cargo-style semver range specifier. */
function semverSpec(spec: string, cargoDefaultCaret = false): Pick<DeclaredDependency, "version" | "precision"> {
  const s = spec.trim();
  if (
    !s ||
    s === "*" ||
    s === "latest" ||
    s === "next" ||
    /^(workspace|file|link|npm|git|github|catalog|http|https):/i.test(s) ||
    /\/\//.test(s) ||
    s.includes("||")
  ) {
    return {};
  }
  // Compound ranges (">=1.2 <2") and hyphen ranges: the first bound is the floor.
  const first = s.split(/\s+/)[0]!;
  const m = VERSION_NUMBER.exec(first);
  if (!m) return {};
  const version = m[0];
  const op = first.slice(0, m.index);
  if (/x|\*/i.test(first.slice(m.index))) return { version, precision: "major" };
  if (op === "" || op === "=" || op === "v") {
    if (cargoDefaultCaret && op === "") return { version, precision: "major" };
    // A bare "18" or "18.2" in npm is an x-range on the missing parts.
    if (!cargoDefaultCaret && version.split(".").length < 3) {
      return { version, precision: version.includes(".") ? "minor" : "major" };
    }
    return { version, precision: "exact" };
  }
  if (op === "^") return { version, precision: "major" };
  if (op === "~") return { version, precision: "minor" };
  if (op === ">=" || op === ">") return { version, precision: "major" };
  // "<", "<=", "!=" alone say nothing about what is actually installed.
  return {};
}

/** Interpret a PEP 440 specifier set ("pydantic>=2.0,<3", "==0.115.0", "~=2.1"). */
function pep440Spec(spec: string): Pick<DeclaredDependency, "version" | "precision"> {
  const clauses = spec
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  // Strongest clause wins: exact, then compatible-release, then a floor.
  for (const c of clauses) {
    const m = /^===?\s*v?(\d+(?:\.\d+)*)(?:[.*]*)?$/.exec(c);
    if (m) return { version: m[1]!, precision: c.includes("*") ? "major" : "exact" };
  }
  for (const c of clauses) {
    const m = /^~=\s*v?(\d+(?:\.\d+)*)$/.exec(c);
    if (m) {
      const version = m[1]!;
      // ~=2.1 means >=2.1,==2.*; ~=2.1.3 means >=2.1.3,==2.1.*
      return { version, precision: version.split(".").length >= 3 ? "minor" : "major" };
    }
  }
  for (const c of clauses) {
    const m = /^>=?\s*v?(\d+(?:\.\d+)*)/.exec(c);
    if (m) return { version: m[1]!, precision: "major" };
  }
  return {};
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

const NPM_SECTIONS = ["dependencies", "devDependencies"] as const;

function parsePackageJson(raw: string): DeclaredDependency[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: DeclaredDependency[] = [];
  for (const section of NPM_SECTIONS) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== "string" || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) continue;
      out.push({ name, ecosystem: "npm", ...semverSpec(spec) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** PEP 503 name normalisation: case-insensitive, runs of -_. collapse to "-". */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** "fastapi[standard]>=0.115 ; python_version >= '3.9'" → a declared dependency, or null for URLs/flags. */
function parseRequirementLine(line: string): DeclaredDependency | null {
  const noComment = line.replace(/(^|\s)#.*$/, "").trim();
  if (!noComment || noComment.startsWith("-") || /@\s*\S+:\/\//.test(noComment) || /:\/\//.test(noComment)) {
    return null;
  }
  const req = noComment.split(";")[0]!.trim();
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(req);
  if (!m) return null;
  const name = normalizePythonName(m[1]!);
  if (name === "python") return null;
  return { name, ecosystem: "pypi", ...pep440Spec(m[3] ?? "") };
}

function parseRequirements(raw: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  for (const line of raw.split("\n")) {
    const dep = parseRequirementLine(line.replace(/\\\s*$/, ""));
    if (dep) out.push(dep);
  }
  return out;
}

interface TomlWalk {
  table: string;
  key: string;
  value: string;
}

/**
 * Minimal TOML line walk sufficient for dependency tables: `[table]` headers,
 * `key = "string"`, `key = { inline = "table" }`, and `key = [ multi-line
 * arrays of strings ]`. Full TOML is deliberately out of scope; anything the
 * walk does not understand is skipped rather than guessed at.
 */
function walkToml(raw: string): TomlWalk[] {
  const out: TomlWalk[] = [];
  let table = "";
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/^\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line);
    if (header) {
      table = header[1]!.replace(/\s/g, "");
      continue;
    }
    const kv = /^("?)([^"=\s]+)\1\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[2]!;
    let value = kv[3]!.trim();
    if (value.startsWith("[")) {
      // Multi-line array: gather until the brackets balance. Brackets inside
      // strings ("fastapi[standard]") do not count.
      while (i + 1 < lines.length && bracketDepth(value) > 0) {
        i++;
        value += "\n" + lines[i]!;
      }
    }
    out.push({ table, key, value });
  }
  return out;
}

/** Net open brackets in a TOML fragment, ignoring anything inside string literals and comments. */
function bracketDepth(fragment: string): number {
  let depth = 0;
  for (const line of fragment.split("\n")) {
    const stripped = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""').replace(/#.*$/, "");
    for (const ch of stripped) {
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
    }
  }
  return depth;
}

/** String items of a TOML array literal. */
function tomlStrings(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) out.push(m[1] ?? m[2] ?? "");
  return out;
}

/** The `version` of a TOML inline table, or the bare string value. Null for tables without a version (path/git deps). */
function tomlVersionValue(value: string): string | null {
  const v = value.trim();
  if (v.startsWith("{")) {
    const m = /\bversion\s*=\s*"([^"]*)"/.exec(v);
    return m ? m[1]! : null;
  }
  const s = /^"([^"]*)"|^'([^']*)'/.exec(v);
  return s ? (s[1] ?? s[2] ?? "") : null;
}

function parsePyproject(raw: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  for (const { table, key, value } of walkToml(raw)) {
    // PEP 621 and PEP 735: arrays of requirement strings.
    if ((table === "project" && key === "dependencies") || table === "dependency-groups") {
      for (const req of tomlStrings(value)) {
        const dep = parseRequirementLine(req);
        if (dep) out.push(dep);
      }
      continue;
    }
    // Poetry: `name = "^2.5"` / `name = { version = "^2.5", extras = [...] }`.
    if (table === "tool.poetry.dependencies" || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(table)) {
      if (key === "python") continue;
      const spec = tomlVersionValue(value);
      if (spec === null) continue;
      out.push({ name: normalizePythonName(key), ecosystem: "pypi", ...poetrySpec(spec) });
    }
  }
  return out;
}

/** Poetry constraints: ^ major, ~ minor, bare exact, PEP 440 operators otherwise. */
function poetrySpec(spec: string): Pick<DeclaredDependency, "version" | "precision"> {
  const s = spec.trim();
  if (!s || s === "*") return {};
  if (/^[~^]/.test(s) || /^\d/.test(s)) return semverSpec(s);
  return pep440Spec(s);
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function parseGoMod(raw: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  let inRequire = false;
  const push = (path: string, version: string, comment: string): void => {
    if (/\/\/\s*indirect/.test(comment)) return;
    // Pseudo-versions (v0.0.0-20240101120000-abcdef123456) name a commit, not a release.
    if (/^v?\d+\.\d+\.\d+-\d{14}-[0-9a-f]{12}$/.test(version)) return;
    const m = /^v?(\d+(?:\.\d+)*)/.exec(version);
    if (!m) return;
    out.push({ name: path, ecosystem: "go", version: m[1]!, precision: "exact" });
  };
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    if (inRequire) {
      if (line.startsWith(")")) {
        inRequire = false;
        continue;
      }
      const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(line);
      if (m) push(m[1]!, m[2]!, m[3] ?? "");
      continue;
    }
    if (/^require\s*\(/.test(line)) {
      inRequire = true;
      continue;
    }
    const single = /^require\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (single) push(single[1]!, single[2]!, single[3] ?? "");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cargo
// ---------------------------------------------------------------------------

const CARGO_TABLES = /^(workspace\.)?(dependencies|dev-dependencies|build-dependencies)$/;
/** `[dependencies.serde]` sub-table form: the crate is the last header segment, `version = "…"` inside. */
const CARGO_SUBTABLE = /^(?:workspace\.)?(?:dependencies|dev-dependencies|build-dependencies)\.([^.]+)$/;

function parseCargoToml(raw: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  for (const { table, key, value } of walkToml(raw)) {
    let name: string;
    let spec: string | null;
    if (CARGO_TABLES.test(table)) {
      name = key;
      spec = tomlVersionValue(value);
    } else {
      const sub = CARGO_SUBTABLE.exec(table);
      if (!sub || key !== "version") continue;
      name = sub[1]!.replace(/^"|"$/g, "");
      spec = tomlVersionValue(value);
    }
    if (spec === null) continue;
    // Cargo's bare "1.0" is a caret requirement; "=1.2.3" is exact.
    out.push({ name, ecosystem: "cargo", ...semverSpec(spec, true) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolution: what is actually installed beats what the manifest asked for
// ---------------------------------------------------------------------------

function npmInstalledVersion(dir: string, name: string): string | null {
  const raw = readCapped(join(dir, "node_modules", ...name.split("/"), "package.json"));
  if (raw === null) return null;
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" && VERSION_NUMBER.test(v) ? v : null;
  } catch {
    return null;
  }
}

function npmLockedVersion(dir: string, name: string): string | null {
  const raw = readCapped(join(dir, "package-lock.json"));
  if (raw === null) return null;
  try {
    const lock = JSON.parse(raw) as {
      packages?: Record<string, { version?: unknown }>;
      dependencies?: Record<string, { version?: unknown }>;
    };
    const v = lock.packages?.[`node_modules/${name}`]?.version ?? lock.dependencies?.[name]?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** `[[package]]` tables shared by uv.lock, poetry.lock, and Cargo.lock: name = "x" / version = "y". */
function tomlLockedVersion(dir: string, file: string, name: string, normalize: (n: string) => string): string | null {
  const raw = readCapped(join(dir, file));
  if (raw === null) return null;
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    const n = /^name\s*=\s*"([^"]+)"/.exec(line);
    if (n) {
      current = normalize(n[1]!);
      continue;
    }
    const v = /^version\s*=\s*"([^"]+)"/.exec(line);
    if (v && current === name) return v[1]!;
    if (line.startsWith("[[")) current = null;
  }
  return null;
}

/** Resolve the most precise version knowable for `dep` from the manifest directory. */
export function resolveDependency(set: ManifestSet, dep: DeclaredDependency): DependencyPin | null {
  let version: string | undefined;
  let precision: VersionPrecision | undefined;
  switch (dep.ecosystem) {
    case "npm": {
      const installed = npmInstalledVersion(set.dir, dep.name);
      if (installed) [version, precision] = [installed, "installed"];
      else {
        const locked = npmLockedVersion(set.dir, dep.name);
        if (locked) [version, precision] = [locked, "locked"];
      }
      break;
    }
    case "pypi": {
      const locked =
        tomlLockedVersion(set.dir, "uv.lock", dep.name, normalizePythonName) ??
        tomlLockedVersion(set.dir, "poetry.lock", dep.name, normalizePythonName);
      if (locked) [version, precision] = [locked, "locked"];
      break;
    }
    case "cargo": {
      const locked = tomlLockedVersion(set.dir, "Cargo.lock", dep.name, (n) => n);
      if (locked) [version, precision] = [locked, "locked"];
      break;
    }
    case "go":
      break;
  }
  if (!version) {
    if (!dep.version || !dep.precision) return null;
    version = dep.version;
    precision = dep.precision;
  }
  const term = pinTerm(displayName(dep), version, precision!);
  if (!term) return null;
  return { name: dep.name, ecosystem: dep.ecosystem, version, precision: precision!, term };
}

/** The name people type: bare package for scoped npm, last path segment for Go modules. */
export function displayName(dep: Pick<DeclaredDependency, "name" | "ecosystem">): string {
  if (dep.ecosystem === "go") {
    const segments = dep.name.split("/").filter((s) => !/^v\d+$/.test(s));
    return segments[segments.length - 1] ?? dep.name;
  }
  if (dep.ecosystem === "npm" && dep.name.startsWith("@")) return dep.name.split("/")[1] ?? dep.name;
  return dep.name;
}

/**
 * The version granularity documentation is written at: major.minor when the
 * version is known that precisely, major only when the manifest merely fixes
 * the major (a `^18.2.0` project may run 18.3). 0.x majors are always
 * major.minor, since 0.x minors are the breaking ones.
 */
export function pinTerm(name: string, version: string, precision: VersionPrecision): string | null {
  const parts = version.split(/[-+]/)[0]!.split(".");
  const major = parts[0];
  if (major === undefined || !/^\d+$/.test(major)) return null;
  const minor = parts[1];
  if (precision === "major" && major !== "0") return `${name} ${major}`;
  if (minor === undefined) return `${name} ${major}`;
  return `${name} ${major}.${minor}`;
}

// ---------------------------------------------------------------------------
// Matching queries to dependencies
// ---------------------------------------------------------------------------

/**
 * Common query spellings that differ from the package name. Values are
 * canonical package names, tried in order; the first one the project
 * actually depends on wins.
 */
const QUERY_ALIASES: Record<string, string[]> = {
  nextjs: ["next"],
  "next.js": ["next"],
  reactjs: ["react"],
  "react.js": ["react"],
  vuejs: ["vue"],
  "vue.js": ["vue"],
  nuxtjs: ["nuxt"],
  angular: ["@angular/core"],
  sveltekit: ["@sveltejs/kit"],
  tailwind: ["tailwindcss"],
  "react-query": ["@tanstack/react-query"],
  tanstack: ["@tanstack/react-query", "@tanstack/query-core", "@tanstack/router", "@tanstack/react-router"],
  prisma: ["prisma", "@prisma/client"],
  supabase: ["@supabase/supabase-js", "supabase"],
  trpc: ["@trpc/server", "@trpc/client"],
  mui: ["@mui/material"],
  drizzle: ["drizzle-orm"],
  langchain: ["langchain", "@langchain/core", "langchain-core"],
  anthropic: ["@anthropic-ai/sdk", "anthropic"],
  mcp: ["@modelcontextprotocol/sdk", "mcp"],
  opentelemetry: ["@opentelemetry/api", "opentelemetry-api"],
  otel: ["@opentelemetry/api", "opentelemetry-api"],
  pytorch: ["torch"],
  sklearn: ["scikit-learn"],
  "scikit-learn": ["scikit-learn"],
  sqlalchemy: ["sqlalchemy"],
  pydantic: ["pydantic"],
  tokio: ["tokio"],
  gin: ["github.com/gin-gonic/gin"],
  echo: ["github.com/labstack/echo/v4", "github.com/labstack/echo"],
  fiber: ["github.com/gofiber/fiber/v2", "github.com/gofiber/fiber/v3"],
  gorm: ["gorm.io/gorm"],
  cobra: ["github.com/spf13/cobra"],
  viper: ["github.com/spf13/viper"],
};

/**
 * Queries about moving between versions want the destination, not the
 * version currently installed. Pinning "react 18" onto "react 19 upgrade
 * guide" would fight the agent, so these intents skip pinning entirely.
 */
const VERSION_CHANGE_INTENT =
  /\b(upgrad(e|es|ed|ing)|migrat(e|es|ed|ing|ion)|changelog|release notes|breaking changes|what'?s new|latest version|newest version|new version|bump(ing)?)\b/i;

/** Lowercased query tokens keeping package punctuation (@scope/name, next.js, date-fns, x/net). */
function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@./_-]+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean);
}

/** All spellings a dependency may appear under in a query. */
function lookupKeys(dep: DeclaredDependency): string[] {
  const keys = new Set<string>();
  const name = dep.name.toLowerCase();
  keys.add(name);
  switch (dep.ecosystem) {
    case "npm":
      if (name.startsWith("@")) keys.add(name.slice(1));
      break;
    case "pypi":
      keys.add(name.replace(/-/g, "_"));
      keys.add(name.replace(/-/g, "."));
      break;
    case "cargo":
      keys.add(name.replace(/-/g, "_"));
      keys.add(name.replace(/_/g, "-"));
      break;
    case "go": {
      const segments = name.split("/");
      const meaningful = segments.filter((s) => !/^v\d+$/.test(s));
      const last = meaningful[meaningful.length - 1];
      // golang.org/x/* last segments (net, text, sync) collide with ordinary words.
      if (last && last.length >= 3 && !name.startsWith("golang.org/x/")) keys.add(last);
      if (meaningful.length >= 3) keys.add(meaningful.slice(-2).join("/"));
      break;
    }
  }
  return [...keys];
}

/**
 * Dependencies the query names, resolved to pin terms. At most `max` pins,
 * in query order. Skips: version-change intents, and names the query already
 * qualifies with a version (the agent pinned it deliberately).
 */
export function pinDependencies(query: string, set: ManifestSet | null, max = MAX_PINS): DependencyPin[] {
  if (!set || set.dependencies.length === 0 || max <= 0) return [];
  if (VERSION_CHANGE_INTENT.test(query)) return [];

  const byKey = new Map<string, DeclaredDependency>();
  const byName = new Map<string, DeclaredDependency>();
  for (const dep of set.dependencies) {
    byName.set(dep.name.toLowerCase(), dep);
    for (const key of lookupKeys(dep)) if (!byKey.has(key)) byKey.set(key, dep);
  }

  const tokens = queryTokens(query);
  const pins: DependencyPin[] = [];
  const pinned = new Set<string>();
  for (let i = 0; i < tokens.length && pins.length < max; i++) {
    const token = tokens[i]!;
    let dep = byKey.get(token);
    if (!dep) {
      for (const candidate of QUERY_ALIASES[token] ?? []) {
        dep = byName.get(candidate.toLowerCase());
        if (dep) break;
      }
    }
    if (!dep || pinned.has(dep.name)) continue;
    // "react 18 hooks" / "react@18": the query already carries a version.
    const next = tokens[i + 1];
    if ((next && /^v?\d+(\.\d+)*$/.test(next)) || /@\d/.test(token)) continue;
    const pin = resolveDependency(set, dep);
    if (!pin) continue;
    pinned.add(dep.name);
    pins.push(pin);
  }
  return pins;
}
