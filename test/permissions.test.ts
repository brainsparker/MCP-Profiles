import { describe, it, expect } from "vitest";
import { resolvePermissions } from "../src/gateway/permissions.js";
import type { CatalogEntry } from "../src/downstream/toolCatalog.js";
import type { Profile } from "../src/profile/types.js";

function entry(serverId: string, name: string): CatalogEntry {
  return {
    serverId,
    originalName: name,
    namespacedName: `${serverId}__${name}`,
    inputSchema: { type: "object" },
  };
}

const catalog: CatalogEntry[] = [
  entry("amplitude-mcp", "get_funnel"),
  entry("amplitude-mcp", "query_event"),
  entry("notion-mcp", "create_page"),
  entry("notion-mcp", "delete_page"),
  entry("other-mcp", "search"),
];

function profile(tools: Profile["tools"]): Profile {
  return { apiVersion: "mcp-profiles/v1", kind: "Profile", metadata: { id: "t", name: "T" }, tools };
}

describe("resolvePermissions", () => {
  it("denies everything by default", () => {
    const resolved = resolvePermissions(profile({ defaultPolicy: "deny" }), catalog);
    expect(resolved).toHaveLength(0);
  });

  it("allows only explicitly listed tools", () => {
    const resolved = resolvePermissions(
      profile({ defaultPolicy: "deny", allow: [{ server: "amplitude-mcp", tools: ["get_funnel"] }] }),
      catalog,
    );
    expect(resolved.map((r) => r.displayName)).toEqual(["amplitude-mcp__get_funnel"]);
  });

  it("expands wildcards per server", () => {
    const resolved = resolvePermissions(
      profile({ defaultPolicy: "deny", allow: [{ server: "notion-mcp", tools: ["*"] }] }),
      catalog,
    );
    expect(resolved.map((r) => r.displayName).sort()).toEqual([
      "notion-mcp__create_page",
      "notion-mcp__delete_page",
    ]);
  });

  it("applies deny carve-outs under a wildcard allow", () => {
    const resolved = resolvePermissions(
      profile({
        defaultPolicy: "deny",
        allow: [{ server: "notion-mcp", tools: ["*"] }],
        deny: [{ server: "notion-mcp", tools: ["delete_page"] }],
      }),
      catalog,
    );
    expect(resolved.map((r) => r.displayName)).toEqual(["notion-mcp__create_page"]);
  });

  it("applies rename to the display name", () => {
    const resolved = resolvePermissions(
      profile({
        defaultPolicy: "deny",
        allow: [{ server: "notion-mcp", tools: ["create_page"], rename: { create_page: "new_doc" } }],
      }),
      catalog,
    );
    expect(resolved.map((r) => r.displayName)).toEqual(["new_doc"]);
    expect(resolved[0]!.entry.originalName).toBe("create_page");
  });

  it("never lets a rename shadow a reserved built-in name", () => {
    const resolved = resolvePermissions(
      profile({
        defaultPolicy: "deny",
        allow: [{ server: "other-mcp", tools: ["search"], rename: { search: "switch_profile" } }],
      }),
      catalog,
    );
    // falls back to the namespaced name instead of shadowing switch_profile
    expect(resolved.map((r) => r.displayName)).toEqual(["other-mcp__search"]);
  });

  it("defaultPolicy allow exposes all, minus deny", () => {
    const resolved = resolvePermissions(
      profile({ defaultPolicy: "allow", deny: [{ server: "notion-mcp", tools: ["delete_page"] }] }),
      catalog,
    );
    expect(resolved.find((r) => r.displayName === "notion-mcp__delete_page")).toBeUndefined();
    expect(resolved).toHaveLength(catalog.length - 1);
  });
});
