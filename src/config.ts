import { homedir } from "node:os";
import { join } from "node:path";

/**
 * How compiled context reaches the Search API (PRD open question §14.7):
 *  - "auto"      — send the native Product A parameters AND inject query-side
 *                  vocabulary/exclusions. Recall-preserving: no site: narrowing.
 *  - "operators" — compile everything into provider-portable lexical operators
 *                  (site:/-site:/after:); native parameters are not sent.
 *  - "native"    — send native parameters only; query-side compilation is
 *                  limited to NL keywordization plus decisions-ledger
 *                  exclusions (the ledger's only carrier until the
 *                  prior_decisions native parameter ships, v2.1).
 */
export type CompileMode = "auto" | "operators" | "native";

export interface Config {
  apiKey?: string;
  baseUrl: string;
  /** Where Mechanism C looks for the harness-context file (walks up from here). */
  projectRoot: string;
  /** §8.3: developers can opt out of context-file reading entirely (model-population only). */
  readContext: boolean;
  /**
   * Opt-in (YOU_AWARE_CONTEXT_FALLBACK=head): without an explicit
   * `## Project Context` section, use the top 4 KB of the context file as
   * project_context on the search call. Off by default — the head is raw file
   * content, and the search call transmits it.
   */
  contextHeadFallback: boolean;
  /** Harness identifier stamped on Tier 2 events (e.g. set by an installer); never auto-detected. */
  harness: string;
  /** §8.3 Tier 2 opt-out flag. */
  telemetry: boolean;
  /** Remote Tier 2 sink. Events always spool locally (JSONL) while telemetry is on. */
  telemetryUrl?: string;
  telemetryDir: string;
  /** Per-project retrieval memory (Tier 1, local only). Opt-out via --no-memory. */
  memory: boolean;
  /** Root for local Tier 1 state (the per-project memory store). Independent of the telemetry opt-out. */
  dataDir: string;
  compileMode: CompileMode;
  /** Recency window (days) compiled from freshness:"fresh" in operators mode. */
  freshWindowDays: number;
  /** Result count requested from the Search API. */
  count: number;
  /** Hosted MCP endpoint used for the keyless free tier (`?profile=free` is appended). */
  hostedMcpUrl: string;
}

export const DEFAULT_BASE_URL = "https://ydc-index.io/v1";

const COMPILE_MODES: readonly string[] = ["auto", "operators", "native"];

/**
 * Some MCP clients substitute unset `{env:VAR}` config references to "" before
 * spawning the server — an empty env value must behave exactly like an unset one.
 */
function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function positiveInt(name: string, raw: string | undefined, dflt: number, max: number): number {
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`invalid ${name} "${raw}" (expected an integer 1-${max})`);
  }
  return n;
}

function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

/** Minimal `--flag [value]` parser; flags without a following value are booleans. */
function parseFlags(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

/** Precedence: CLI flag > env var > default. */
export function loadConfig(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): Config {
  const args = parseFlags(argv);
  const str = (k: string): string | undefined => {
    const v = args.get(k);
    return typeof v === "string" ? v : undefined;
  };

  const compileMode = str("compile-mode") ?? nonEmpty(env.YOU_AWARE_COMPILE_MODE) ?? "auto";
  if (!COMPILE_MODES.includes(compileMode)) {
    throw new Error(`invalid compile mode "${compileMode}" (expected auto | operators | native)`);
  }

  const telemetryDir =
    str("telemetry-dir") ?? nonEmpty(env.YOU_AWARE_TELEMETRY_DIR) ?? join(homedir(), ".you-aware");

  return {
    apiKey: str("api-key") ?? nonEmpty(env.YDC_API_KEY) ?? nonEmpty(env.YOU_API_KEY),
    baseUrl: str("base-url") ?? nonEmpty(env.YOU_API_BASE_URL) ?? DEFAULT_BASE_URL,
    projectRoot: str("project-root") ?? nonEmpty(env.YOU_AWARE_PROJECT_ROOT) ?? process.cwd(),
    readContext: args.has("no-context-read") ? false : (envFlag(env.YOU_AWARE_READ_CONTEXT) ?? true),
    contextHeadFallback:
      (str("context-fallback") ?? nonEmpty(env.YOU_AWARE_CONTEXT_FALLBACK))?.toLowerCase() === "head",
    harness: str("harness") ?? nonEmpty(env.YOU_AWARE_HARNESS) ?? "unknown",
    telemetry: args.has("no-telemetry") ? false : (envFlag(env.YOU_AWARE_TELEMETRY) ?? true),
    telemetryUrl: str("telemetry-url") ?? nonEmpty(env.YOU_AWARE_TELEMETRY_URL),
    telemetryDir,
    memory: args.has("no-memory") ? false : (envFlag(env.YOU_AWARE_MEMORY) ?? true),
    dataDir: str("data-dir") ?? nonEmpty(env.YOU_AWARE_DATA_DIR) ?? telemetryDir,
    compileMode: compileMode as CompileMode,
    freshWindowDays: positiveInt(
      "fresh-window-days",
      str("fresh-window-days") ?? nonEmpty(env.YOU_AWARE_FRESH_WINDOW_DAYS),
      180,
      3650,
    ),
    count: positiveInt("count", str("count") ?? nonEmpty(env.YOU_AWARE_COUNT), 10, 50),
    hostedMcpUrl: str("hosted-mcp-url") ?? nonEmpty(env.YOU_AWARE_HOSTED_MCP_URL) ?? "https://api.you.com/mcp",
  };
}
