import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDecisionLine } from "../src/context/parse.js";

const SKILL_PATH = fileURLToPath(new URL("../skills/you-aware/SKILL.md", import.meta.url));
const raw = readFileSync(SKILL_PATH, "utf8");

/**
 * Flat key:value frontmatter only — the skill deliberately avoids nested
 * fields (e.g. a metadata map) so no YAML dependency is needed here.
 */
function parseSkill(content: string): { fields: Record<string, string>; body: string } {
  if (!content.startsWith("---\n")) throw new Error("missing frontmatter open fence");
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("missing frontmatter close fence");
  const fields: Record<string, string> = {};
  for (const line of content.slice(4, end).split("\n")) {
    const m = /^([a-z][a-z-]*):\s*(.+)$/.exec(line);
    if (!m) throw new Error(`unparseable frontmatter line: ${line}`);
    fields[m[1]!] = m[2]!;
  }
  return { fields, body: content.slice(end + 5) };
}

const { fields, body } = parseSkill(raw);

describe("shipped skill (skills/you-aware/SKILL.md) stays valid per the Agent Skills spec", () => {
  it("has only the flat frontmatter keys the parser above understands", () => {
    expect(Object.keys(fields).sort()).toEqual(["description", "license", "name"]);
  });

  it("name matches the spec regex, the length bound, and its directory", () => {
    const name = fields.name!;
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeGreaterThanOrEqual(1);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toBe(basename(dirname(SKILL_PATH)));
    expect(name).toBe("you-aware");
  });

  it("description is within the 1–1024 char bound", () => {
    expect(fields.description!.length).toBeGreaterThanOrEqual(1);
    expect(fields.description!.length).toBeLessThanOrEqual(1024);
  });

  it("body is non-empty and self-contained (no relative links — the folder gets copied)", () => {
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).not.toContain("](./");
    expect(body).not.toContain("](../");
  });

  it("the decision shapes it teaches are the shapes the live parser recognizes", () => {
    const taught = body
      .split("\n")
      .filter((l) => /^- (Rejected|Chose|Avoid) /.test(l));
    expect(taught).toHaveLength(3);
    const terms = taught.map((l) => parseDecisionLine(l)?.exclusionTerm);
    expect(terms).toEqual(["moment", "npm", "styled-components"]);
  });
});
