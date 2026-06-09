import { describe, it, expect } from "vitest";
import { detectMultiHop } from "../src/decompose.js";

describe("detectMultiHop (conservative — sub-queries must never re-trigger)", () => {
  it("flags multiple questions", () => {
    expect(
      detectMultiHop("What is the best date library? And how should we handle timezones?").multiHop,
    ).toBe(true);
  });

  it("flags conjoined retrieval intents", () => {
    expect(detectMultiHop("best date library and how to parse ISO strings").multiHop).toBe(true);
  });

  it("flags enumerated comparisons across multiple entities", () => {
    expect(
      detectMultiHop("compare react-query and swr and apollo client for cache invalidation").multiHop,
    ).toBe(true);
  });

  it("does not flag simple comparisons", () => {
    expect(detectMultiHop("react vs vue performance").multiHop).toBe(false);
  });

  it("does not flag single-intent questions", () => {
    expect(detectMultiHop("How do I configure vitest coverage?").multiHop).toBe(false);
  });

  it("does not flag focused lexical sub-queries", () => {
    expect(detectMultiHop('vitest coverage "v8 provider" configuration').multiHop).toBe(false);
    expect(detectMultiHop("date-fns ISO week number parsing").multiHop).toBe(false);
  });

  it("does not count code operators (??, ?., ?:) or mid-token ? as questions", () => {
    expect(detectMultiHop("typescript ?? nullish coalescing operator").multiHop).toBe(false);
    expect(detectMultiHop("typescript optional chaining a?.b vs a?.b?.c behavior").multiHop).toBe(false);
    expect(detectMultiHop("youtube.com/watch?v=abc embed api usage?").multiHop).toBe(false);
  });

  it("still flags genuine consecutive questions", () => {
    expect(detectMultiHop("Is redis right here? Should we shard postgres instead?").multiHop).toBe(true);
  });
});
