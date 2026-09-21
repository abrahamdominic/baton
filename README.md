# Baton

**Know whose turn it is on every pull request, and unblock stalled work.**

Baton is a GitHub App that removes the single biggest source of lost engineering
time: pull requests that sit idle because nobody knows who is supposed to act
next. For every open PR it computes a precise state (`waiting for review`,
`changes required`, `CI failing`, `conflicts`, `ready to merge`, …), keeps a live
status comment and a state label on the PR itself, and sends a polite, targeted
`@mention` to the one person who can unblock it, after a threshold you control.

- **Live status card**: one always-current comment at the top of every PR.
- **State labels**: a canonical `baton:*` label mirrors the PR's state.
- **Targeted nudges**: one polite reminder per state, to the right person.
- **Your Move dashboard**: every stalled PR across your repos, sorted by whose
  turn it is and how long it has been waiting.
- **Least privilege**: no contents access. Baton never reads your code.

## Why

Roughly **89% of pull-request cycle time is spent waiting, not working**, and the
average first review takes days. On large repos, hundreds of PRs can sit with
zero engagement. GitHub's own docs ship a section called *"Who am I blocking?"*
because this is a universal pain. Baton makes the answer to that question
visible and actionable inside GitHub, where the work already happens.

## Quick start (local development)

Requirements: Node.js 20+ (24 recommended), npm. No PostgreSQL needed for local
development, a generated SQLite mirror of the production schema is used.

```bash
git clone https://github.com/your-org/baton && cd baton
npm install

# 1. Local database (SQLite mirror, generated from prisma/schema.prisma)
npm run db:sqlite:schema
npm run db:sqlite:push

# 2. Configure env
cp .env.example .env        # fill in GitHub App + OAuth credentials

# 3. Run the web app
npm run dev                 # http://localhost:3000

# 4. In another terminal, run the background worker
npm run worker
```

Baton needs two things from GitHub, both free to create:

1. **A GitHub App**: webhook URL `{APP_URL}/api/webhooks`, permissions
   *Pull requests: Read & write*, *Issues: Read & write*, *Checks: Read only*,
   *Metadata: Read only*. Subscribe to *Pull request*, *Pull request review*,
   *Pull request review comment*, *Check run*, *Check suite*, *Installation*.
2. **An OAuth App** (or use the GitHub App's own OAuth credentials), callback
   URL `{APP_URL}/auth/callback`, so users can sign in.

See [`ENVIRONMENT.md`](./ENVIRONMENT.md) for every variable.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run worker` | Job worker (poll queue, process PR refreshes) |
| `npm run cron` | One scheduled sweep of every enabled repo (run from hosted cron) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest unit tests |
| `npm run db:sqlite:schema` | Regenerate the SQLite mirror from the canonical schema |
| `npm run db:sqlite:push` | Create/reset the local SQLite database |
| `npm run db:migrate` / `db:deploy` | Prisma migrations against PostgreSQL |
| `node scripts/make-icons.mjs` | Regenerate favicon/apple-touch PNGs from `src/app/icon.svg` |

## Architecture at a glance

```
GitHub ──webhooks──▶ /api/webhooks ──▶ WebhookEvent (dedupe) ──▶ Job queue
                            │
GitHub ◀──REST/GraphQL──── GitHub App ──▶ runner: fetch → classify → persist
                            │                     │
                            │                     ├─ status comment (upsert)
                            │                     ├─ state label (sync)
                            │                     └─ nudge (@mention)
                            ▼
                    Postgres (SQLite local)
                            ▲
        Next.js dashboard ──┘   Worker ── poll Job queue, retry w/ backoff
```

The classifier (`src/lib/engine/classification.ts`) is a **pure function**: no
AI, fully deterministic, unit-tested. See [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the deep dive.

## Documentation

- [`PRODUCT.md`](./PRODUCT.md): the problem, the thesis, personas, pricing, growth.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): data model, state machine, pipelines.
- [`SECURITY.md`](./SECURITY.md): permissions, webhook integrity, threat model.
- [`ENVIRONMENT.md`](./ENVIRONMENT.md): every environment variable, explained.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): how to contribute.

## License

AGPL-3.0. See [`LICENSE`](./LICENSE).
