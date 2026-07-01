import { describe, it, expect } from "vitest";
import { SessionMemory } from "../src/session.js";

describe("SessionMemory (anti-loop baseline, v1 telemetry only)", () => {
  it("never flags the first observation", () => {
    const s = new SessionMemory();
    expect(s.observe("react server components streaming").nearDuplicate).toBe(false);
  });

  it("flags exact repeats", () => {
    const s = new SessionMemory();
    s.observe("react server components streaming");
    const second = s.observe("react server components streaming");
    expect(second.nearDuplicate).toBe(true);
    expect(second.similarity).toBe(1);
  });

  it("flags near-duplicate reformulations", () => {
    const s = new SessionMemory();
    s.observe("react server components streaming ssr hydration");
    expect(s.observe("react server components streaming ssr").nearDuplicate).toBe(true);
  });

  it("does not flag genuinely different queries", () => {
    const s = new SessionMemory();
    s.observe("react server components streaming");
    expect(s.observe("postgres connection pooling pgbouncer").nearDuplicate).toBe(false);
  });

  it("treats token-less queries as evidence of nothing (no empty-set similarity)", () => {
    const s = new SessionMemory();
    s.observe("a b");
    expect(s.observe("x y").nearDuplicate).toBe(false);
  });

  it("remembers which result URLs were shown, exact-match only", () => {
    const s = new SessionMemory();
    s.recordShown(["https://react.dev/learn", "https://tanstack.com/query"]);
    s.recordShown(["https://react.dev/reference"]);
    expect(s.wasShown("https://react.dev/learn")).toBe(true);
    expect(s.wasShown("https://react.dev/reference")).toBe(true);
    expect(s.wasShown("https://react.dev/never-shown")).toBe(false);
  });

  it("tracks the session duplicate rate", () => {
    const s = new SessionMemory();
    s.observe("react hooks dependency array");
    s.observe("react hooks dependency array");
    s.observe("postgres btree gin index");
    expect(s.calls).toBe(3);
    expect(s.duplicateRate).toBeCloseTo(1 / 3);
  });
});
