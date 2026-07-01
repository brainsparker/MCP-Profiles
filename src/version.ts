declare const __YOU_AWARE_VERSION__: string | undefined;

/**
 * Injected from package.json at build time (tsup `define`); dev/test runs
 * (tsx, vitest) fall back to the placeholder.
 */
export const VERSION =
  typeof __YOU_AWARE_VERSION__ === "string" ? __YOU_AWARE_VERSION__ : "0.0.0-dev";
