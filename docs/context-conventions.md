# Context file section conventions

These are conventions *this server defines* — no other tool parses them today; they exist so parameter population is deterministic and inspectable rather than model-inferred. `you-aware` reads your project's context file at call time and parses them into ground-truth search parameters. Discovery walks up from the project root (up to 6 levels, nearest directory wins) checking, in order per directory:

1. `AGENTS.md` (the open convention)
2. `CLAUDE.md`
3. `GEMINI.md`
4. `.github/copilot-instructions.md`
5. `.cursor/rules/*.mdc` (lexical order, YAML frontmatter stripped) + legacy `.cursorrules`
6. `.clinerules` (single file, or a directory of `.md` files)
7. `.windsurfrules`

The first convention with a hit wins; the same parser runs regardless of source, so a `## Trusted Sources` section works in a `.cursorrules` exactly as it does in `AGENTS.md`. **None of the sections are required** — a file with just `## Trusted Sources` already improves ranking. Free-text `project_context` is derived only from an explicit `## Project Context` section; without one, no file content rides the search call as free text (an opt-in head fallback exists: `YOU_AWARE_CONTEXT_FALLBACK=head`, see [data-handling.md](./data-handling.md)). Fenced code blocks are opaque to the parser — headings inside examples never become live configuration.

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

## Imports

Two of the conventions above define an import grammar, and `you-aware` follows it the way the harness does, so the server sees the same document your agent sees:

- **`CLAUDE.md`** (Claude Code): `@path/to/file` anywhere in the text, on its own line or mid-sentence. Paths resolve relative to the file that contains the import; `~/` means your home directory; absolute paths work. Imports nest up to four hops (five files deep). Anything inside a fenced block or an inline code span is not an import. Any file type is accepted, matching Claude Code.
- **`GEMINI.md`** (Gemini CLI): `@./path/to/file.md` or `@/absolute/path.md`. Only Markdown files are followed; other targets are skipped with a stderr warning.

Imported content is spliced in place of the `@path` token, so this works:

```markdown
## Trusted Sources
@docs/trusted-sources.md
```

as does a shared block imported from your home directory:

```markdown
@~/.claude/search-sources.md
```

Guard rails, all deliberate:

- An `@` token whose path does not exist is left alone. `@tanstack/query` in a Decisions line stays a package name.
- A file is included once; circular imports are broken at the first repeat.
- Imports must resolve inside the context file's directory tree, or inside your home directory when written with `~/`. Anything else (an absolute path elsewhere, `@../` climbing out of the project) is skipped with a warning. Claude Code gates such imports behind an approval prompt that a stdio server cannot show, so declining is the faithful choice.
- The whole expanded document stays under the 256 KiB read cap; once it is reached, further imports are not followed.
- Imported files are Tier 1 exactly like the context file itself ([data-handling.md](./data-handling.md)): read in-process, never transmitted, never in telemetry. Warnings name the basename only.
- `AGENTS.md` and the rules-file conventions have no import grammar, so `@` tokens in them are never treated as imports.

Turn the whole mechanism off with `YOU_AWARE_FOLLOW_IMPORTS=off` (or `--no-imports`) to read `CLAUDE.md` / `GEMINI.md` verbatim.

## Notes

- Files are read with a 256 KiB per-file cap (oversized files are truncated to the head, with a stderr warning). All `.mdc` rule files are included regardless of their `globs` frontmatter — glob-scoped inclusion is a documented v1 simplification.
- Adding an explicit `## Project Context` section is the highest-leverage convention to adopt — it is the only way file content becomes free-text search context by default. (The opt-in `YOU_AWARE_CONTEXT_FALLBACK=head` restores the old top-of-file behavior; even then, the head never enters telemetry.)
- A rejected option in `## Decisions` must look like an identifier (`moment.js`, `styled-components`, `@tanstack/query`) or be backticked (`` Avoid `lodash` ``) — plain-prose guidance like "Avoid premature optimization" is deliberately ignored, because a wrong `-exclusion` destroys recall.
- Opt out of file reading entirely with `YOU_AWARE_READ_CONTEXT=off`; the model can still populate every parameter per call.
- The companion skill in [`skills/you-aware/`](../skills/you-aware) teaches agents these conventions, including when to write them back.
