import { describe, it, expect } from "vitest";
import { namespacedName, decodeNamespacedName } from "../src/util/namespace.js";

describe("namespace", () => {
  const ids = ["amplitude-mcp", "notion-mcp"];

  it("round-trips a name", () => {
    const ns = namespacedName("amplitude-mcp", "get_funnel");
    expect(ns).toBe("amplitude-mcp__get_funnel");
    expect(decodeNamespacedName(ns, ids)).toEqual({
      serverId: "amplitude-mcp",
      originalName: "get_funnel",
    });
  });

  it("preserves underscores in the original tool name", () => {
    const ns = namespacedName("notion-mcp", "create_page_v2");
    expect(decodeNamespacedName(ns, ids)).toEqual({
      serverId: "notion-mcp",
      originalName: "create_page_v2",
    });
  });

  it("returns null for an unknown server prefix", () => {
    expect(decodeNamespacedName("ghost-mcp__x", ids)).toBeNull();
  });

  it("keeps two servers' identically-named tools distinct", () => {
    const a = namespacedName("amplitude-mcp", "search");
    const b = namespacedName("notion-mcp", "search");
    expect(a).not.toBe(b);
  });
});
