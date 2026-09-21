# Security

Baton is deliberately small on permissions and explicit about data. This document
is the security model; it should stay in sync with the code and is worth reading
before deploying.

## GitHub App permissions (least privilege)

| Permission | Access | Why |
| --- | --- | --- |
| Pull requests | Read & write | Read state; write status comments and nudges. |
| Issues | Read & write | Write state labels and comments in the PR thread. |
| Checks | Read only | Detect failing/pending CI. |
| Metadata | Read only | Repo visibility and identity (mandatory). |

Baton requests **no Contents access**, and therefore cannot read your source
code, diffs, or file contents. If a future feature needs a new permission, it
must be documented here and added to the GitHub App manifest deliberately.

## Webhook integrity

- `POST /api/webhooks` reads the **raw request body** and verifies
  `x-hub-signature-256 = HMAC-SHA256(secret, body)` in **constant time**.
- Requests without a valid signature receive `401` and are not parsed or stored.
- Delivery IDs are deduplicated via `@@unique([deliveryId, eventType])`, so
  GitHub retries and replay attacks cannot cause duplicate side effects.
- A generous IP rate limiter sits behind signature verification to blunt floods.
- Payloads are parsed with Zod schemas; anything that doesn't match is rejected
  and marked processed.

## Authentication & sessions

- Sign-in uses GitHub OAuth with a random, single-use CSRF `state` value whose
  hash is stored in an httpOnly cookie and verified (constant-time) on callback.
- Session tokens are 32 random bytes sent in an httpOnly, `SameSite=Lax`,
  `Secure` (in production) cookie. Only the SHA-256 hash is stored server-side.
- Sessions expire after 30 days and can be revoked; sign-out deletes the row.
- `next` redirect targets are validated to be internal paths only
  (open-redirect protection).

## Tenant isolation

- Dashboard reads are scoped to installations owned by, or matching the login
  of, the signed-in user.
- Repo-level mutations re-verify ownership server-side before writing.
- The webhook path carries no user credentials; it is authenticated solely by
  signature.

## Data we store (and don't)

**Stored:** PR numbers/titles/URLs, author and requested-reviewer logins, review
and check summaries, labels, timestamps, per-state stall durations, nudge bucket
counts, and a ledger of Baton's own actions.

**Not stored:** source code, diffs, file contents, comments' text, or GitHub
access tokens (installation tokens are held in memory only until near expiry).

**Retention:** uninstalling deletes stored PR snapshots and action history for
that installation immediately. Webhook payloads and job logs are retained for 30
days for debugging.

## Secrets handling

- The App private key is read from base64 env, a file path, or an env value, 
  never from the database or disk under version control.
- The structured logger redacts fields whose keys look sensitive (`token`,
  `secret`, `password`, `cookie`, `authorization`, `private`, …).
- `.env` is git-ignored; `.env.example` contains names only.

## Threat model (selected)

| Threat | Mitigation |
| --- | --- |
| Forged webhook | Constant-time HMAC verification; unsigned requests rejected. |
| Webhook replay | Unique `(deliveryId, eventType)`; processing is idempotent. |
| CSRF on OAuth | Single-use hashed `state` cookie, verified on callback. |
| Session theft | httpOnly + Secure cookies; server-side hashed tokens; revocable. |
| Cross-tenant read | Ownership-scoped queries and mutation re-checks. |
| Secret leakage in logs | Key-based redaction in the logger. |
| Runaway nudges | One nudge per state by default; thresholds configurable; hard cap. |
| Abuse / flood | Per-IP rate limiting; signature check first. |
| Prompt-injection / AI | No AI in the critical path; classification is deterministic. |

## Reporting a vulnerability

Email `security@baton.dev` with a description and reproduction. We aim to
acknowledge within 24 hours. Please do not open public issues for security bugs.
