# Changes

This document records the redesign of the Baton marketing surface. It is written
to the same typography contract the site now enforces, so it is checked by
`scripts/check-typography.mjs` alongside the rest of the repository.

## Diagnosis

The previous marketing surface read as a generic generated template. Twelve
specific tells gave it away. Each is listed here with the decision that removed
it. The rest of this document records the work.

1. Everything was a pill. Owner names, trust items, licenses, and section
   counts all sat in `rounded-full` chips. Decision: a pill is reserved for a
   real state or a real tag. Metadata is plain text with a hairline or a small
   marker.
2. Every section carried a monospace uppercase eyebrow label. Decision: eyebrows
   use the text face at a small size and sentence case; monospace is reserved
   for code, state identifiers, and identifiers.
3. The how-it-works section was numbered `01`, `02`, `03` with a tag line above
   each title. Decision: the steps carry the baton marker instead, an alternating
   turn and wait mark that encodes whose move it is.
4. The hero was a centered gradient glow behind an icon tile and a stock
   headline. Decision: the hero leads with the product's real artifact, the
   pinned status comment, rendered as HTML. The headline is unchanged.
5. Copy made claims the repository could not support. Decision: every figure has
   a source or an explicit note that it is a directional estimate, and the copy
   was reconciled with `README.md` and `SECURITY.md`.
6. There was an icon for everything. Decision: an icon appears only where it
   disambiguates a control or a state; there are no decorative icon tiles.
7. Em dashes and unicode arrows did the work of punctuation. Decision: both are
   removed everywhere, prose is rewritten, and a single hand drawn SVG arrow is
   the only arrow in the system.
8. Middle dots and bullet glyphs separated metadata. Decision: separators are
   spaces, commas, or a new line, never a glyph.
9. The accent was a purple to blue gradient and every surface was heavily
   rounded. Decision: one OKLCH brand accent for "your turn", a second for
   "waiting", flat fills, and borders carry emphasis instead of glow.
10. Radii and spacing were inconsistent. Decision: two radii, `control` for
    inputs and small surfaces and `panel` for cards and sections.
11. The comparison shouted, with crossed out checkmarks against ticked boxes.
    Decision: the comparison is a plain table with a named column per approach
    and a row about what each one stores.
12. The page contradicted the documentation. Decision: the security section, the
    security page, and the locale files now repeat the model in `SECURITY.md`,
    and the calculator math was corrected. See "Copy and accuracy fixes".

## Typography contract

The site, its metadata, its alt text, its aria labels, its locale files, and its
rendered markdown all follow one rule set. There are no em dashes, no en dashes,
no dash or bullet separators, no middle dots, no decorative glyphs, and no
unicode arrows. A normal hyphen inside a compound word is fine. Open forms are
preferred, so we write "open source" rather than a hyphenated variant.

A single purposeful arrow exists in the whole system. It is a hand drawn inline
SVG in `src/components/marketing/arrow.tsx`, used at most once inside a button or
a link, only where it means "go forward". It is never a unicode arrow and never
an icon library import. The simulator header now reads "from
feature/idempotent-webhooks into main" in words, and the deterministic rule that
fires is shown as a structured block with a conditions list, a resolved state,
and a nudge policy, rather than a sentence stuffed with arrows.

`scripts/check-typography.mjs` enforces this. It scans `src`, `locales`,
`public`, `docs`, and the root markdown files, strips fenced code blocks and
leading frontmatter first, and skips markdown table delimiter rows. The hyphen
run rule applies only to comment lines and markdown prose, so a PEM marker such
as `BEGIN` with its dashes is never flagged. It is wired into `npm run lint`, and
`npm run check:typography` runs it alone.

## Home page

The home page was rebuilt around the product's real artifact, the pinned status
comment, instead of icon and headline tiles.

- The hero shows a rendered status card as proof, not a screenshot.
- The live simulator renders the same status card component, with a structured
  rule block underneath that lists the conditions, the resolved state identifier,
  and the nudge policy.
- The proof strip prints each figure with a source or an explicit note that it is
  a directional industry estimate.
