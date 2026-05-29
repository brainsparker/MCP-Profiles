import type { Profile, ToolRule } from "../profile/types.js";
import type { CatalogEntry } from "../downstream/toolCatalog.js";
import { log } from "../util/logger.js";

/** Reserved names for built-in gateway tools — profiles cannot shadow these. */
export const RESERVED_TOOL_NAMES = new Set(["switch_profile", "list_profiles"]);

/** A downstream tool resolved as allowed for a profile, with its exposed name. */
export interface ResolvedTool {
  /** Name exposed to the upstream client (may be a rename, else namespaced). */
  displayName: string;
  entry: CatalogEntry;
}

function ruleMatchesTool(rule: ToolRule, entry: CatalogEntry): boolean {
  if (rule.server !== entry.serverId) return false;
  return rule.tools.includes("*") || rule.tools.includes(entry.originalName);
}

function renameFor(rules: ToolRule[], entry: CatalogEntry): string | undefined {
  for (const rule of rules) {
    if (rule.server === entry.serverId && rule.rename) {
      const mapped = rule.rename[entry.originalName];
      if (mapped) return mapped;
    }
  }
  return undefined;
}

/**
 * Compute the set of tools a profile permits, given the full downstream catalog.
 *
 * Resolution: start from `defaultPolicy` (deny → none, allow → all), apply
 * `allow` rules, then subtract `deny` rules. Display names come from `rename`
 * when present, else the namespaced name. Collisions (including with reserved
 * names) fall back to the namespaced name.
 */
export function resolvePermissions(profile: Profile, catalog: CatalogEntry[]): ResolvedTool[] {
  const { defaultPolicy, allow = [], deny = [] } = profile.tools;

  const allowed = new Set<CatalogEntry>(defaultPolicy === "allow" ? catalog : []);

  for (const entry of catalog) {
    if (allow.some((rule) => ruleMatchesTool(rule, entry))) allowed.add(entry);
  }
  for (const entry of catalog) {
    if (deny.some((rule) => ruleMatchesTool(rule, entry))) allowed.delete(entry);
  }

  // Assign display names, guaranteeing uniqueness and protecting reserved names.
  const used = new Set<string>(RESERVED_TOOL_NAMES);
  const resolved: ResolvedTool[] = [];
  for (const entry of allowed) {
    const wanted = renameFor(allow, entry) ?? entry.namespacedName;
    let displayName = wanted;
    if (used.has(displayName)) {
      if (wanted !== entry.namespacedName && !used.has(entry.namespacedName)) {
        log.warn(
          `tool display name "${wanted}" collides; falling back to "${entry.namespacedName}".`,
        );
        displayName = entry.namespacedName;
      } else {
        log.warn(`tool display name "${displayName}" collides; skipping ${entry.namespacedName}.`);
        continue;
      }
    }
    used.add(displayName);
    resolved.push({ displayName, entry });
  }

  return resolved;
}
