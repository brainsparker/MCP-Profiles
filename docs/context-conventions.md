# Context file section conventions

`you-aware` reads your project's `AGENTS.md` (or `CLAUDE.md`, as a fallback) at call time and parses these section conventions into ground-truth search parameters. **None of them are required** — any `AGENTS.md` delivers value (without an explicit `## Project Context` section, the top of the file is used, truncated to 4 KB). The conventions just make the population deterministic and precise.

Headings are matched case-insensitively at any heading level.

## `## Trusted Sources`

Domains to boost in ranking. Bullets, numbered lists, comma-separated lists, bare domains, URLs, and markdown links all work — entries are normalized to bare domains and non-domains are skipped.

```markdown
## Trusted Sources
- react.dev
- [TanStack](https://tanstack.com)
- https://nodejs.org/docs/
```

## `## Blocked Sources`

Domains to demote or filter, same entry formats:

```markdown
## Blocked Sources
- w3schools.com, geeksforgeeks.org
```

## `## Decisions` (or `## Decisions Ledger`)

Prior decisions, one per line. Lines with a recognizable rejection become negative vocabulary on topically related queries — a project that rejected `moment.js` gets `-moment` on date-library queries (and never on queries that mention moment themselves). Recognized shapes:

```markdown
## Decisions
- Rejected moment.js in favor of date-fns (bundle size).
- Chose pnpm over npm for package management.
- Avoid styled-components; we use CSS modules.
```

Lines without a rejection are simply ignored, so a free-form decision log is fine.

## `## Project Context`

Free text describing the project, stack, and current focus. Sent as the `project_context` parameter (capped at 4 KB) and mined for lexical vocabulary: stack disambiguation terms, library names, and version numbers that are topically relevant to the query get appended as quoted terms. Keep one concern per line — relevance gating works line-by-line.

```markdown
## Project Context
TypeScript app using date-fns for date handling.
@tanstack/query for data fetching.
```

## `## Freshness`

Default freshness preference: `fresh`, `stable`, or `any`. The model can override it per call.

```markdown
## Freshness
stable
```

## Notes

- v1 reads `AGENTS.md` and `CLAUDE.md` only (walking up from the project root, up to 6 levels; the nearest file wins, and within a directory `AGENTS.md` wins). Cursor-rules and Cline-memory adapters ship at v2 GA.
- Without an explicit `## Project Context` section, the file head is used verbatim (naive truncation — smart slicing is planned for v2.1). If your context file is long, adding the explicit section is the highest-leverage convention to adopt.
- Opt out of file reading entirely with `YOU_AWARE_READ_CONTEXT=off`; the model can still populate every parameter per call.
- The companion skill in [`skills/you-aware/`](../skills/you-aware) teaches agents these conventions, including when to write them back.
