import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Built-in gateway tools, always present regardless of the active profile.
 * `switch_profile` reshapes the entire exposed toolset at runtime; the SDK's
 * tools/list_changed notification tells the client to re-fetch.
 */
export function buildBuiltinTools(profileIds: string[]): Tool[] {
  return [
    {
      name: "switch_profile",
      description:
        "Switch the active MCP profile. This changes which downstream tools, resources, and prompts are exposed.",
      inputSchema: {
        type: "object",
        properties: {
          profileId: {
            type: "string",
            enum: profileIds,
            description: "Id of the profile to activate.",
          },
        },
        required: ["profileId"],
        additionalProperties: false,
      },
    },
    {
      name: "list_profiles",
      description: "List the available MCP profiles and indicate which is active.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}
