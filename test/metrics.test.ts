import { describe, it, expect } from "vitest";
import {
  citationPrecisionAtK,
  citationRecallAtK,
  ndcgAtK,
  normalizeUrl,
  udcgAtK,
} from "../src/eval/metrics.js";

describe("udcgAtK (uniform-weight gain — the §10.1 primary gate)", () => {
  it("ignores position within the top K", () => {
    expect(udcgAtK([1, 0, 1, 0], 4)).toBe(udcgAtK([0, 1, 0, 1], 4));
  });
  it("normalizes against the ideal ordering", () => {
    expect(udcgAtK([1, 0, 1, 0], 2)).toBe(0.5);
    expect(udcgAtK([1, 1, 0, 0], 2)).toBe(1);
  });
  it("returns 0 when nothing is relevant", () => {
    expect(udcgAtK([0, 0], 2)).toBe(0);
  });
});

describe("ndcgAtK (reported alongside, not a gate)", () => {
  it("is 1 for a perfect ordering", () => {
    expect(ndcgAtK([3, 2, 1], 3)).toBe(1);
  });
  it("is position-discounted, unlike UDCG", () => {
    expect(ndcgAtK([0, 1], 2)).toBeLessThan(ndcgAtK([1, 0], 2));
  });
});

describe("citation matching", () => {
  it("normalizes URLs for comparison", () => {
    expect(normalizeUrl("https://www.React.dev/learn/")).toBe("react.dev/learn");
  });
  it("drops tracking params but keeps meaningful query strings", () => {
    expect(normalizeUrl("https://react.dev/learn?utm_source=x&utm_medium=y")).toBe("react.dev/learn");
    expect(normalizeUrl("https://youtube.com/watch?v=abc")).toBe("youtube.com/watch?v=abc");
    expect(citationPrecisionAtK(["https://react.dev/learn?utm_source=x"], ["react.dev/learn"], 1)).toBe(1);
  });
  it("computes precision@K over the top K", () => {
    const retrieved = ["https://react.dev/learn", "https://blog.example.com/x"];
    expect(citationPrecisionAtK(retrieved, ["react.dev/learn"], 2)).toBe(0.5);
  });
  it("computes recall@K over the reference set", () => {
    const retrieved = ["https://react.dev/learn"];
    const refs = ["react.dev/learn", "tanstack.com/query"];
    expect(citationRecallAtK(retrieved, refs, 10)).toBe(0.5);
  });
});
