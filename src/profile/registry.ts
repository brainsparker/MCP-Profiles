import type { Profile } from "./types.js";

/**
 * Holds the set of loaded profiles and tracks which one is active. The active
 * profile drives which downstream tools are exposed and which resources/prompts
 * are surfaced.
 */
export class ProfileRegistry {
  private readonly profiles: Map<string, Profile>;
  private activeId: string;

  constructor(profiles: Map<string, Profile>, activeId: string) {
    if (profiles.size === 0) throw new Error("ProfileRegistry requires at least one profile.");
    if (!profiles.has(activeId)) {
      throw new Error(
        `Active profile "${activeId}" not found. Available: ${[...profiles.keys()].join(", ")}`,
      );
    }
    this.profiles = profiles;
    this.activeId = activeId;
  }

  get active(): Profile {
    return this.profiles.get(this.activeId)!;
  }

  get activeProfileId(): string {
    return this.activeId;
  }

  ids(): string[] {
    return [...this.profiles.keys()];
  }

  list(): Profile[] {
    return [...this.profiles.values()];
  }

  get(id: string): Profile | undefined {
    return this.profiles.get(id);
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }

  /** Switch the active profile. Returns the newly-active profile. */
  setActive(id: string): Profile {
    if (!this.profiles.has(id)) {
      throw new Error(
        `Unknown profile "${id}". Available: ${[...this.profiles.keys()].join(", ")}`,
      );
    }
    this.activeId = id;
    return this.active;
  }
}
