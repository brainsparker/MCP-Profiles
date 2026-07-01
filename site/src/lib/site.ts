/** Shared content + constants for the landing page. Single source of truth. */

export const SITE = {
  name: "you-aware",
  url: "https://mcp-profiles.vercel.app",
  description:
    "Context-aware web search for AI agents. you-aware reads your project's AGENTS.md and compiles it into every search — trusted sources, past decisions, your actual stack.",
  github: "https://github.com/brainsparker/MCP-Profiles",
  npm: "https://www.npmjs.com/package/@youdotcom-oss/you-aware",
  quickstart: "https://github.com/brainsparker/MCP-Profiles#install",
  dataHandling: "https://github.com/brainsparker/MCP-Profiles/blob/main/docs/data-handling.md",
  conventions: "https://github.com/brainsparker/MCP-Profiles/blob/main/docs/context-conventions.md",
} as const;

export const INSTALL_COMMAND = "npx -y @youdotcom-oss/you-aware";

/** The context file the server reads — the hero's left-hand exhibit. */
export const AGENTS_MD_SNIPPET = `## Project Context
TypeScript app using date-fns.
@tanstack/query for data fetching.

## Trusted Sources
- react.dev
- tanstack.com

## Blocked Sources
- w3schools.com

## Decisions
- Rejected moment.js in favor of date-fns.`;

/** What the same question becomes on the wire. Real output, not a mock. */
export const COMPILED_SNIPPET = `query_received: "best way to handle date
  parsing in this project"

query_compiled: typescript date parsing
  "date-fns" -moment

trusted_sources: [react.dev, tanstack.com]
blocked_sources: [w3schools.com]
decisions_applied: ["moment.js rejected → -moment"]`;

/** The full trace block — rendered verbatim from a real response. */
export const TRACE_SNIPPET = `trace:
  query_received: "best way to handle date parsing in this project"
  query_compiled: "typescript date parsing \\"date-fns\\" -moment"
  trusted_sources_boost: [react.dev, tanstack.com]
  blocked_sources_applied: [w3schools.com]
  memory_boost: [stackoverflow.com]
  decisions_applied: ["moment.js rejected → -moment"]
  project_context_chars: 1284
  freshness: "stable"
  pre_rank_top_3: [w3schools.com, blog.example.com, react.dev]
  post_rank_top_3: [react.dev, tanstack.com, stackoverflow.com]
  tier: "keyed"`;

/** What generic agent search gets wrong — every one of these is a real failure mode. */
export const SEARCH_FAILURES = [
  {
    title: "Re-suggests what you rejected",
    detail:
      "Your project ruled out moment.js months ago. Generic search happily ranks it #1 on every date question.",
  },
  {
    title: "Reads the sources you distrust",
    detail:
      "The agent cites the same low-quality tutorial sites you would never open yourself.",
  },
  {
    title: "Forgets your stack",
    detail:
      "“How do I parse dates?” returns Python answers for your TypeScript repo — the query never mentioned the stack you wrote down.",
  },
  {
    title: "Asks the same thing twice",
    detail:
      "Agents loop, re-searching near-identical queries with nothing learned in between.",
  },
] as const;

/** The pipeline, step by step. */
export const PIPELINE_STEPS = [
  {
    title: "Read",
    detail:
      "The context your harness already has: AGENTS.md first, then CLAUDE.md, GEMINI.md, Copilot, Cursor, Cline, or Windsurf rules — nearest file wins.",
  },
  {
    title: "Merge",
    detail:
      "The model can add conversation-level context per call; the deterministic file read is the safety net underneath it.",
  },
  {
    title: "Compile",
    detail:
      "Natural language becomes the lexical, operator-shaped query agents actually need — vocabulary injected, rejected options excluded.",
  },
  {
    title: "Search & rank",
    detail:
      "The You.com Search API runs the query; trusted domains boost, blocked domains sink, remembered domains rise.",
  },
  {
    title: "Trace",
    detail:
      "Every response ends with exactly what ran — received query, compiled query, every boost and exclusion applied.",
  },
] as const;

/** The write-back memory loop. */
export const MEMORY_LOOP = [
  {
    title: "Report",
    code: "report_outcome",
    detail:
      "After using results, the agent reports which URLs it actually cited. Validated against what search returned — hallucinated URLs are rejected.",
  },
  {
    title: "Boost",
    code: "memory_boost",
    detail:
      "Domains cited across multiple sessions earn a soft rank boost — visible in the trace, never merged into your explicit config.",
  },
  {
    title: "Suggest",
    code: "context_suggestions",
    detail:
      "With enough evidence — “cited 4 times across 3 sessions” — the server proposes the exact AGENTS.md line to add. Your agent applies it; the server never edits your files.",
  },
] as const;

/** The two-tier data posture, matching docs/data-handling.md. */
export const DATA_TIERS = {
  stays: [
    "Raw AGENTS.md / rules-file contents",
    "Conversation history",
    "File paths and project names",
    "The per-project memory store",
    "Telemetry — local spool only, unless you configure a sink",
  ],
  flows: [
    "Your search query, compiled (that's the search)",
    "Populated search parameters",
    "Explicit ## Project Context sections (only those)",
  ],
} as const;

/** Client install matrix. */
export const CLIENTS = [
  { name: "OpenCode", config: "opencode.json", reads: "AGENTS.md" },
  { name: "Claude Code", config: "claude mcp add", reads: "AGENTS.md / CLAUDE.md" },
  { name: "Cursor", config: ".cursor/mcp.json", reads: ".cursor/rules/*.mdc" },
  { name: "Codex CLI", config: "~/.codex/config.toml", reads: "AGENTS.md" },
  { name: "Gemini CLI", config: ".gemini/settings.json", reads: "GEMINI.md" },
  { name: "Cline", config: "cline_mcp_settings.json", reads: ".clinerules" },
  { name: "Windsurf", config: "mcp_config.json", reads: ".windsurfrules" },
  { name: "Anything MCP", config: "mcpServers block", reads: "AGENTS.md" },
] as const;
