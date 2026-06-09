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
  /** §8.3: developers can opt out of CLAUDE.md reading entirely (model-population only). */
  readContext: boolean;
  /** §8.3 Tier 2 opt-out flag. */
  telemetry: boolean;
  /** Remote Tier 2 sink. Events always spool locally (JSONL) while telemetry is on. */
  telemetryUrl?: string;
  telemetryDir: string;
  compileMode: CompileMode;
  /** Recency window (days) compiled from freshness:"fresh" in operators mode. */
  freshWindowDays: number;
  /** Result count requested from the Search API. */
  count: number;
  /** Hosted MCP endpoint used for the keyless free tier (`?profile=free` is appended). */
  hostedMcpUrl: string;
}

export const DEFAULT_BASE_URL = "https://api.ydc-index.io";

const COMPILE_MODES: readonly string[] = ["auto", "operators", "native"];

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

  const compileMode = str("compile-mode") ?? env.YOU_AWARE_COMPILE_MODE ?? "auto";
  if (!COMPILE_MODES.includes(compileMode)) {
    throw new Error(`invalid compile mode "${compileMode}" (expected auto | operators | native)`);
  }

  return {
    apiKey: str("api-key") ?? env.YDC_API_KEY ?? env.YOU_API_KEY,
    baseUrl: str("base-url") ?? env.YOU_API_BASE_URL ?? DEFAULT_BASE_URL,
    projectRoot: str("project-root") ?? env.YOU_AWARE_PROJECT_ROOT ?? process.cwd(),
    readContext: args.has("no-context-read") ? false : (envFlag(env.YOU_AWARE_READ_CONTEXT) ?? true),
    telemetry: args.has("no-telemetry") ? false : (envFlag(env.YOU_AWARE_TELEMETRY) ?? true),
    telemetryUrl: str("telemetry-url") ?? env.YOU_AWARE_TELEMETRY_URL,
    telemetryDir: str("telemetry-dir") ?? env.YOU_AWARE_TELEMETRY_DIR ?? join(homedir(), ".you-aware"),
    compileMode: compileMode as CompileMode,
    freshWindowDays: Number(str("fresh-window-days") ?? env.YOU_AWARE_FRESH_WINDOW_DAYS ?? 180),
    count: Number(str("count") ?? env.YOU_AWARE_COUNT ?? 10),
    hostedMcpUrl: str("hosted-mcp-url") ?? env.YOU_AWARE_HOSTED_MCP_URL ?? "https://api.you.com/mcp",
  };
}
