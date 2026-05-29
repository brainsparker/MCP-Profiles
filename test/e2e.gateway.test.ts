import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConnectionManager } from "../src/downstream/connectionManager.js";
import { ToolCatalog } from "../src/downstream/toolCatalog.js";
import { ProfileRegistry } from "../src/profile/registry.js";
import { Gateway } from "../src/gateway/server.js";
import type { Profile } from "../src/profile/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK = join(here, "fixtures", "mock-downstream", "server.mjs");

const profileA: Profile = {
  apiVersion: "mcp-profiles/v1",
  kind: "Profile",
  metadata: { id: "a", name: "Profile A" },
  tools: { defaultPolicy: "deny", allow: [{ server: "mock", tools: ["get_funnel", "search"] }] },
};
const profileB: Profile = {
  apiVersion: "mcp-profiles/v1",
  kind: "Profile",
  metadata: { id: "b", name: "Profile B" },
  tools: { defaultPolicy: "deny", allow: [{ server: "mock", tools: ["search"] }] },
};

let cm: ConnectionManager;
let client: Client;
let gateway: Gateway;
let listChangedCount = 0;

beforeAll(async () => {
  cm = new ConnectionManager();
  await cm.connect("mock", { transport: "stdio", command: process.execPath, args: [MOCK] });

  const catalog = new ToolCatalog();
  await catalog.build(cm);

  const registry = new ProfileRegistry(new Map([["a", profileA], ["b", profileB]]), "a");
  gateway = new Gateway(registry, cm, catalog);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await gateway.server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChangedCount++;
  });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
  await gateway?.server.close();
  await cm?.closeAll();
});

const toolNames = async () => (await client.listTools()).tools.map((t) => t.name).sort();

describe("gateway e2e", () => {
  it("exposes only profile A's allowed tools (plus built-ins), not delete_page", async () => {
    const names = await toolNames();
    expect(names).toContain("mock__get_funnel");
    expect(names).toContain("mock__search");
    expect(names).toContain("switch_profile");
    expect(names).toContain("list_profiles");
    expect(names).not.toContain("mock__delete_page");
  });

  it("routes an allowed call through to the downstream", async () => {
    const res = (await client.callTool({
      name: "mock__get_funnel",
      arguments: { funnelId: "F1" },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain("FUNNEL:F1:sentinel-ok");
  });

  it("switches profiles, emits tools/list_changed, and reshapes the tool list", async () => {
    const before = listChangedCount;
    const res = (await client.callTool({
      name: "switch_profile",
      arguments: { profileId: "b" },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    // Wait for the (debounced) notification to arrive.
    await new Promise((r) => setTimeout(r, 100));
    expect(listChangedCount).toBeGreaterThan(before);

    const names = await toolNames();
    expect(names).toContain("mock__search");
    expect(names).not.toContain("mock__get_funnel");
  });

  it("rejects a tool not permitted by the now-active profile", async () => {
    const res = (await client.callTool({
      name: "mock__get_funnel",
      arguments: { funnelId: "F2" },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("not available");
  });
});
