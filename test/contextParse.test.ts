import { describe, it, expect, vi } from "vitest";
import {
  exclusionTermFor,
  normalizeDomain,
  parseDecisionLine,
  parseHarnessContext,
} from "../src/context/parse.js";
import { PROJECT_CONTEXT_MAX_BYTES } from "../src/types.js";

const FIXTURE = `# Test Project

TypeScript app. Uses date-fns for all date handling.

## Trusted Sources
- react.dev
- [TanStack](https://tanstack.com)
- https://www.nodejs.org/docs/latest/
- not a domain at all

## Blocked Sources
- w3schools.com, geeksforgeeks.org

## Decisions
- Rejected moment.js in favor of date-fns for date handling.
- Chose pnpm over npm for package management.
- We like coffee.

## Project Context
TypeScript app using date-fns for date handling.

## Freshness
stable
`;

describe("normalizeDomain", () => {
  it("strips protocol, www, and paths", () => {
    expect(normalizeDomain("https://www.react.dev/reference/react")).toBe("react.dev");
  });
  it("unwraps markdown links", () => {
    expect(normalizeDomain("[React docs](https://react.dev)")).toBe("react.dev");
  });
  it("rejects non-domains", () => {
    expect(normalizeDomain("not a domain at all")).toBeNull();
  });
});

describe("exclusionTermFor", () => {
  it("drops .js suffixes (moment.js → moment)", () => {
    expect(exclusionTermFor("moment.js")).toBe("moment");
  });
  it("uses the scope for scoped packages", () => {
    expect(exclusionTermFor("@tanstack/query")).toBe("tanstack");
  });
  it("keeps hyphenated names intact", () => {
    expect(exclusionTermFor("date-fns")).toBe("date-fns");
  });
});

describe("parseDecisionLine", () => {
  it('parses "Rejected X in favor of Y"', () => {
    const d = parseDecisionLine("- Rejected moment.js in favor of date-fns for date handling.");
    expect(d).not.toBeNull();
    expect(d!.rejected).toBe("moment.js");
    expect(d!.exclusionTerm).toBe("moment");
    expect(d!.topicTokens).toContain("date");
  });
  it('parses "Chose X over Y" (Y is rejected)', () => {
    const d = parseDecisionLine("- Chose pnpm over npm for package management.");
    expect(d!.rejected).toBe("npm");
    expect(d!.exclusionTerm).toBe("npm");
  });
  it("skips filler words after the rejection verb", () => {
    expect(parseDecisionLine("- Avoid using moment.js for date handling")!.exclusionTerm).toBe("moment");
    expect(parseDecisionLine("- Don't use the w3schools tutorials")!.exclusionTerm).toBe("w3schools");
  });
  it("never emits a stopword as an exclusion term", () => {
    const d = parseDecisionLine("- Avoid using any of these");
    expect(d === null || !["using", "the", "any", "all"].includes(d.exclusionTerm)).toBe(true);
  });
  it("returns null for lines without a rejection", () => {
    expect(parseDecisionLine("- We like coffee.")).toBeNull();
  });
});

