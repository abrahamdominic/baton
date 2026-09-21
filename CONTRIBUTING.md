# Contributing to Baton

Thanks for helping unstick pull requests. This document covers the essentials.

## Getting set up

```bash
git clone <repo> && cd baton
npm install
npm run db:sqlite:schema && npm run db:sqlite:push   # local SQLite mirror
cp .env.example .env                                  # fill in GitHub credentials
npm run dev        # web app
npm run worker     # in a second terminal
```

No PostgreSQL is required for local development.

## Before you open a PR

Run the full local check suite, CI runs the same:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Project layout

- `src/lib/engine/`, the pure classification/nudge logic. Keep it deterministic
  and unit-testable; this is the heart of the product.
- `src/lib/github/`, all GitHub API access. Keep Octokit usage isolated here.
- `src/lib/webhooks/`, webhook verification and event dispatch.
- `src/worker/`, background processing entrypoints.
- `src/app/`, Next.js App Router pages and route handlers.
- `prisma/schema.prisma`, the canonical schema. Never edit the generated
  `schema.sqlite.prisma` by hand; run `npm run db:sqlite:schema`.

## Guidelines

- **No AI in the critical path.** Classification must remain deterministic,
  explainable, and testable. Propose AI features behind an explicit flag.
- **Pure functions first.** New state logic belongs in `classification.ts` with
  tests, not in request handlers.
- **One GitHub surface.** Surface state via the existing status comment and
  labels, upsert in place, never spam a thread.
- **Be a good citizen.** Batch API calls, respect rate limits, and fail soft
  (log and continue) so one bad PR never blocks a sweep.
- **Least privilege.** Do not add GitHub permissions without updating
  `SECURITY.md` and justifying the need.
- **Keep both schemas working.** New models/fields must be PostgreSQL- and
  SQLite-compatible (no enums, no `@db.*` modifiers).

## Tests

Add unit tests for any new logic in the engine (`*.test.ts` next to the file).
Tests run on Node with Vitest; the SQLite database is sufficient for integration
paths. Prefer fixtures over live API calls.

## Commits & PRs

- Write focused commits with a clear, imperative subject.
- Describe the *why* in the PR body, not just the *what*.
- Update the relevant docs (`README.md`, `ARCHITECTURE.md`, `SECURITY.md`,
  `ENVIRONMENT.md`, `PRODUCT.md`) when behavior changes.

## Code style

- TypeScript strict, ESLint flat config. `npm run lint` must be clean.
- Prefer small server-only modules over client components; the dashboard is
  rendered server-side.
- Never log secrets; the logger redacts sensitive keys, but don't pass them in.
