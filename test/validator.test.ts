import { describe, it, expect } from "vitest";
import { parseProfile } from "../src/profile/loader.js";
import { ProfileValidationError } from "../src/profile/validator.js";

const VALID = `
apiVersion: mcp-profiles/v1
kind: Profile
metadata:
  id: growth-pm
  name: Growth PM
tools:
  defaultPolicy: deny
  allow:
    - server: amplitude-mcp
      tools: ["get_funnel"]
`;

describe("profile validation", () => {
  it("accepts a valid profile", () => {
    const p = parseProfile(VALID, "valid.yaml");
    expect(p.metadata.id).toBe("growth-pm");
    expect(p.tools.defaultPolicy).toBe("deny");
  });

  it("rejects a profile missing the required tools block", () => {
    const yaml = `
apiVersion: mcp-profiles/v1
kind: Profile
metadata:
  id: x
  name: X
`;
    expect(() => parseProfile(yaml, "no-tools.yaml")).toThrow(ProfileValidationError);
  });

  it("rejects a bad defaultPolicy enum value", () => {
    const yaml = VALID.replace("defaultPolicy: deny", "defaultPolicy: maybe");
    expect(() => parseProfile(yaml, "bad-enum.yaml")).toThrow(/defaultPolicy|enum/i);
  });

  it("rejects unknown top-level keys (additionalProperties:false)", () => {
    const yaml = VALID + "\nbogusKey: 123\n";
    expect(() => parseProfile(yaml, "typo.yaml")).toThrow(ProfileValidationError);
  });

  it("rejects an inline memory source without content", () => {
    const yaml =
      VALID +
      `
memory:
  sources:
    - id: m1
      type: inline
`;
    expect(() => parseProfile(yaml, "bad-memory.yaml")).toThrow(ProfileValidationError);
  });

  it("rejects an invalid metadata.id pattern", () => {
    const yaml = VALID.replace("id: growth-pm", "id: Growth PM");
    expect(() => parseProfile(yaml, "bad-id.yaml")).toThrow(ProfileValidationError);
  });
});
