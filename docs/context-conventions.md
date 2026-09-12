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

## Notes

- Files are read with a 256 KiB per-file cap (oversized files are truncated to the head, with a stderr warning). All `.mdc` rule files are included regardless of their `globs` frontmatter — glob-scoped inclusion is a documented v1 simplification.
- Adding an explicit `## Project Context` section is the highest-leverage convention to adopt — it is the only way file content becomes free-text search context by default. (The opt-in `YOU_AWARE_CONTEXT_FALLBACK=head` restores the old top-of-file behavior; even then, the head never enters telemetry.)
- A rejected option in `## Decisions` must look like an identifier (`moment.js`, `styled-components`, `@tanstack/query`) or be backticked (`` Avoid `lodash` ``) — plain-prose guidance like "Avoid premature optimization" is deliberately ignored, because a wrong `-exclusion` destroys recall.
- Opt out of file reading entirely with `YOU_AWARE_READ_CONTEXT=off`; the model can still populate every parameter per call.
- The companion skill in [`skills/you-aware/`](../skills/you-aware) teaches agents these conventions, including when to write them back.

## Dependency manifests (automatic, no section needed)

Alongside the context file, `you-aware` reads the project's dependency manifests so a query that names a dependency carries the version the project actually runs. Nothing has to be authored for this; if you already keep a `## Project Context` line like `React 19` for a library, that line wins and the manifest pin for the same library is skipped.

Discovery walks up from the project root (up to 6 levels, nearest directory wins) and reads every manifest found in that directory:

| Manifest | What is read | Lockfile consulted |
|---|---|---|
| `package.json` | `dependencies`, `devDependencies` | `node_modules/<name>/package.json` (installed), then `package-lock.json` |
| `pyproject.toml` | `[project] dependencies`, `[dependency-groups]`, `[tool.poetry.dependencies]`, `[tool.poetry.group.*.dependencies]` | `uv.lock`, `poetry.lock` |
| `requirements.txt` | requirement lines (flags, `-r` includes, URLs skipped) | `uv.lock`, `poetry.lock` |
| `go.mod` | direct `require` entries (`// indirect` and pseudo-versions skipped) | none needed; go.mod versions are exact |
| `Cargo.toml` | `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]` | `Cargo.lock` |

How the pin is written:

- Installed, locked, or exactly pinned versions become `name major.minor` (`react 19.2`, `pydantic 2.11`). Ranges that only fix the major (`^18.2.0`, `>=2.0`, Cargo's bare `"1.0"`) become `name major` (`react 18`). 0.x versions keep the minor either way (`reqwest 0.12`).
- Scoped npm packages pin by their bare name (`@tanstack/react-query` → `react-query 5.62`); Go modules by their last path segment (`github.com/gin-gonic/gin` → `gin 1.10`).
- At most two pins per query, in query order. A query is matched on the package name, common spellings (`nextjs`, `tanstack`, `sklearn`, `pytorch`), scoped names without the `@`, Python names in `-`/`_`/`.` spellings, and Go modules by last segment (except `golang.org/x/*`, whose segments are ordinary words).
- No pin when the query already carries a version (`react 19 use hook`, `react@18`) or asks about moving between versions (`upgrade`, `migrate`, `changelog`, `release notes`, `breaking changes`, `what's new`, `latest version`).

Every pin is visible in the trace as `dependency_versions_applied: ["react 19.2 (installed)"]`, with the precision in parentheses (`installed`, `locked`, `exact`, `minor`, `major`). Disable with `YOU_AWARE_MANIFESTS=off` or `--no-manifests`; `YOU_AWARE_READ_CONTEXT=off` disables it as well. Manifests over 256 KiB are skipped, and at most 500 dependencies are considered.
