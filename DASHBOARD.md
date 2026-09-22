# Baton Dashboard & Authentication

How the authenticated product surface is built, which pages exist, and how it
all connects to GitHub.

## The sign-in flow

```
Baton website  →  /auth/login  →  github.com/login/oauth/authorize
                                          │ user approves
                                          ▼
                  /auth/callback?code=…&state=…&iss=https://github.com/login/oauth
                                          │ validations + code exchange
                                          ▼
                  baton_session httpOnly cookie set → redirect → /dashboard
```

1. Any **Sign in** link points at `/auth/login?next=/dashboard`.
2. `/auth/login` (`src/app/auth/login/route.ts`) sets a one-time CSRF
   `baton_oauth_state` cookie (a SHA-256 hash of the state value) and redirects
   to GitHub's authorize endpoint.
3. GitHub redirects back to the callback with `code`, `state`, and `iss`.
4. `/auth/callback` (`src/app/auth/callback/route.ts`):
   - validates `iss` (OAuth mix-up protection),
   - re-derives the post-login destination from inside `state` and sanitizes it
     (open-redirect safe),
   - verifies the state cookie in constant time,
   - exchanges the code for a GitHub token (secret only in the POST body),
   - upserts the user, creates a server-side session, sets the `baton_session`
     cookie, and redirects to `/dashboard`.
5. Signed-out users hitting any `/dashboard/*` page are server-side redirected
   to `/auth/login?next=/dashboard` by the layout
   (`src/app/dashboard/layout.tsx`). No route renders private data without a
   valid session, and expired sessions are dropped on the next request.

Sessions are stored server-side (`Session` table, SHA-256 token hash); the raw
token lives only in an httpOnly, SameSite=Lax cookie (Secure in production).

## GitHub OAuth callback URLs (copy-paste)

Set exactly one of these as the **callback URL** on the GitHub app you use for
sign-in (GitHub Apps settings → "Callback URL", or classic OAuth App → "Authorization callback URL"):

**Production (required):**

```
https://baton-xi.vercel.app/auth/callback
```

**Local development (optional, if you also run locally):**

```
http://localhost:3000/auth/callback
```

You may register more than one callback URL (e.g. dev + prod). GitHub only
allows the exact path that is registered; the app always builds its
`redirect_uri` from the canonical `APP_URL` in production and from the local
host in development, so both match automatically.

### Do I need a GitHub App, or is OAuth enough?

**OAuth alone gives you the dashboard shell and GitHub identity** — sign in,
the sidebar, Settings, and everything that reads your GitHub account. You do
*not* need a GitHub App for that part.

The **GitHub App** is a separate thing. It is what provides the actual Baton
product data flowing into the dashboard:

| Capability | Needs GitHub App | Needs OAuth |
| --- | --- | --- |
| Sign in / session / your GitHub profile | ❌ | ✅ |
| Setting a session cookie & route protection | ❌ | ✅ |
| Activity Ledger (nudges, state changes) | ✅ (it performs them) | ❌ |
| Repositories & PR queue ("Your Move") | ✅ (it reads PR state) | ❌ |
| Nudge threshold configuration | ✅ (per repo) | ❌ |