- The state explorer covers all eight canonical states, including the two silent
  states, and explains that a silent state carries no label and no nudge.
- The comparison table gained a row about what each approach stores.
- The security section is a permissions matrix with four columns: permission,
  access level, why Baton needs it, and what is stored.

## Copy and accuracy fixes

- The calculator math was wrong. It claimed that 15 developers, 25 pull requests
  per week, and a 72 hour wait eliminated 6,912 hours every month. The model is
  now transparent and conservative: monthly pull requests times hours saved per
  pull request, with hours saved per pull request capped at 48. The formula, its
  substituted numbers, and a directional range are shown next to the result.
- The security copy contradicted `README.md` and `SECURITY.md`. It claimed Baton
  never requests Contents. The truth is that Contents is read only, and is used to
  read the file tree, the package manifest, and CODEOWNERS to describe how a
  repository is built. Nothing is retained. Every security statement on the home
  page, the security page, and in the locale files now says this consistently.
- Unsourced statistics gained a visible source or a directional framing.
- Headings use sentence case everywhere except proper nouns and state
  identifiers.

## Design system

- All design tokens live once in `tailwind.config.ts` and the CSS variables in
  `src/app/globals.css`. There are no magic values in components.
- Typography is IBM Plex, loaded through `next/font/google`: IBM Plex Serif for
  display, IBM Plex Sans for body, and IBM Plex Mono for code and data. Subsets
  are latin and the display strategy is swap.
- The accent system has two accents: `brand` for "your turn" and `waiting` for
  "waiting on others". The semantic state colors `signal`, `warn`, and `danger`
  are used only inside the simulator and the state explorer, and every one is
  paired with a text label so color is never the only signal.
- Shared primitives live under `src/components/marketing`: `Section`,
  `SectionHeader`, `Button`, `LinkWithArrow`, `StatusCard`, `StateBadge`, `Tile`,
  `Table`, and `Metric`.

## Theme

The default theme preference changed from dark to system. The pre paint script in
`src/lib/theme.ts` still resolves the preference before first paint, so a new
visitor now follows their operating system until they choose a concrete theme.

## Accessibility

Landmarks are present, each page has one `h1`, heading order is sane, focus rings
are visible, a skip link targets `#main`, reduced motion is honored, and the
simulator is a real `tablist` and `tabpanel` with `aria-live`. The mobile menu is
a dialog that traps focus, closes on Escape, and restores focus to its trigger.

## Security hardening

The visual pass also closed a set of header and supply chain gaps.

- `next.config.ts` now sets `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Resource-Policy: same-origin`, extends `Permissions-Policy` with
  `payment=()`, and turns production browser source maps off. `X-Frame-Options`
  stays as a belt for clients that predate `frame-ancestors`, which the CSP
  already sets.
- `public/.well-known/security.txt` publishes the disclosure contact, a policy
  URL, an expiry, and the canonical URL. The typography scanner now reaches the
  `.well-known` directory, so the file is checked like the rest of the site.
- `src/security-headers.test.ts` imports `next.config.ts` and asserts every
  header, `poweredByHeader: false`, the source map flag, `payment=()`, and that
  private routes carry `X-Robots-Tag: noindex, nofollow`.
- `docs/SECURITY-REVIEW.md` is a severity rated review with a status and owner
  per finding, including the disposition of the `npm audit` results.

## Tooling and CI

- `.github/workflows/ci.yml` runs install, typecheck, lint, unit tests, and the
  build on every push and pull request.
- `.github/workflows/codeql.yml` runs CodeQL analysis for JavaScript and
  TypeScript on a schedule and on pull requests.
- `.github/workflows/secret-scan.yml` runs a secret scan on every push.
- `.github/dependabot.yml` keeps npm dependencies and the workflow actions
  current on a weekly cadence.

## Out of scope

Webhook handling, the classifier in `src/lib/engine`, the Prisma schema, the
Supabase configuration, and the API routes were not changed. Dashboard behavior
and data logic are unchanged. The visual system was extended to the dashboard
shell and the shared dashboard surfaces as styling only; no query, mutation, or
route was touched.
