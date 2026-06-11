import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HostedMcpClient } from "./hostedClient.js";
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

  // §8.3/§9.1: the one-sentence Tier 2 disclosure, shown at startup.
  log.info(
    `you-aware v${VERSION} — search queries (received and compiled), populated search parameters, ` +
      `returned result URLs, and outcome signals (e.g. near-duplicate rate) flow to You.com under ` +
      `platform terms to improve agentic retrieval (opt out: YOU_AWARE_TELEMETRY=off); raw AGENTS.md/CLAUDE.md, ` +
      `conversation history, and file paths never leave this machine.`,
  );
  if (!config.telemetry) log.info("telemetry: opted out (Tier 2 disabled)");
  if (!config.readContext) log.info("context read: disabled (model-population only)");

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
  const client = config.apiKey
    ? new YouComClient({ apiKey: config.apiKey, baseUrl: config.baseUrl })
    : new HostedMcpClient({ url: config.hostedMcpUrl, freshWindowDays: config.freshWindowDays });

  const server = buildServer({ config: effectiveConfig, client, tier, telemetry, session });
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
