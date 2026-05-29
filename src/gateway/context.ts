import type { Prompt, Resource } from "@modelcontextprotocol/sdk/types.js";
import type { Profile } from "../profile/types.js";
import type { ProfileRegistry } from "../profile/registry.js";

const OS_PROMPT_NAME = "operating-system";

/**
 * Builds the agent's "operating system" framing from persona + workflow rules.
 * This text is what makes the same model behave like a different agent.
 */
function operatingSystemText(profile: Profile): string {
  const lines: string[] = [];
  const p = profile.persona;
  lines.push(`# Operating System: ${profile.metadata.name}`);
  if (p?.role) lines.push(`\nYou are a ${p.role}.`);
  if (p?.objectives?.length) {
    lines.push("\n## Objectives");
    for (const o of p.objectives) lines.push(`- ${o}`);
  }
  if (p?.voice) lines.push(`\n## Voice\n${p.voice}`);
  const rules = profile.workflow?.rules ?? [];
  if (rules.length) {
    lines.push("\n## Operating rules");
    for (const r of rules) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}

function procedureText(profile: Profile, id: string): string | null {
  const proc = profile.workflow?.procedures?.find((p) => p.id === id);
  if (!proc) return null;
  const lines = [`# ${proc.title}`];
  if (proc.description) lines.push(`\n${proc.description}`);
  lines.push("\n## Steps");
  proc.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  return lines.join("\n");
}

/** Prompts exposed for the active profile. */
export function listPrompts(profile: Profile): Prompt[] {
  const prompts: Prompt[] = [
    {
      name: OS_PROMPT_NAME,
      title: `${profile.metadata.name} — operating system`,
      description: "Persona, objectives, voice, and operating rules for the active profile.",
    },
  ];
  if (profile.settings?.exposeProcedureAsPrompt !== false) {
    for (const proc of profile.workflow?.procedures ?? []) {
      prompts.push({ name: proc.id, title: proc.title, description: proc.description });
    }
  }
  return prompts;
}

/** Resolve a prompt by name into MCP prompt messages. Returns null if unknown. */
export function getPrompt(
  profile: Profile,
  name: string,
): { description?: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } | null {
  let text: string | null = null;
  let description: string | undefined;
  if (name === OS_PROMPT_NAME) {
    text = operatingSystemText(profile);
    description = "Operating system framing for the active profile.";
  } else if (profile.settings?.exposeProcedureAsPrompt !== false) {
    text = procedureText(profile, name);
    description = profile.workflow?.procedures?.find((p) => p.id === name)?.description;
  }
  if (text === null) return null;
  return { description, messages: [{ role: "user", content: { type: "text", text } }] };
}

const ACTIVE_URI = "profile://active";
const AVAILABLE_URI = "profile://available";

function personaUri(id: string): string {
  return `profile://${id}/persona`;
}
function memoryUri(id: string, sourceId: string): string {
  return `profile://${id}/memory/${sourceId}`;
}

/** Resources exposed for the active profile (plus discovery resources). */
export function listResources(registry: ProfileRegistry): Resource[] {
  const profile = registry.active;
  const id = profile.metadata.id;
  const resources: Resource[] = [
    { uri: ACTIVE_URI, name: "Active profile", mimeType: "application/json" },
    { uri: AVAILABLE_URI, name: "Available profiles", mimeType: "application/json" },
    { uri: personaUri(id), name: `${profile.metadata.name} persona`, mimeType: "text/markdown" },
  ];
  if (profile.settings?.exposeMemoryAsResource !== false) {
    for (const src of profile.memory?.sources ?? []) {
      resources.push({
        uri: memoryUri(id, src.id),
        name: `Memory: ${src.id}`,
        mimeType: src.type === "inline" ? "text/plain" : "application/json",
      });
    }
  }
  return resources;
}

/** Read a resource by uri. Returns null if unknown. */
export function readResource(
  registry: ProfileRegistry,
  uri: string,
): { mimeType: string; text: string } | null {
  if (uri === ACTIVE_URI) {
    return {
      mimeType: "application/json",
      text: JSON.stringify({ activeProfile: registry.activeProfileId, profile: registry.active }, null, 2),
    };
  }
  if (uri === AVAILABLE_URI) {
    return {
      mimeType: "application/json",
      text: JSON.stringify(
        registry.list().map((p) => ({ id: p.metadata.id, name: p.metadata.name, description: p.metadata.description })),
        null,
        2,
      ),
    };
  }
  const profile = registry.active;
  const id = profile.metadata.id;
  if (uri === personaUri(id)) {
    return { mimeType: "text/markdown", text: operatingSystemText(profile) };
  }
  const memPrefix = `profile://${id}/memory/`;
  if (uri.startsWith(memPrefix)) {
    const sourceId = uri.slice(memPrefix.length);
    const src = profile.memory?.sources?.find((s) => s.id === sourceId);
    if (!src) return null;
    if (src.type === "inline") {
      return { mimeType: "text/plain", text: src.content ?? "" };
    }
    // mcp-resource / file: surface a reference; live proxying is deferred.
    return { mimeType: "application/json", text: JSON.stringify(src, null, 2) };
  }
  return null;
}
