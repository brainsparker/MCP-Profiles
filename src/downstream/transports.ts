import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DownstreamServerSpec } from "../config/serverConfig.js";

/** Build the appropriate client transport for a downstream server spec. */
export function buildClientTransport(spec: DownstreamServerSpec): Transport {
  if (spec.transport === "stdio") {
    return new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: spec.env,
      cwd: spec.cwd,
      // Forward the child's stderr to ours so downstream logs are visible
      // without polluting our own stdout (reserved for our protocol stream).
      stderr: "inherit",
    });
  }
  return new StreamableHTTPClientTransport(new URL(spec.url), {
    requestInit: spec.headers ? { headers: spec.headers } : undefined,
  });
}
