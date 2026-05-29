/* AUTO-GENERATED from spec/profile.schema.json — do not edit by hand. Run: npm run gen:types */

export type MemorySource = {
  [k: string]: unknown;
} & {
  id: string;
  type: "inline" | "mcp-resource" | "file";
  content?: string;
  uri?: string;
  path?: string;
  mode?: "read" | "read-write";
};

/**
 * An MCP Profile: a reusable operating system for an agent, defining persona, memory, retrieval, tool permissions, and workflow.
 */
export interface Profile {
  /**
   * Spec version. Enables forward-compatible migration.
   */
  apiVersion: "mcp-profiles/v1";
  kind: "Profile";
  metadata: {
    /**
     * Stable slug. Used as the switch key and as a namespace prefix.
     */
    id: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    tags?: string[];
  };
  persona?: {
    role?: string;
    objectives?: string[];
    voice?: string;
  };
  memory?: {
    sources?: MemorySource[];
    retentionHint?: "session-only" | "persist-across-sessions";
  };
  retrieval?: {
    strategy?: "semantic" | "keyword" | "hybrid" | "recency";
    topK?: number;
    sources?: RetrievalSource[];
    /**
     * Free-form hint for what to do when no source matches (e.g. 'web-search').
     */
    fallback?: string;
  };
  /**
   * The enforcement surface. The gateway re-exposes only the tools permitted here.
   */
  tools: {
    defaultPolicy: "deny" | "allow";
    allow?: ToolRule[];
    deny?: ToolRule[];
  };
  workflow?: {
    rules?: string[];
    procedures?: Procedure[];
  };
  settings?: {
    toolTimeoutMs?: number;
    exposeProcedureAsPrompt?: boolean;
    exposeMemoryAsResource?: boolean;
  };
}
export interface RetrievalSource {
  id: string;
  /**
   * Id of a downstream server (see gateway config) backing this source.
   */
  via?: string;
  priority?: number;
}
export interface ToolRule {
  /**
   * Downstream server id this rule applies to.
   */
  server: string;
  /**
   * Tool names, or '*' for all tools of the server.
   *
   * @minItems 1
   */
  tools: [string, ...string[]];
  /**
   * Optional map of originalToolName -> exposed display name.
   */
  rename?: {
    [k: string]: string;
  };
}
export interface Procedure {
  id: string;
  title: string;
  description?: string;
  /**
   * @minItems 1
   */
  steps: [string, ...string[]];
}
