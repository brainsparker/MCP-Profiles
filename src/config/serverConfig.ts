import { readFileSync } from "node:fs";

/** Connection details for a downstream MCP server, keyed by server id. */
export interface StdioServerSpec {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpServerSpec {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type DownstreamServerSpec = StdioServerSpec | HttpServerSpec;

export interface GatewayConfig {
  servers: Record<string, DownstreamServerSpec>;
}

/**
 * Interpolate ${VAR} placeholders in a string from process.env. Throws if a
 * referenced variable is missing, so misconfiguration fails loudly at startup.
 */
function interpolate(value: string, ctx: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => {
    const v = process.env[name];
    if (v === undefined) {
      throw new Error(`Environment variable "${name}" referenced in ${ctx} is not set.`);
    }
    return v;
  });
}

function interpolateRecord(
  rec: Record<string, string> | undefined,
  ctx: string,
): Record<string, string> | undefined {
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = interpolate(v, ctx);
  return out;
}

/**
 * Load the gateway config and resolve ${VAR} placeholders. Only servers that
 * are actually referenced (see `referencedServers`) have their env/headers
 * interpolated, so a config can list servers a given profile set never uses.
 */
export function loadGatewayConfig(path: string, referencedServers?: Set<string>): GatewayConfig {
  let raw: { servers?: Record<string, DownstreamServerSpec> };
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read gateway config ${path}: ${(err as Error).message}`);
  }
  if (!raw.servers || typeof raw.servers !== "object") {
    throw new Error(`Gateway config ${path} must contain a "servers" object.`);
  }

  const servers: Record<string, DownstreamServerSpec> = {};
  for (const [id, spec] of Object.entries(raw.servers)) {
    if (referencedServers && !referencedServers.has(id)) {
      servers[id] = spec; // keep as-is; not connected, so don't force its secrets
      continue;
    }
    const ctx = `server "${id}"`;
    if (spec.transport === "stdio") {
      servers[id] = {
        ...spec,
        env: interpolateRecord(spec.env, ctx),
        args: spec.args?.map((a) => interpolate(a, ctx)),
        command: interpolate(spec.command, ctx),
      };
    } else if (spec.transport === "http") {
      servers[id] = {
        ...spec,
        url: interpolate(spec.url, ctx),
        headers: interpolateRecord(spec.headers, ctx),
      };
    } else {
      throw new Error(`Unknown transport for ${ctx}: ${(spec as { transport: string }).transport}`);
    }
  }

  return { servers };
}
