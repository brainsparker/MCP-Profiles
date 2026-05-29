import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "./connectionManager.js";
import { namespacedName } from "../util/namespace.js";
import { log } from "../util/logger.js";

/** A downstream tool, aggregated and tagged with its origin + namespaced name. */
export interface CatalogEntry {
  serverId: string;
  originalName: string;
  /** Default upstream-exposed name: "<serverId>__<originalName>". */
  namespacedName: string;
  description?: string;
  inputSchema: Tool["inputSchema"];
}

/**
 * Aggregates tools across all connected downstream servers. Holds a reverse
 * map so a call to a namespaced tool can be routed back to the right downstream
 * and original tool name.
 */
export class ToolCatalog {
  private readonly entries = new Map<string, CatalogEntry>(); // by namespacedName

  /** (Re)build the catalog by listing tools from every connected downstream. */
  async build(cm: ConnectionManager): Promise<void> {
    this.entries.clear();
    for (const serverId of cm.connectedIds()) {
      const conn = cm.get(serverId);
      if (!conn) continue;
      try {
        const { tools } = await conn.client.listTools();
        for (const tool of tools) {
          const ns = namespacedName(serverId, tool.name);
          this.entries.set(ns, {
            serverId,
            originalName: tool.name,
            namespacedName: ns,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
        log.info(`catalogued ${tools.length} tool(s) from "${serverId}"`);
      } catch (err) {
        log.warn(`failed to list tools from "${serverId}": ${(err as Error).message}`);
      }
    }
  }

  all(): CatalogEntry[] {
    return [...this.entries.values()];
  }

  byNamespacedName(name: string): CatalogEntry | undefined {
    return this.entries.get(name);
  }

  /** All entries belonging to a given downstream server. */
  byServer(serverId: string): CatalogEntry[] {
    return this.all().filter((e) => e.serverId === serverId);
  }
}
