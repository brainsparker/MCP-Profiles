import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { ProfileRegistry } from "../profile/registry.js";
import type { ConnectionManager } from "../downstream/connectionManager.js";
import type { ToolCatalog } from "../downstream/toolCatalog.js";
import { resolvePermissions, type ResolvedTool } from "./permissions.js";
import { buildToolList, callProxiedTool } from "./toolProxy.js";
import { buildBuiltinTools } from "./switch.js";
import { getPrompt, listPrompts, listResources, readResource } from "./context.js";
import { log } from "../util/logger.js";

/**
 * The gateway: an MCP server (to the upstream client) backed by MCP clients (to
 * downstream servers). The active profile determines which downstream tools are
 * re-exposed and which resources/prompts surface. Switching profiles recomputes
 * the exposed surface and emits list_changed notifications so the client
 * re-fetches — the same model, a different operating system.
 */
export class Gateway {
  readonly server: Server;
  private resolved: ResolvedTool[] = [];
  private resolvedByName = new Map<string, ResolvedTool>();

  constructor(
    private readonly registry: ProfileRegistry,
    private readonly cm: ConnectionManager,
    private readonly catalog: ToolCatalog,
  ) {
    this.server = new Server(
      { name: "mcp-profiles", version: "0.1.0" },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true },
        },
        // Coalesce the burst of changes a single switch produces.
        debouncedNotificationMethods: ["notifications/tools/list_changed"],
      },
    );
    this.rebuild();
    this.registerHandlers();
  }

  /** Recompute the exposed tool surface from the active profile + catalog. */
  private rebuild(): void {
    this.resolved = resolvePermissions(this.registry.active, this.catalog.all());
    this.resolvedByName = new Map(this.resolved.map((r) => [r.displayName, r]));
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...buildBuiltinTools(this.registry.ids()), ...buildToolList(this.resolved)],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) =>
      this.handleCall(req.params.name, req.params.arguments),
    );

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: listPrompts(this.registry.active),
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const result = getPrompt(this.registry.active, req.params.name);
      if (!result) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${req.params.name}`);
      return result;
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: listResources(this.registry),
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const result = readResource(this.registry, req.params.uri);
      if (!result) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${req.params.uri}`);
      return { contents: [{ uri: req.params.uri, mimeType: result.mimeType, text: result.text }] };
    });
  }

  private async handleCall(
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<CallToolResult> {
    if (name === "switch_profile") return this.handleSwitch(args);
    if (name === "list_profiles") return this.handleListProfiles();

    const resolved = this.resolvedByName.get(name);
    if (!resolved) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool "${name}" is not available under the active profile "${this.registry.activeProfileId}".`,
          },
        ],
      };
    }
    return callProxiedTool(this.cm, resolved, args, this.registry.active.settings?.toolTimeoutMs);
  }

  private async handleSwitch(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
    const profileId = args?.profileId;
    if (typeof profileId !== "string" || !this.registry.has(profileId)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Unknown profile "${String(profileId)}". Available: ${this.registry.ids().join(", ")}`,
          },
        ],
      };
    }
    this.registry.setActive(profileId);
    this.rebuild();
    await this.notifyAllChanged();
    log.info(`switched active profile to "${profileId}" (${this.resolved.length} tools)`);
    return {
      content: [
        {
          type: "text",
          text: `Switched to profile "${profileId}". ${this.resolved.length} tool(s) now available.`,
        },
      ],
    };
  }

  private async handleListProfiles(): Promise<CallToolResult> {
    const payload = this.registry.list().map((p) => ({
      id: p.metadata.id,
      name: p.metadata.name,
      description: p.metadata.description,
      active: p.metadata.id === this.registry.activeProfileId,
    }));
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  private async notifyAllChanged(): Promise<void> {
    await this.server.sendToolListChanged();
    await this.server.sendPromptListChanged();
    await this.server.sendResourceListChanged();
  }
}
