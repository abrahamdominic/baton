# Changes

This document records the redesign of the Baton marketing surface. It is written
to the same typography contract the site now enforces, so it is checked by
`scripts/check-typography.mjs` alongside the rest of the repository.

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

## Out of scope

Webhook handling, the classifier in `src/lib/engine`, the Prisma schema, the
Supabase configuration, and the API routes were not changed. Dashboard behavior
and data logic are unchanged.
