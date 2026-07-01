/**
 * Public library entry (side-effect free). The npm bin runs src/index.ts;
 * programmatic consumers import from here — embed the server, reuse the
 * search clients, or drive the compiler directly.
 */

export { buildServer, type ServerDeps } from "./server.js";
export { loadConfig, DEFAULT_BASE_URL, type Config, type CompileMode } from "./config.js";
export {
  YouComClient,
  parseHits,
  KEYED_RATE_LIMIT_HINT,
  type SearchClient,
  type SearchRequest,
  type YouComClientOptions,
} from "./youcom.js";
export { HostedMcpClient, DEFAULT_HOSTED_MCP_URL, UPGRADE_HINT, type HostedMcpOptions } from "./hostedClient.js";
export { compileQuery } from "./compile.js";
export { parseHarnessContext } from "./context/parse.js";
export { findContextSource, readContextSource, MAX_CONTEXT_FILE_BYTES } from "./context/read.js";
export { CONTEXT_SOURCES, type ContextSource, type ResolvedContext } from "./context/sources.js";
export {
  ProjectMemory,
  BOOST_MIN_CITED,
  BOOST_MIN_SESSIONS,
  SUGGEST_MIN_CITED,
  SUGGEST_MIN_SESSIONS,
  RESUGGEST_DELTA,
  type ContextSuggestion,
  type MemoryFile,
  type ProjectMemoryOptions,
} from "./memory.js";
export { populateParams, type ParamProvenance } from "./params.js";
export { postRank, domainOf } from "./rank.js";
export { SessionMemory } from "./session.js";
export { Telemetry, type Tier2Event, type TelemetryOptions } from "./telemetry.js";
export { formatTrace, type Trace } from "./trace.js";
export {
  PROJECT_CONTEXT_MAX_BYTES,
  truncateUtf8,
  type Decision,
  type Freshness,
  type HarnessContext,
  type SearchHit,
  type SearchParams,
} from "./types.js";
export { VERSION } from "./version.js";
