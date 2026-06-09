import { describe, it, expect } from "vitest";
import { compileQuery, extractVocabulary, keywordize, looksLexical } from "../src/compile.js";
import { parseDecisionLine } from "../src/context/parse.js";
import type { Decision, SearchParams } from "../src/types.js";

const NOW = new Date("2026-06-09T00:00:00Z");
const OPTS = { now: NOW, freshWindowDays: 180 };

const dateDecision = parseDecisionLine(
  "- Rejected moment.js in favor of date-fns for date handling.",
) as Decision;
const pkgDecision = parseDecisionLine("- Chose pnpm over npm for package management.") as Decision;

const params: SearchParams = {
  trusted_sources: ["react.dev", "tanstack.com"],
  blocked_sources: ["w3schools.com"],
  project_context: "TypeScript app using date-fns for date handling.\n@tanstack/query for data fetching.",
  freshness: "stable",
};

describe("looksLexical", () => {
  it("detects operator-bearing queries", () => {
    expect(looksLexical('typescript "date-fns" site:react.dev')).toBe(true);
    expect(looksLexical("react -moment")).toBe(true);
    expect(looksLexical("best way to parse dates")).toBe(false);
  });
});

describe("keywordize", () => {
  it("strips interrogative scaffolding and project filler", () => {
    expect(keywordize("best way to handle date parsing in this project")).toBe("date parsing");
    expect(keywordize("How do I configure vitest coverage?")).toBe("configure vitest coverage");
  });
  it("keeps short queries intact", () => {
    expect(keywordize("date parsing")).toBe("date parsing");
  });
});

