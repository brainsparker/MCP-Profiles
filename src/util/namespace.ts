/**
 * Tool name namespacing. Downstream MCP servers do not coordinate tool names,
 * so two servers may each expose a `search` tool. We prefix the upstream-exposed
 * name with the downstream server id to guarantee uniqueness, and keep the
 * mapping reversible for routing calls back to the right downstream.
 *
 * Separator is a double underscore, which is disallowed... not quite: tool names
 * may contain single underscores, so we cannot simply split on `_`. We instead
 * carry the (serverId, originalName) pair in a catalog and use this encoding only
 * for the display/transport name.
 */

const SEP = "__";

export function namespacedName(serverId: string, originalName: string): string {
  return `${serverId}${SEP}${originalName}`;
}

/**
 * Decode a namespaced name back into (serverId, originalName) using the known
 * set of server ids. We match the longest server-id prefix to be robust against
 * server ids that themselves contain the separator.
 */
export function decodeNamespacedName(
  name: string,
  knownServerIds: Iterable<string>,
): { serverId: string; originalName: string } | null {
  for (const serverId of knownServerIds) {
    const prefix = `${serverId}${SEP}`;
    if (name.startsWith(prefix)) {
      return { serverId, originalName: name.slice(prefix.length) };
    }
  }
  return null;
}
