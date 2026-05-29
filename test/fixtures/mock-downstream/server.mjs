#!/usr/bin/env node
// A tiny real MCP server used as a downstream in the gateway e2e test.
// Exposes three tools; the gateway should re-expose only those a profile allows.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mock-downstream", version: "1.0.0" });

server.registerTool(
  "get_funnel",
  { description: "Get a funnel report", inputSchema: { funnelId: z.string() } },
  async ({ funnelId }) => ({
    content: [{ type: "text", text: `FUNNEL:${funnelId}:sentinel-ok` }],
  }),
);

server.registerTool(
  "search",
  { description: "Search docs", inputSchema: { query: z.string() } },
  async ({ query }) => ({ content: [{ type: "text", text: `SEARCH:${query}` }] }),
);

server.registerTool(
  "delete_page",
  { description: "Delete a page (dangerous)", inputSchema: { pageId: z.string() } },
  async ({ pageId }) => ({ content: [{ type: "text", text: `DELETED:${pageId}` }] }),
);

await server.connect(new StdioServerTransport());
