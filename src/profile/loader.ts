import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateProfile } from "./validator.js";
import type { Profile } from "./types.js";

/** Parse and validate a single profile from a YAML string. */
export function parseProfile(yaml: string, source = "<string>"): Profile {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    throw new Error(`Failed to parse YAML (${source}): ${(err as Error).message}`);
  }
  return validateProfile(raw, source);
}

/** Load and validate a single profile file. */
export function loadProfileFile(path: string): Profile {
  return parseProfile(readFileSync(path, "utf8"), path);
}

/**
 * Load every .yaml/.yml profile in a directory. Validates each, and rejects
 * duplicate profile ids. Returns profiles keyed by metadata.id.
 */
export function loadProfilesDir(dir: string): Map<string, Profile> {
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`Profiles path is not a directory: ${dir}`);
  }

  const profiles = new Map<string, Profile>();
  const files = readdirSync(dir)
    .filter((f) => [".yaml", ".yml"].includes(extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .yaml/.yml profiles found in ${dir}`);
  }

  for (const file of files) {
    const path = join(dir, file);
    const profile = loadProfileFile(path);
    const id = profile.metadata.id;
    const existing = profiles.get(id);
    if (existing) {
      throw new Error(
        `Duplicate profile id "${id}" in ${basename(file)} (already defined elsewhere).`,
      );
    }
    profiles.set(id, profile);
  }

  return profiles;
}