So: if you only want the authenticated app experience to be reachable and show
your GitHub identity with honest empty states, OAuth is sufficient. If you want
the dashboard populated you also register the Baton GitHub App (or the same
app's OAuth credentials) and install it on repositories. The Settings page
shows live "configured / not configured" badges for both.

There are two accepted flavors for the OAuth client ID:

- A **dedicated OAuth App** (client ID starts with `Iv23…`);
- or the **GitHub App's own OAuth credentials** (client ID starts with `Ov23…`).

Both are supported. Keep the client ID and client secret in
`GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`. Never commit them; the
repository `.env` is gitignored.

## Pages

All authenticated pages live under `/dashboard` and inherit the layout guard +
`X-Robots-Tag: noindex, nofollow` (defense-in-depth on top of `robots.txt`).

| Route | Name | What it does | Data source |
| --- | --- | --- | --- |
| `/dashboard` | Overview | Greeting, live metric cards (repos, open PRs, stalled 24h+, waiting on reviewers), the "Your Move" queue (open PRs ordered by who must act and wait time), getting-started panel when nothing is installed, and a recent-activity preview. | `yourMove`, `myInstallations`, `recentActivity` |
| `/dashboard/repos` | Repositories | Every tracked repo: enable/pause tracking, per-repo nudge thresholds, manual "Re-scan now". | `myInstallations`, server actions |
| `/dashboard/repos/:owner/:repo` | Repo board | All open PRs of one repo grouped by Baton state, with stall durations. | `repoBoard` |
| `/dashboard/activity` | Activity ledger | Chronological, day-grouped feed of what Baton did on your repos: targeted nudges and PR state transitions. Sorted newest first. | `recentActivity` (reads the `Action` table) |
| `/dashboard/settings` | Settings (Account & App admin) | GitHub identity (avatar, login, name, email, GitHub ID), service status badges (OAuth / GitHub App configured), connected GitHub App installations with their repos, active sessions with per-session revoke and "sign out everywhere". | `myInstallations(allRepos)`, `userSessions`, server actions |

### Data readers

- `src/lib/queries/dashboard.ts` — all read-side queries, always scoped to the
  signed-in user (user-linked installations or the user's own GitHub login).
- `src/lib/auth/session.ts` — session cookie read/write, `currentUser()`.
- `src/app/dashboard/actions.ts` — server actions: enable/pause repos, update
  thresholds, re-scan, revoke sessions.

### Layout & navigation

- `src/app/dashboard/layout.tsx` — server component: session guard, noindex
  metadata, renders `<AppShell>`.
- `src/components/dashboard/app-shell.tsx` — client component: fixed **sidebar
  on desktop** (logo, Workspace: Overview / Repositories / Activity, Account:
  Settings, GitHub identity block, Sign out) and a **mobile sheet** navigation
  off a top bar (avatar + hamburger). Active link is derived from `usePathname`.
- `src/app/dashboard/loading.tsx` — skeleton while the first dashboard segment
  streams.

### OAuth failure handling

The old deployment sent users to a bare `/?oauth_error=1`. That happened when
the callback hit one of several distinct failures. The callback now categorizes
and redirects with `/?oauth_error=1&reason=…`, and the landing page renders a
specific, human-readable message per reason:

- `exchange_failed` — GitHub rejected the credentials (bad client ID/secret, or
  callback URL not registered).
- `state_mismatch` — stale/replayed CSRF state; retry.
- `iss_mismatch` — unexpected OAuth issuer (mix-up protection).
- `server_error` — an exception during sign-in (most commonly the service
  database not being provisioned yet; check `DATABASE_URL` and that
  `prisma db push` ran). Every failure is also logged with full context.

The same route also handles the GitHub App **installation** callback
(`?installation_id=…` → register + `/dashboard?installed=1`), unchanged.

### OAuth URL fixes (why production stopped breaking)

- `src/lib/auth/redirect.ts` gained `getOAuthBaseUrl()`: in production the OAuth
  `redirect_uri` is always the canonical `https://baton-xi.vercel.app/auth/callback`
  (never a preview/custom domain), so GitHub never rejects it with
  `redirect_uri_mismatch`. Login and the code exchange both use this value.
- Production code paths never fall back to `localhost` (existing guard kept).

## Anti-indexing

Private surfaces are blocked three ways:

1. `robots.txt` (`src/app/robots.ts`) disallows `/dashboard`, `/auth`,
   `/install`, `/api/`, `/_next/`.
2. `next.config.ts` adds `X-Robots-Tag: noindex, nofollow` on those path
   prefixes (crawlers that ignore robots.txt, plus un-encodable query-string
   OAuth URLs).
3. The dashboard layout sets `metadata.robots` to noindex for every child page.
   `sitemap.ts` only ever lists public marketing pages.

## Running locally

```bash
npm ci
npm run db:sqlite:schema && npm run db:sqlite:push   # SQLite dev DB
cp .env.example .env                                  # fill in OAuth + App vars
npm run dev                                           # http://localhost:3000
```

Sign in with GitHub → you land on `/dashboard`. Install the GitHub App on a
repo (`/install`) and PR data starts flowing into the queue, repos, and
activity pages.