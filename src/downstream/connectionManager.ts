import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { DownstreamServerSpec } from "../config/serverConfig.js";
import { buildClientTransport } from "./transports.js";
import { log } from "../util/logger.js";

export interface DownstreamConnection {
  serverId: string;
  client: Client;
}

/**
 * Manages one MCP Client per downstream server. The gateway is a client to each
 * downstream while simultaneously being a server to its own upstream caller.
 */
export class ConnectionManager {
  private readonly connections = new Map<string, DownstreamConnection>();

  /** Connect to a single downstream server. Idempotent per server id. */
  async connect(serverId: string, spec: DownstreamServerSpec): Promise<DownstreamConnection> {
    const existing = this.connections.get(serverId);
    if (existing) return existing;

    const client = new Client(
      { name: "mcp-profiles-gateway", version: "0.1.0" },
      { capabilities: {} },
    );
    client.onerror = (err) => log.error(`downstream "${serverId}" error:`, err.message);

    const transport = buildClientTransport(spec);
    await client.connect(transport);
    log.info(`connected to downstream "${serverId}"`);

    const conn: DownstreamConnection = { serverId, client };
    this.connections.set(serverId, conn);
    return conn;
  }

  /**
   * Connect to all referenced servers, tolerating individual failures so one
   * bad downstream doesn't take down the whole gateway. Returns the ids that
   * connected successfully.
   */
  async connectAll(
    specs: Map<string, DownstreamServerSpec>,
  ): Promise<{ connected: string[]; failed: Array<{ serverId: string; error: string }> }> {
    const connected: string[] = [];
    const failed: Array<{ serverId: string; error: string }> = [];
    await Promise.all(
      [...specs.entries()].map(async ([serverId, spec]) => {
        try {
          await this.connect(serverId, spec);
          connected.push(serverId);
        } catch (err) {
          const error = (err as Error).message;
          failed.push({ serverId, error });
          log.warn(`failed to connect downstream "${serverId}": ${error}`);
        }
      }),
    );
    return { connected, failed };
  }

  get(serverId: string): DownstreamConnection | undefined {
    return this.connections.get(serverId);
  }

  connectedIds(): string[] {
    return [...this.connections.keys()];
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map((c) =>
        c.client.close().catch((err) => log.warn(`error closing "${c.serverId}":`, (err as Error).message)),
      ),
    );
    this.connections.clear();
  }
}
