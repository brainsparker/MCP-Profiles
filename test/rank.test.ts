import { describe, it, expect } from "vitest";
import { postRank } from "../src/rank.js";
import type { SearchHit } from "../src/types.js";

const hit = (url: string): SearchHit => ({ url, title: url, snippet: "" });

const hits = [
  hit("https://www.w3schools.com/js/js_dates.asp"),
  hit("https://blog.example.com/date-parsing"),
  hit("https://react.dev/learn/dates"),
  hit("https://docs.tanstack.com/query/latest"),
  hit("https://stackoverflow.com/q/123"),
];

describe("postRank (client-side Product A mechanics)", () => {
  const out = postRank(hits, ["react.dev", "tanstack.com"], ["w3schools.com"]);

  it("partitions trusted to the front and blocked to the tail, order-stable", () => {
    expect(out.hits.map((h) => h.url)).toEqual([
      "https://react.dev/learn/dates",
      "https://docs.tanstack.com/query/latest",
      "https://blog.example.com/date-parsing",
      "https://stackoverflow.com/q/123",
      "https://www.w3schools.com/js/js_dates.asp",
    ]);
  });

  it("matches subdomains (docs.tanstack.com → tanstack.com)", () => {
    expect(out.boosted).toContain("docs.tanstack.com");
  });

  it("reports pre/post top-3 for the trace", () => {
    expect(out.preRankTop3[0]).toContain("w3schools");
    expect(out.postRankTop3[0]).toContain("react.dev");
  });

  it("is a no-op without trusted/blocked lists", () => {
    const plain = postRank(hits, [], []);
    expect(plain.hits).toEqual(hits);
    expect(plain.preRankTop3).toEqual(plain.postRankTop3);
    expect(plain.memoryBoosted).toEqual([]);
  });

  it("slots the preferred (memory) tier between trusted and the middle", () => {
    const ranked = postRank(hits, ["react.dev"], ["w3schools.com"], ["stackoverflow.com"]);
    expect(ranked.hits.map((h) => h.url)).toEqual([
      "https://react.dev/learn/dates",
      "https://stackoverflow.com/q/123",
      "https://blog.example.com/date-parsing",
      "https://docs.tanstack.com/query/latest",
      "https://www.w3schools.com/js/js_dates.asp",
    ]);
    expect(ranked.memoryBoosted).toEqual(["stackoverflow.com"]);
  });

  it("trusted and blocked both beat preferred for the same domain", () => {
    const ranked = postRank(hits, ["react.dev"], ["w3schools.com"], ["react.dev", "w3schools.com"]);
    expect(ranked.hits[0]!.url).toContain("react.dev");
    expect(ranked.hits.at(-1)!.url).toContain("w3schools");
    expect(ranked.memoryBoosted).toEqual([]);
  });
});
