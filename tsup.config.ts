import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts", "src/lib.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  // Prepend a shebang so the built bin is directly executable. It also lands
  // on lib.js, where Node treats it as a comment.
  banner: { js: "#!/usr/bin/env node" },
  define: { __YOU_AWARE_VERSION__: JSON.stringify(pkg.version) },
});