describe("parseHarnessContext", () => {
  const ctx = parseHarnessContext(FIXTURE, "/tmp/AGENTS.md");

  it("parses trusted sources with normalization, skipping junk", () => {
    expect(ctx.trustedSources).toEqual(["react.dev", "tanstack.com", "nodejs.org"]);
  });
  it("parses comma-separated blocked sources", () => {
    expect(ctx.blockedSources).toEqual(["w3schools.com", "geeksforgeeks.org"]);
  });
  it("parses the decisions ledger, skipping non-decisions", () => {
    expect(ctx.decisions.map((d) => d.rejected)).toEqual(["moment.js", "npm"]);
  });
  it("prefers the explicit Project Context section", () => {
    expect(ctx.projectContext).toBe("TypeScript app using date-fns for date handling.");
  });
  it("parses freshness", () => {
    expect(ctx.freshness).toBe("stable");
  });

  it("derives no project_context from the file head by default (raw head is Tier 1)", () => {
    const noSection = "# Big\n\n" + "x".repeat(PROJECT_CONTEXT_MAX_BYTES * 2);
    const c = parseHarnessContext(noSection, "/tmp/AGENTS.md");
    expect(c.projectContext).toBeUndefined();
    expect(c.projectContextExplicit).toBe(false);
  });

  it("uses top-of-file truncation only when the head fallback is opted in", () => {
    const noSection = "# Big\n\n" + "x".repeat(PROJECT_CONTEXT_MAX_BYTES * 2);
    const c = parseHarnessContext(noSection, "/tmp/AGENTS.md", { headFallback: true });
    expect(c.projectContext!.length).toBe(PROJECT_CONTEXT_MAX_BYTES);
    expect(c.projectContext!.startsWith("# Big")).toBe(true);
    expect(c.projectContextExplicit).toBe(false);
  });

  it("treats fenced code blocks as opaque: no heading splits, no parameter injection", () => {
    const fenced = `## Project Context
Next.js 15 app, TypeScript strict.
Run locally:
\`\`\`bash
# start the dev server
npm run dev
\`\`\`
One concern per line.

## Docs example (not live config)
\`\`\`markdown
## Blocked Sources
- stackoverflow.com, github.com
\`\`\`

## Trusted Sources
- react.dev
`;
    const c = parseHarnessContext(fenced, "/tmp/AGENTS.md");
    // The bash comment must not truncate the section…
    expect(c.projectContext).toContain("One concern per line.");
    // …and the fenced markdown example must not inject live blocked sources.
    expect(c.blockedSources).toEqual([]);
    expect(c.trustedSources).toEqual(["react.dev"]);
  });

  it("does not close a fence on a line that carries an info string (```md inside ````text)", () => {
    // CommonMark nesting: the outer fence is longer, the inner ```md line
    // must be treated as content — pre-fix it wrongly CLOSED the outer fence
    // and the example's Blocked Sources went live.
    const nested = `## Docs example
\`\`\`\`text
\`\`\`md
## Blocked Sources
- github.com
\`\`\`
\`\`\`\`

## Trusted Sources
- react.dev
`;
    const c = parseHarnessContext(nested, "/tmp/AGENTS.md");
    expect(c.blockedSources).toEqual([]);
    expect(c.trustedSources).toEqual(["react.dev"]);
  });

  it("warns on an unclosed fence instead of silently losing every later section", () => {
    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const c = parseHarnessContext(
      "# Top\n```\nunclosed fence\n\n## Trusted Sources\n- react.dev\n",
      "/tmp/AGENTS.md",
    );
    spy.mockRestore();
    expect(c.trustedSources).toEqual([]); // CommonMark: the fence runs to EOF
    expect(warnings.some((w) => w.includes("unclosed code fence"))).toBe(true);
  });

  it("keeps markdown links with titles and angle-bracket destinations", () => {
    expect(normalizeDomain('[React](https://react.dev "React docs")')).toBe("react.dev");
    expect(normalizeDomain("[Node](<https://nodejs.org/docs>)")).toBe("nodejs.org");
  });

  it("rejects prose entries in source lists instead of coining fake domains", () => {
    const c = parseHarnessContext(
      "## Trusted Sources\n- Node.js official docs\n- react.dev\n",
      "/tmp/AGENTS.md",
    );
    expect(c.trustedSources).toEqual(["react.dev"]);
  });

  it("drops plain-prose rejections and keeps identifier-shaped or backticked ones", () => {
    expect(parseDecisionLine("- Avoid premature optimization; profile before tuning.")).toBeNull();
    expect(parseDecisionLine("- Avoid using classes; prefer functional React components.")).toBeNull();
    expect(parseDecisionLine("- Avoid `lodash`; use native array methods.")?.exclusionTerm).toBe("lodash");
    expect(parseDecisionLine("- Avoid styled-components; we use CSS modules.")?.exclusionTerm).toBe(
      "styled-components",
    );
  });

  it("caps project_context by UTF-8 bytes, not UTF-16 code units (§8.3 privacy bound)", () => {
    const multibyte = "## Project Context\n" + "é".repeat(PROJECT_CONTEXT_MAX_BYTES);
    const c = parseHarnessContext(multibyte, "/tmp/AGENTS.md");
    expect(Buffer.byteLength(c.projectContext!, "utf8")).toBeLessThanOrEqual(PROJECT_CONTEXT_MAX_BYTES);
    expect(c.projectContext!.length).toBe(PROJECT_CONTEXT_MAX_BYTES / 2);
  });
});
