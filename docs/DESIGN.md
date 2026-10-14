# Design brief

One page. If a decision is not answered here, it is answered by the product, not
by taste. The site, its metadata, and this file follow the typography contract in
`CHANGES.md`, enforced by `scripts/check-typography.mjs`.

## Audience

Engineering leads and staff engineers at teams of roughly 10 to 150. They ship
every day, they are skeptical of dashboards, and they have already been sold
"developer productivity" by a template. They trust an artifact they can read more
than a claim they are told. A second audience is the maintainer evaluating an
install: they scan for permissions, data handling, and whether this thing writes
to their repositories.

## Tone

Calm, precise, plain. We describe what the product does and show it working. We
do not shout, we do not flatter, and we do not use a metaphor where a fact will
do. The headline stays unchanged: "Know whose turn it is on every pull request."

## Three adjectives

- **Deterministic.** The product is a state machine. Nothing on the page floats,
  glows, or implies intelligence it does not have.
- **Legible.** The artifact is the hero. Everything on the page is meant to be
  read, not skimmed past.
- **Reserved.** Emphasis is a scarce resource. When one thing is loud, the rest
  is quiet.

## What Baton is not

- Not a gradient. There is no purple to blue, no glow, no glassy blur behind
  copy.
- Not an icon grid. No decorative icon tiles, no three-up feature cards with a
  glyph per idea.
- Not a wall of pills. A pill means a real state or a real tag, nothing else.
- Not monospace everywhere. Monospace is code, state identifiers, and
  identifiers. It is not a costume for headings or eyebrows.
- Not a hype deck. No unsourced statistic, no superlative, no promise the
  repository cannot keep.

## Motif

The baton. Two marks carry it, defined once in `globals.css` as
`.baton-marker-turn` and `.baton-marker-wait`: a filled mark for "your turn" and
a hollow mark for "waiting". They mark whose move it is in the how-it-works
steps and wherever a handoff is shown. The motif is used as structure, never as
decoration.

## Color

Two accents, defined in OKLCH in `globals.css`.

- `brand`: the primary accent, "your turn".
- `waiting`: the second accent, "waiting on others".

The semantic colors `signal`, `warn`, and `danger` are reserved for engine state
and appear only inside the simulator and the state explorer. Every semantic color
is paired with a text label, so color is never the only signal. Light and dark
themes share one token set.

## Type

IBM Plex, loaded through `next/font/google`.

- IBM Plex Serif for display. It is a technical serif, which keeps the brand from
  reading as a default SaaS sans.
- IBM Plex Sans for body and UI.
- IBM Plex Mono for code, state identifiers, and identifiers only.

Headings and eyebrows are sentence case, except proper nouns and state
identifiers. Metrics use tabular figures in the text face, not a monospace face.

## Grid and space

A twelve column grid with a consistent gutter, capped by `max-w-measure` for
prose. Space comes from the shared scale only. There are no magic values in
components.

## Radii

Two, no more.

- `control`: inputs and small surfaces.
- `panel`: cards and sections.

## Motion

Minimal and functional. Color and border transitions on hover and focus, and the
baton marker moving along a hairline in the hero. Reduced motion is honored. No
parallax, no scroll-jacking, no decorative animation.
