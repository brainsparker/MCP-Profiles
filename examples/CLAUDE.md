# Example project

A sample `CLAUDE.md` showing every section convention `you-aware` reads (see docs/context-conventions.md). None are required — but with them, parameter population is deterministic.

## Project Context
TypeScript app using date-fns for date handling.
@tanstack/query for data fetching; React 19.
Deployed on Vercel; Node 22 runtime.

## Trusted Sources
- react.dev
- [TanStack](https://tanstack.com)
- nodejs.org

## Blocked Sources
- w3schools.com, geeksforgeeks.org

## Decisions
- Rejected moment.js in favor of date-fns (bundle size).
- Chose pnpm over npm for package management.
- Avoid styled-components; we use CSS modules.

## Freshness
stable
