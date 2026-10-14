# Security review

Scope: the Baton web application in this repository, with emphasis on the public
marketing surface, the authentication and OAuth callback routes, the GitHub
webhook path, the rate limiter, and the response headers. Reviewed at commit
`HEAD` of the working tree that also contains this file. This review is a
point-in-time record; it is not a substitute for a professional penetration
test.

Method: manual source review of `src/`, `next.config.ts`, and `src/middleware.ts`;
reading the dependency tree with `npm audit`; and confirming that the security
statements in `SECURITY.md`, `README.md`, and the locale files agree with the
code.

Severity is rated Critical, High, Medium, Low, or Informational. Status is one of
Fixed, Mitigated, Accepted, or Open. Owner is the role accountable for the next
step, not necessarily the reviewer.

## Findings

| ID | Severity | Finding | Status | Owner |
|  |  |  |  |  |
| F-01 | Low | The rate limiter is process local. `src/lib/rate-limit.ts` is a fixed window counter in a `Map`, so on a multi-instance serverless deployment each instance keeps its own count and the effective limit is a multiple of the configured one. | Open | maintainer |
| F-02 | Low | `style-src` allows `'unsafe-inline'`. Required because Next injects style attributes a nonce cannot cover. A style injection cannot read the session cookie or execute script, so this is Accepted rather than fixed. | Accepted | maintainer |
| F-03 | Medium | Transitive dependency advisories remain in the tree, including three critical and thirteen high. See the audit table below for the disposition. | Open | maintainer |
| F-04 | Low | Admin is bootstrapped from the `BATON_ADMIN_LOGINS` environment variable at sign-in. A mistaken or over-broad value grants admin. The value is server-side only and is not user controllable. | Accepted | maintainer |
| F-05 | Informational | The server renders `data-theme="dark"` and the pre-paint script corrects it to the stored preference. The browser chrome now carries media-query `theme-color` values so a light-OS first visit no longer flashes dark chrome. | Fixed | maintainer |

## Dependency advisories

`npm audit` reports 20 advisories: 4 moderate, 13 high, 3 critical. All are
transitive. None ships to the browser bundle or is reachable from a request path
with attacker-controlled input, which is why they are rated below Critical at the
application level even where the advisory itself is Critical.

| Severity | Package | Pulled in by | Fix path | Disposition |
|  |  |  |  |  |
| Critical | `next` | direct | `next@15.5.27` | Upgrade in the next dependency window. |
| Critical | `vitest`, `tinypool` | direct dev | `vitest@5.0.4` | Test-only. Upgrade with the next major. |
| High | `postcss`, `sharp`, `source-map-js` | `next` | `next@15.5.27` | Cleared by the `next` upgrade. |
| High | `@next/eslint-plugin-next`, `eslint-config-next` | direct dev | `eslint-config-next@14.2.35` | Dev only. Upgrade with the next major. |
| High | `braces`, `chokidar`, `fast-glob`, `micromatch`, `postcss-nested`, `postcss-selector-parser` | `tailwindcss` | `tailwindcss@4.3.3` | Build only. Upgrade with the next major. |
| High | `prisma`, `@prisma/config`, `deepmerge-ts` | direct | non-breaking | `npm audit fix` in the next window. |
| Moderate | `@tailwindcss/typography` | direct dev | `@tailwindcss/typography@0.5.4` | Build only. Upgrade with the next major. |
| Moderate | `@vitest/mocker` | direct dev | `vitest@5.0.4` | Test-only. Upgrade with the next major. |

The fixes that clear the critical advisories (`next` and `vitest`) are breaking
or outside the stated dependency range, so they were deliberately not applied in
this change. Dependabot (`.github/dependabot.yml`) tracks them. The next
dependency window should land `next@15.5.27` first, which clears the largest
group, and then move `vitest` to v5.

## Controls verified

These are not findings. They are the controls the review confirmed are present,
recorded so a later reader does not have to re-derive them.

- Content-Security-Policy with a per-request 128-bit nonce and
  `strict-dynamic`, set in `src/middleware.ts`. `frame-ancestors 'none'`,
  `object-src 'none'`, and `base-uri 'self'` are set. Prefetch responses are not
  exempted, which closes the usual policy-bypass shape.
- `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` both
  `same-origin`; `Permissions-Policy` denies camera, microphone, geolocation,
  and payment; `X-Frame-Options: DENY` agrees with `frame-ancestors`.
  Production browser source maps are off. Asserted by
  `src/security-headers.test.ts`.
- Webhook integrity: raw-body HMAC-SHA256 verified in constant time, unsigned
  requests rejected, and `(deliveryId, eventType)` is unique so replays are
  idempotent. `src/lib/webhooks/verify.ts`.
- OAuth uses PKCE S256, a single-use hashed `state`, and a separate single-use
  state for the GitHub App install flow. `src/lib/auth/oauth.ts`.
- Sessions are 32 random bytes in an httpOnly, `SameSite=Lax`, `Secure`
  cookie; only the SHA-256 hash is stored server side.
- Open-redirect targets are validated to internal paths only.
- Private routes carry `X-Robots-Tag: noindex, nofollow` and `robots.txt`
  disallows them.
- Admin server actions re-check `role === "admin"` and reject suspended users
  on every mutation.
- `public/.well-known/security.txt` publishes the disclosure contact.

## Reporting

Email `security@baton.dev`, or use the contact in
`public/.well-known/security.txt`. Do not open a public issue for a security
bug.
