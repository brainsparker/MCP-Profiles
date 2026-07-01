import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HostedMcpClient } from "./hostedClient.js";
import { ProjectMemory } from "./memory.js";
import { buildServer } from "./server.js";
import { SessionMemory } from "./session.js";
import { Telemetry } from "./telemetry.js";
import { log } from "./util/logger.js";
import { VERSION } from "./version.js";
import { YouComClient } from "./youcom.js";

/**
 * you-aware — context-aware web search MCP for agent harnesses.
 * Stdio transport (first ship, PRD §11); hosted variant is a v2 release.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2));

  // §8.3/§9.1: the data-handling disclosure, shown at startup. It must
  // describe what THIS configuration actually does — never a future plan.
  log.info(
    `you-aware v${VERSION} — search queries and populated parameters go to You.com to run the ` +
      `search (that is the product); ` +
      (config.contextHeadFallback
        ? `conversation history and file paths never leave this machine (head fallback is ON — see below).`
        : `raw context/rules files (AGENTS.md, CLAUDE.md, …), conversation history, and file paths ` +
          `never leave this machine.`),
  );
  if (!config.telemetry) {
    log.info("telemetry: off");
  } else if (config.telemetryUrl) {
    log.info(
      `telemetry: on — queries (received and compiled), populated parameters, result URLs, and ` +
        `outcome signals are sent to ${config.telemetryUrl} and spooled locally under ` +
        `${config.telemetryDir} (opt out: YOU_AWARE_TELEMETRY=off)`,
    );
  } else {
    log.info(
      `telemetry: local spool only (${config.telemetryDir}, capped + owner-readable) — no remote ` +
        `sink is configured, so telemetry never leaves this machine (opt out entirely: YOU_AWARE_TELEMETRY=off)`,
    );
  }
  if (config.contextHeadFallback) {
    log.info(
      "context fallback: head — without a `## Project Context` section, up to 4 KB of the context " +
        "file rides each search call as project_context (disable: unset YOU_AWARE_CONTEXT_FALLBACK)",
    );
  }
  if (!config.readContext) log.info("context read: disabled (model-population only)");
  if (!config.memory) log.info("project memory: disabled (no local outcome tracking, boosts, or suggestions)");

  const tier: "free" | "keyed" = config.apiKey ? "keyed" : "free";
  let effectiveConfig = config;
  if (tier === "free") {
    log.info(
      "no YDC_API_KEY — running on the You.com free tier (hosted MCP, search-only, ~100 queries/day). " +
        "Set YDC_API_KEY (https://you.com/platform) for higher limits and native context parameters.",
    );
    // The free tool has no Product A parameters: context must reach the query
    // as operators; freshness rides the tool's native argument instead.
    if (config.compileMode !== "operators") {
      log.info(`compile mode "${config.compileMode}" requires native parameters — using "operators" on the free tier`);
      effectiveConfig = { ...config, compileMode: "operators" };
    }
  }

  const telemetry = new Telemetry({
    enabled: config.telemetry,
    dir: config.telemetryDir,
    url: config.telemetryUrl,
  });
  const session = new SessionMemory();
  const memory = new ProjectMemory({
    enabled: config.memory,
    dir: config.dataDir,
    projectRoot: config.projectRoot,
  });
  const client = config.apiKey
    ? new YouComClient({ apiKey: config.apiKey, baseUrl: config.baseUrl })
    : new HostedMcpClient({ url: config.hostedMcpUrl, freshWindowDays: config.freshWindowDays });

  const server = buildServer({ config: effectiveConfig, client, tier, telemetry, session, memory });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(`ready (tier: ${tier}, compile mode: ${effectiveConfig.compileMode}, session: ${session.sessionId})`);

  const shutdown = async (): Promise<void> => {
    log.info("shutting down…");
    if (client instanceof HostedMcpClient) await client.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("fatal:", (err as Error).stack ?? (err as Error).message);
  process.exit(1);
});
