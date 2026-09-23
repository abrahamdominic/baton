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

## GitHub OAuth App (user sign-in)

Sign-in uses a **standalone GitHub OAuth App** (`client_id` + `client_secret`),
separate from the Baton GitHub App. Authorization callback URL:
`{APP_URL}/auth/callback` (production:
`https://baton-xi.vercel.app/auth/callback`). The `redirect_uri` is always the
canonical `APP_URL` in production (`src/lib/auth/redirect.ts`,
`getOAuthBaseUrl`), never the incoming request host, so preview or custom
domains can't trigger GitHub's `redirect_uri_mismatch`. In development it uses
the local host. Failures redirect with a machine-readable reason
(`/?oauth_error=1&reason=exchange_failed|state_mismatch|iss_mismatch|server_error`)
that the landing page renders as specific guidance.

When the user authorizes, GitHub redirects to `/auth/callback` with
`code`, `state`, and `iss=https://github.com/login/oauth`. The route validates
`iss` (when present) to prevent OAuth mix-up attacks, verifies the CSRF state
against the signed `baton_oauth_state` cookie, exchanges the code with the
client secret in a form-encoded POST body (the secret never appears in any
URL), upserts the user, and sets the `baton_session` httpOnly cookie.

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | yes | OAuth App client ID. |
| `GITHUB_OAUTH_CLIENT_SECRET` | yes | OAuth App client secret. |

If these are missing, the app runs but sign-in redirects to `/?oauth_config=1`.

The OAuth App is only used for **sign in** (identifying the Baton user, profile
and email, session creation). It never issues GitHub App installation tokens.

## GitHub App (the bot)

The **GitHub App** is a separate integration, used only for installations,
repository access, installation tokens, and webhooks.

Webhook URL `{APP_URL}/api/webhooks`. Permissions: Pull requests (R/W),
Issues (R/W), Checks (read), Metadata (read).

Installation redirects land on the **dedicated** installation callback at
`{APP_URL}/auth/install/callback`; this is both the App's **Setup URL** and,
if "Request user authorization (OAuth) during installation" is enabled, its
**User authorization callback URL**. It is intentionally NOT `/auth/callback`
(the standalone OAuth App callback). The route:

- links `installation_id` to the signed-in Baton user,
- with `request user authorization during installation` enabled, also receives
  a `code` that it exchanges with the GitHub App's **own** client secret,
- enqueues installation registration, and redirects to `/dashboard?installed=1`.

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_APP_ID` | yes | Numeric App ID. |
| `GITHUB_APP_SLUG` | no (default `baton`) | App URL slug, used for install links. Must match the real app (`https://github.com/apps/<slug>` returns 200). |
| `GITHUB_APP_CLIENT_ID` | only if "Request user authorization during installation" is enabled | The GitHub App's **own** Client ID, never the OAuth App's. |
| `GITHUB_APP_CLIENT_SECRET` | only if "Request user authorization during installation" is enabled | The GitHub App's **own** client secret, never `GITHUB_OAUTH_CLIENT_SECRET`. |
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
| `DATABASE_URL` | yes (Postgres) | First Prisma query throws; sign-in shows "service database is currently unavailable" (`/?oauth_error=1&reason=server_error`). See **Fix the database below**. |
| `GITHUB_OAUTH_CLIENT_ID` | yes | `/auth/login` redirects to `/?oauth_config=1` (sign-in broken). |
| `GITHUB_OAUTH_CLIENT_SECRET` | yes | `/auth/login` redirects to `/?oauth_config=1`; the callback returns `/?oauth_error=1` after a code exchange. |
| `GITHUB_APP_ID` | yes | App installs cannot be associated. |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | yes | App API calls fail. |
| `GITHUB_APP_WEBHOOK_SECRET` | yes | Webhook route returns 500. |
| `GITHUB_APP_SLUG` | no (default `abrahamdominic`) | Install links use `abrahamdominic`. This is the live GitHub App slug; keep it. |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | only if "Request user authorization during installation" is enabled | App code exchange fails (`/dashboard` redirect) if set incorrectly or using OAuth App values. |

