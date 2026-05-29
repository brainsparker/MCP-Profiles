import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseCliOptions } from "./config/env.js";
import { loadGatewayConfig, type DownstreamServerSpec } from "./config/serverConfig.js";
import { loadProfilesDir } from "./profile/loader.js";
import { ProfileRegistry } from "./profile/registry.js";
import type { Profile } from "./profile/types.js";
import { ConnectionManager } from "./downstream/connectionManager.js";
import { ToolCatalog } from "./downstream/toolCatalog.js";
import { Gateway } from "./gateway/server.js";
import { log } from "./util/logger.js";

/** Collect every downstream server id referenced by any loaded profile. */
function referencedServers(profiles: Iterable<Profile>): Set<string> {
  const ids = new Set<string>();
  for (const p of profiles) {
    for (const rule of p.tools.allow ?? []) ids.add(rule.server);
    for (const rule of p.tools.deny ?? []) ids.add(rule.server);
    for (const src of p.retrieval?.sources ?? []) if (src.via) ids.add(src.via);
  }
  return ids;
}

async function main(): Promise<void> {
  const opts = parseCliOptions(process.argv);

  // 1. Load + validate all profiles.
  const profilesDir = resolve(opts.profilesDir);
  const profiles = loadProfilesDir(profilesDir);
  log.info(`loaded ${profiles.size} profile(s) from ${profilesDir}: ${[...profiles.keys()].join(", ")}`);

  // 2. Determine the active profile: CLI/env > first loaded.
  const activeId = opts.profile ?? [...profiles.keys()][0]!;
  const registry = new ProfileRegistry(profiles, activeId);

  // 3. Connect to referenced downstream servers (pre-connect all for the MVP).
  const cm = new ConnectionManager();
  const referenced = referencedServers(profiles.values());
  const configPath = resolve(opts.config);
  const specsToConnect = new Map<string, DownstreamServerSpec>();
  if (existsSync(configPath)) {
    const config = loadGatewayConfig(configPath, referenced);
    for (const id of referenced) {
      const spec = config.servers[id];
      if (spec) specsToConnect.set(id, spec);
      else log.warn(`profile references server "${id}" not present in ${configPath}`);
    }
    const { connected, failed } = await cm.connectAll(specsToConnect);
    log.info(`downstream connections: ${connected.length} ok, ${failed.length} failed`);
  } else {
    log.warn(`no gateway config at ${configPath}; starting with no downstream servers.`);
  }

  // 4. Build the tool catalog from connected downstreams.
  const catalog = new ToolCatalog();
  await catalog.build(cm);

  // 5. Construct the gateway and serve over stdio.
  const gateway = new Gateway(registry, cm, catalog);
  const transport = new StdioServerTransport();
  await gateway.server.connect(transport);
  log.info(`mcp-profiles gateway ready (active profile: "${registry.activeProfileId}")`);

  // 6. Clean shutdown.
  const shutdown = async () => {
    log.info("shutting down…");
    await cm.closeAll();
    await gateway.server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("fatal:", (err as Error).stack ?? (err as Error).message);
  process.exit(1);
});
