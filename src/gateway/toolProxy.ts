import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../downstream/connectionManager.js";
import type { ResolvedTool } from "./permissions.js";
import { log } from "../util/logger.js";

/**
 * Convert resolved (allowed) tools into the upstream-facing Tool list. We pass
 * the downstream JSON Schema through verbatim — no lossy conversion — which is
 * exactly why the gateway uses the low-level Server for the tool surface.
 */
export function buildToolList(resolved: ResolvedTool[]): Tool[] {
  return resolved.map(({ displayName, entry }) => ({
    name: displayName,
    description: entry.description
      ? `${entry.description} (via ${entry.serverId})`
      : `Proxied from ${entry.serverId}`,
    inputSchema: entry.inputSchema,
  }));
}

/**
 * Route a permitted tool call to its downstream server. The caller has already
 * verified the tool is allowed under the active profile (defense in depth lives
 * at the ListTools surface; this re-checks via the resolved map it is handed).
 */
export async function callProxiedTool(
  cm: ConnectionManager,
  resolved: ResolvedTool,
  args: Record<string, unknown> | undefined,
  timeoutMs?: number,
): Promise<CallToolResult> {
  const { entry } = resolved;
  const conn = cm.get(entry.serverId);
  if (!conn) {
    return {
      isError: true,
      content: [{ type: "text", text: `Downstream server "${entry.serverId}" is not connected.` }],
    };
  }
  try {
    const result = (await conn.client.callTool(
      { name: entry.originalName, arguments: args ?? {} },
      undefined,
      timeoutMs ? { timeout: timeoutMs } : undefined,
    )) as CallToolResult;
    return result;
  } catch (err) {
    const message = (err as Error).message;
    log.error(`call to "${entry.serverId}/${entry.originalName}" failed: ${message}`);
    return { isError: true, content: [{ type: "text", text: `Downstream call failed: ${message}` }] };
  }
}
