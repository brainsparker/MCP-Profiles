import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The e2e test spawns a child MCP server over stdio; give it room.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
