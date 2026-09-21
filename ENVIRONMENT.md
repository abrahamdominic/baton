# Environment variables

All variables are validated at boot by `src/lib/config.ts` (Zod). Invalid
configuration throws immediately with a readable message. Copy `.env.example`
to `.env` to get started.

## Core

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production`. |
| `SITE_URL` | no | `https://baton-xi.vercel.app` | Canonical public URL. Used for sitemap, robots, canonical links, OG metadata, and in-product links. No trailing slash. |
| `APP_URL` | no | `https://baton-xi.vercel.app` | Where the app actually runs. Used for OAuth redirects and absolute links. Point at `http://localhost:3000` for local dev. |
| `DATABASE_URL` | yes (prod) | `""` | PostgreSQL connection string. Not needed for local SQLite development. A production deploy without it fails at the first query. |

## GitHub OAuth (user sign-in)

Create an OAuth app (or reuse the GitHub App's OAuth credentials). Callback URL:
`{APP_URL}/auth/callback`.

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | yes | OAuth client ID. |
| `GITHUB_OAUTH_CLIENT_SECRET` | yes | OAuth client secret. |

If these are missing, the app runs but sign-in redirects to `/?oauth_config=1`.

## GitHub App (the bot)

Webhook URL `{APP_URL}/api/webhooks`. Permissions: Pull requests (R/W),
Issues (R/W), Checks (read), Metadata (read).

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_APP_ID` | yes | Numeric App ID. |
| `GITHUB_APP_SLUG` | no (default `baton`) | App URL slug, used for install links. |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | one of | Base64-encoded PEM (`openssl base64 -A < key.pem`). |
| `GITHUB_APP_PRIVATE_KEY_PATH` | one of | Filesystem path to the PEM. |
| `GITHUB_APP_PRIVATE_KEY` | one of | Raw PEM (with `\n` escapes). |
| `GITHUB_APP_WEBHOOK_SECRET` | yes | Secret configured in the App's webhook settings. Required to verify deliveries; without it the webhook route returns 500. |

## Worker & scheduling

| Variable | Default | Description |
| --- | --- | --- |
| `BATON_WORKER_POLL_MS` | `5000` | How often the worker polls the job queue. |
| `BATON_JOB_CONCURRENCY` | `4` | Number of jobs the worker processes in parallel. |
| `BATON_CRON_INTERVAL_MIN` | `720` | Intended sweep cadence (documentation + scheduling hint). |

## Production checklist (Vercel)

Baton runs on Vercel with zero build-specific env in the repository. All secrets
must be set in the hosting provider's environment settings:

| Variable | Required in prod | Failure mode when missing |
| --- | --- | --- |
| `SITE_URL` | yes | Fallback is `https://baton-xi.vercel.app` (see config). |
| `APP_URL` | yes | Fallback is `https://baton-xi.vercel.app`. |
| `DATABASE_URL` | yes (Postgres) | First Prisma query throws. |
| `GITHUB_OAUTH_CLIENT_ID` | yes | `/auth/login` redirects to `/?oauth_config=1` (sign-in broken). |
| `GITHUB_OAUTH_CLIENT_SECRET` | yes | `/auth/login` redirects to `/?oauth_config=1`; the callback returns `/?oauth_error=1` after a code exchange. |
| `GITHUB_APP_ID` | yes | App installs cannot be associated. |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | yes | App API calls fail. |
| `GITHUB_APP_WEBHOOK_SECRET` | yes | Webhook route returns 500. |
| `GITHUB_APP_SLUG` | no (default `baton`) | Install links use `baton`. |

Per-repo equivalent: `.env` locally (SQLite + localhost OAuth redirects), Vercel
env vars in production (Postgres + production OAuth redirects). Never commit
`.env` or any secret to the repository.

## Notes

- **Private key formats.** Prefer `BASE64` in production secrets managers; `PATH`
  for local files; raw `KEY` for quick local testing (watch out for `\n`).
- **Local database.** Local development regenerates the client from
  `prisma/schema.sqlite.prisma`, which hardcodes `file:./dev.db`; `DATABASE_URL`
  is ignored locally. Run `npm run db:sqlite:schema && npm run db:sqlite:push`.
- **Production database.** Regenerate the Prisma client from the canonical
  Postgres schema (`npm run db:generate`) and run `npm run db:deploy` before
  starting the app.
- **Multiple web instances.** The rate limiter is in-memory; front Baton with a
  shared limiter (or a single edge) when scaling out.
