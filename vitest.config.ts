import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __YOU_AWARE_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ["test/**/*.test.ts"],
    // The e2e test spawns a child MCP server over stdio; give it room.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
