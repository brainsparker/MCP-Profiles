---
name: you-aware
description: Guidance for projects where the you-aware context-aware web search tool is available. Use when (1) researching anything on the web — library or framework choices, current documentation, API or version changes, anything time-sensitive — so the search call carries the project's context, and (2) immediately after a technology choice is made, reversed, or rejected in this project, so AGENTS.md records it in a form future searches can use.
license: MIT
---

# you-aware: context-aware search and context curation

This project has the you-aware `search` tool available (an MCP server — your client may expose it under a namespaced id such as `you-aware_search`). It is web search that already knows the project: at call time the server reads the project's `AGENTS.md` (or `CLAUDE.md` as a fallback), parses trusted/blocked sources, prior decisions, project context, and freshness preference, merges those with whatever parameters you supply, compiles the query into lexical form, and returns ranked results plus a trace of exactly what ran.

This skill covers both halves of that loop: calling the tool well, and keeping the context file it reads accurate.

## When to reach for the search tool

Prefer the you-aware `search` tool over generic web search whenever the question touches this project's stack:

- Library and framework research or comparisons
- Current documentation, API surfaces, breaking changes
- Version-sensitive questions ("does X support Y in version Z?")
- Anything where the project's prior decisions should shape the results

## How to call it

Pass `query` plus any of the four optional parameters. The server merges your values with its own deterministic read of `AGENTS.md` — you do not need to repeat what the file already says, but you should add what only you can see:

- `trusted_sources` / `blocked_sources` (arrays of domains): unioned with the file's lists. Add domains the current conversation has revealed as good or bad.
- `project_context` (free text, max 4 KB): overrides the file-derived context when supplied. Use it to fold in conversation-level context the file cannot know — the module you are working in, the error at hand, constraints the user just stated. If you have nothing beyond what the file says, omit it and let the file win.
- `freshness`: `"fresh"` for fast-moving topics (new releases, security advisories), `"stable"` for evergreen concepts, `"any"` or omit otherwise. Overrides the file's default per call.

Write queries with one retrieval intent each. Lexical, operator-shaped queries (quotes, `site:`, `-term`) pass through untouched; natural-language queries get compiled.

## Handling a decomposition_request

If the response is a `decomposition_request` instead of results, the query spanned multiple retrieval intents. You are the rewriter:

1. Split the question into focused, single-intent sub-queries — one entity or claim per query, lexical keywords over prose.
2. Call `search` once per sub-query.
3. Synthesize across the result sets yourself.

Do not retry the original compound query unchanged.

## Reading the trace

Every response ends with a trace (`query_received`, `query_compiled`, sources boosted/blocked, decisions applied, freshness, pre/post-rank top 3). When results look off, the trace says why:

- Wrong vocabulary injected → `## Project Context` in `AGENTS.md` is stale; fix the file, or override with `project_context` for now.
- A needed domain missing or a junk domain ranked → adjust `trusted_sources`/`blocked_sources` on the next call, and record the durable ones in `AGENTS.md`.
- An unwanted `-term` exclusion applied → a decisions-ledger entry fired; if the decision no longer holds, update `## Decisions`.

## Curating AGENTS.md (the file half of the loop)

The server reads the nearest `AGENTS.md` walking up from the project root (`CLAUDE.md` is the fallback; within a directory `AGENTS.md` wins). Maintain these sections — headings match case-insensitively at any heading level, and none are required:

### Project Context

Free text on stack and current focus, one concern per line (relevance gating works line-by-line). Mined for vocabulary on related queries.

```markdown
## Project Context
TypeScript app using date-fns for date handling.
@tanstack/query for data fetching; React 19.
```

### Trusted Sources and Blocked Sources

Domains to boost or demote. Bullets, comma-separated lists, bare domains, URLs, and markdown links all normalize to bare domains.

```markdown
## Trusted Sources
- react.dev
- [TanStack](https://tanstack.com)

## Blocked Sources
- w3schools.com, geeksforgeeks.org
```

### Decisions

One decision per line. Lines containing a recognizable rejection become exclusion terms on topically related searches. Use these shapes:

```markdown
## Decisions
- Rejected moment.js in favor of date-fns (bundle size).
- Chose pnpm over npm for package management.
- Avoid styled-components; we use CSS modules.
```

Free-form lines without a rejection are harmlessly ignored, so keep the full decision log here.

### Freshness

A single default: `fresh`, `stable`, or `any`. The model can override it per call.

## When to update the file

Update `AGENTS.md` in the same turn when:

- A technology choice is made, reversed, or rejected → add or amend a `## Decisions` line in one of the recognized shapes above.
- Results from a domain repeatedly prove good or bad → add it to `## Trusted Sources` or `## Blocked Sources`.
- The stack or focus shifts (new framework, major version bump) → update `## Project Context`.

If a section is missing, add it. This is what makes the next search better than the last one.
