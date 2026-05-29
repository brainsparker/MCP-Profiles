import { Command } from "commander";

export interface CliOptions {
  profilesDir: string;
  config: string;
  /** Active profile at startup. Undefined → first loaded profile. */
  profile?: string;
}

/**
 * Resolve startup options. Precedence: CLI flag > env var > default.
 * (Profile precedence finishes at boot: CLI/env > first loaded.)
 */
export function parseCliOptions(argv: string[]): CliOptions {
  const program = new Command();
  program
    .name("mcp-profiles")
    .description("MCP Profiles gateway — re-expose downstream MCP tools per the active profile.")
    .option("-p, --profile <id>", "active profile id at startup", process.env.MCP_PROFILE)
    .option("-d, --profiles-dir <path>", "directory of YAML profiles", process.env.MCP_PROFILES_DIR ?? "./profiles")
    .option("-c, --config <path>", "downstream server registry JSON", process.env.MCP_PROFILES_CONFIG ?? "./mcp-profiles.config.json")
    .allowExcessArguments(true)
    .parse(argv);

  const opts = program.opts<{ profile?: string; profilesDir: string; config: string }>();
  return { profile: opts.profile, profilesDir: opts.profilesDir, config: opts.config };
}