### GitHub configuration (exact URLs)

**GitHub OAuth App**
- Authorization callback URL: `https://baton-xi.vercel.app/auth/callback`

**GitHub App**
- Webhook URL: `https://baton-xi.vercel.app/api/webhooks`
- Setup URL: `https://baton-xi.vercel.app/auth/install/callback`
- User authorization callback URL (required only if "Request user
  authorization (OAuth) during installation" is enabled):
  `https://baton-xi.vercel.app/auth/install/callback`

### Fix the database ("service database is currently unavailable")

That banner is the OAuth callback wrapping a thrown first-query failure. If
`DATABASE_URL` is missing, empty, or still the local SQLite value
(`file:./dev.db`) while the deployed Prisma client targets PostgreSQL, every
sign-in and install attempt fails. Fix it in the hosting provider's settings:

1. Add a PostgreSQL database (e.g. Vercel Postgres, Neon, Supabase) and copy
   its connection string.
2. Set `DATABASE_URL` to that `postgresql://…` string in the deployment's
   environment variables; do **not** copy the SQLite `file:./dev.db` value
   from `.env`; that only works locally against the SQLite mirror.
   For a Neon store, use the **unpooled/direct** URL (`POSTGRES_URL_NON_POOLING`),
   not the `-pooler` URL, unless the schema sets `connection_limit = 1`.
3. Run the migration against that database once:
   `npm run db:deploy` (or `npx prisma migrate deploy --schema prisma/schema.prisma`).
4. Redeploy. Vercel logs will now show `oauth-callback-db-unreachable` (URL is
   valid but the host/migrate step failed) instead of `oauth-callback-db-misconfigured`
   (URL missing/invalid), or no error at all.

**Current production state:** resolved. `DATABASE_URL` on Vercel (Production +
Preview) points at the Neon store `neon-camel-compass` (direct connection), and
migrations `0000_init` + `0001_admin_role` have been applied there. The OAuth
callback now also classifies failures as `github_api`, `db_misconfigured`,
`db_unreachable`, or `server_error` and the landing page shows a matching,
still honest reason instead of collapsing everything into "database unavailable".

Per-repo equivalent: `.env` locally (SQLite + localhost OAuth redirects), Vercel
env vars in production (Postgres + production OAuth redirects). Never commit
`.env` or any secret to the repository.

## Notes

- **Private key formats.** Prefer `BASE64` in production secrets managers; `PATH`
  for local files; raw `KEY` for quick local testing (watch out for `\n`). The
  base64-decoded value MUST be the `-----BEGIN RSA PRIVATE KEY-----` PEM text.
  A value such as `SHA256:…` is not a private key; installation-token calls
  (`src/lib/github/app.ts`) will fail until a real PEM is provided.
- **Install token vs sign-in.** Sign-in (OAuth exchange + `/user`) needs only
  `GITHUB_OAUTH_CLIENT_ID`/`SECRET`; the GitHub App private key is required for
  webhook processing and the install-registration worker.
- **Local database.** Local development regenerates the client from
  `prisma/schema.sqlite.prisma`, which hardcodes `file:./dev.db`; `DATABASE_URL`
  is ignored locally. Run `npm run db:sqlite:schema && npm run db:sqlite:push`.
- **Production database.** Regenerate the Prisma client from the canonical
  Postgres schema (`npm run db:generate`). Provision production Postgres with
  the tracked initial migration BEFORE the first deploy:

  ```bash
  npm run db:deploy   # prisma migrate deploy --schema prisma/schema.prisma
  ```

  This repository ships `prisma/migrations/0000_init` (the full schema), so
  `migrate deploy` creates every table on a fresh Postgres. If you ever prefer
  `db push` instead, `prisma db push --schema prisma/schema.prisma` also works.
  Without this step the OAuth callback (`/?oauth_error=1&reason=server_error`),
  dashboard, and webhook routes all fail on their first Prisma query.
- **Multiple web instances.** The rate limiter is in-memory; front Baton with a
  shared limiter (or a single edge) when scaling out.