describe("compileQuery (PRD §8.2 / §9.3)", () => {
  it("reproduces the §9.3 example: vocabulary injection + ledger exclusion", () => {
    const c = compileQuery(
      "best way to handle date parsing in this project",
      params,
      [dateDecision, pkgDecision],
      { mode: "auto", ...OPTS },
    );
    expect(c.query).toBe('typescript date parsing "date-fns" -moment');
    expect(c.vocabularyInjected).toEqual(["typescript", "date-fns"]);
    expect(c.decisionsApplied).toEqual(["moment.js rejected → -moment"]);
    expect(c.trustedBoost).toEqual(["react.dev", "tanstack.com"]);
    expect(c.trustedNarrowed).toBe(false);
  });

  it("gates vocabulary on topical relevance (no @tanstack/query on a date query)", () => {
    const c = compileQuery("best way to handle date parsing in this project", params, [], {
      mode: "auto",
      ...OPTS,
    });
    expect(c.query).not.toContain("tanstack");
  });

  it("gates ledger exclusions on topical overlap (no -npm on a date query)", () => {
    const c = compileQuery("best way to handle date parsing in this project", params, [pkgDecision], {
      mode: "auto",
      ...OPTS,
    });
    expect(c.query).not.toContain("-npm");
  });

  it("never excludes a term the query itself mentions", () => {
    const c = compileQuery("migrate from moment to date-fns", params, [dateDecision], {
      mode: "auto",
      ...OPTS,
    });
    expect(c.query).not.toContain("-moment");
    expect(c.decisionsApplied).toEqual([]);
  });

  it("passes already-lexical queries through without keywordization or injection", () => {
    const c = compileQuery('react "server components" site:react.dev', params, [], {
      mode: "auto",
      ...OPTS,
    });
    expect(c.query).toBe('react "server components" site:react.dev');
    expect(c.vocabularyInjected).toEqual([]);
  });

  it("operators mode compiles sources and freshness into portable operators", () => {
    const c = compileQuery(
      "date parsing",
      { ...params, freshness: "fresh" },
      [],
      { mode: "operators", ...OPTS },
    );
    expect(c.query).toContain("(site:react.dev OR site:tanstack.com)");
    expect(c.query).toContain("-site:w3schools.com");
    expect(c.query).toMatch(/after:\d{4}-\d{2}-\d{2}/);
    expect(c.trustedNarrowed).toBe(true);
    expect(c.blockedApplied).toEqual(["w3schools.com"]);
  });

  it("stable freshness emits no date operator", () => {
    const c = compileQuery("date parsing", params, [], { mode: "operators", ...OPTS });
    expect(c.query).not.toContain("after:");
  });

  it("suppresses after: when the backend carries freshness natively (free tier)", () => {
    const c = compileQuery("date parsing", { ...params, freshness: "fresh" }, [], {
      mode: "operators",
      nativeFreshness: true,
      ...OPTS,
    });
    expect(c.query).not.toContain("after:");
  });

  it("native mode skips vocabulary injection but keeps ledger exclusions (the ledger's only v1 carrier)", () => {
    const c = compileQuery(
      "best way to handle date parsing in this project",
      params,
      [dateDecision],
      { mode: "native", ...OPTS },
    );
    expect(c.query).toBe("date parsing -moment");
    expect(c.vocabularyInjected).toEqual([]);
    expect(c.decisionsApplied).toEqual(["moment.js rejected → -moment"]);
  });

  it("guards short rejected terms (qs, ws) the content tokenizer drops", () => {
    const qsDecision = parseDecisionLine(
      "- Rejected qs in favor of URLSearchParams for query string parsing.",
    ) as Decision;
    const c = compileQuery("migrate from qs to URLSearchParams", params, [qsDecision], {
      mode: "auto",
      ...OPTS,
    });
    expect(c.query).not.toContain("-qs");
    expect(c.decisionsApplied).toEqual([]);
  });

  it("operators mode never duplicates or contradicts operators the query already carries", () => {
    const c = compileQuery(
      'react hydration error site:react.dev "use client"',
      { ...params, freshness: "fresh" },
      [],
      { mode: "operators", ...OPTS },
    );
    // Query already narrows with site: — no second site: group.
    expect(c.query.match(/site:react\.dev/g)).toHaveLength(1);
    expect(c.trustedNarrowed).toBe(false);
    // Blocked negation for an unrelated domain still applies.
    expect(c.query).toContain("-site:w3schools.com");
  });

  it("operators mode resolves trusted∩blocked overlap with blocked-wins, matching rank time", () => {
    const c = compileQuery(
      "react suspense data fetching",
      { trusted_sources: ["react.dev"], blocked_sources: ["react.dev"] },
      [],
      { mode: "operators", ...OPTS },
    );
    expect(c.query).not.toContain(" site:react.dev");
    expect(c.query).toContain("-site:react.dev");
  });

  it("does not stack a second date operator on a query that already has one", () => {
    const c = compileQuery("react 19 changelog after:2026-01-01", { freshness: "fresh" }, [], {
      mode: "operators",
      ...OPTS,
    });
    expect(c.query.match(/after:/g)).toHaveLength(1);
  });
});

describe("extractVocabulary", () => {
  it("keeps dotted package names (lodash.merge, socket.io, video.js) while skipping real URLs", () => {
    const terms = extractVocabulary(
      "We deep merge config with lodash.merge and stream over socket.io.\n" +
        "Player built on video.js.\n" +
        "Docs live at https://react.dev and www.example.com.",
    ).map((c) => c.term);
    expect(terms).toContain("lodash.merge");
    expect(terms).toContain("socket.io");
    expect(terms).toContain("video.js");
    expect(terms).not.toContain("react.dev");
    expect(terms).not.toContain("example.com");
  });

  it("extracts library+version pairs (§8.2: version numbers as quoted terms)", () => {
    const terms = extractVocabulary("React 19.2 used for data fetching.\nrunning node@22.1 in CI").map(
      (c) => c.term,
    );
    expect(terms).toContain("react 19.2");
    expect(terms).toContain("node 22.1");
  });

  it("injects a relevant version pair into the compiled query", () => {
    const c = compileQuery(
      "suspense data fetching errors",
      { project_context: "React 19.2 used for data fetching." },
      [],
      { mode: "auto", ...OPTS },
    );
    expect(c.query).toContain('"react 19.2"');
  });
});
