/** Shared content + constants for the landing page. Single source of truth. */

export const SITE = {
  name: "MCP Profiles",
  url: "https://mcp-profiles.vercel.app",
  description:
    "Portable, reusable identity for AI agents. MCP standardized tool access — MCP Profiles standardize agent behavior. Same model, different outcomes.",
  github: "https://github.com/brainsparker/MCP-Profiles",
  spec: "https://github.com/brainsparker/MCP-Profiles/tree/main/spec",
  npm: "https://www.npmjs.com/package/mcp-profiles",
  quickstart: "https://github.com/brainsparker/MCP-Profiles#quick-start",
} as const;

/** The hero / idea profile snippet (Brian's example), as a YAML string. */
export const GROWTH_PM_YAML = `profile: growth_pm

memory:
  - company metrics
  - pricing history

sources:
  - internal docs
  - web search

tools:
  - search
  - spreadsheet

retrieval:
  freshness: high
  authority: medium`;

/** The six concerns every app reimplements today. */
export const REIMPLEMENTED = [
  { title: "Memory", detail: "What the agent remembers across sessions." },
  { title: "Preferred sources", detail: "Where it looks for information first." },
  { title: "Retrieval strategies", detail: "How it weighs freshness and authority." },
  { title: "Tool permissions", detail: "Which tools it is allowed to use." },
  { title: "Workflow rules", detail: "The guardrails it operates within." },
  { title: "Operating procedures", detail: "How it actually approaches work." },
] as const;

/** Context capabilities that increasingly drive differentiation. */
export const CONTEXT_CAPABILITIES = [
  "What an agent remembers",
  "What information it retrieves",
  "Which tools it can access",
  "How it evaluates decisions",
  "The workflows it follows",
] as const;

/** Example profiles — same model, different outcomes. */
export const EXAMPLE_PROFILES = [
  {
    id: "growth_pm",
    name: "Growth PM",
    focus: "Optimized for metrics, experimentation, activation, and monetization.",
  },
  {
    id: "research_analyst",
    name: "Research Analyst",
    focus: "Optimized for citation quality, source authority, and structured analysis.",
  },
  {
    id: "software_engineer",
    name: "Software Engineer",
    focus: "Optimized for implementation quality, debugging, and technical accuracy.",
  },
  {
    id: "customer_support",
    name: "Customer Support Agent",
    focus: "Optimized for resolution speed, policy adherence, and customer satisfaction.",
  },
] as const;
