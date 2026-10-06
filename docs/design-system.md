# The design system

Three inks, four surfaces, and one rule that does most of the work.

Every ratio below was measured against the live tokens rather than estimated.
Where a number is given, it is the **worst case** across every surface the ink is
allowed to sit on — not its best case on the lightest one, which is how a
palette passes review and fails in use.

---

## The one rule

> **Never fade text with an opacity modifier. Use a named ink.**

`text-foreground/50`, `text-muted-foreground/35`, `opacity-80` on a paragraph —
each of these looks like a small decision about emphasis and is in fact a
colour nobody chose and nobody measured.

It is not a theoretical objection. Before this rule the site carried 95 faded
text utilities, and the audit found ink at **1.6:1** on a 9px label, muted text
faded to **35%**, and — in one card — `text-foreground/70` *inside* an
`opacity-80` container, a fade on top of a fade measuring 3.98:1 where neither
class looked wrong on its own.

Emphasis is a job for weight, size and spacing. Those do not have a contrast
ratio.

---

## Classical v2

Editorial: colour goes into strokes, not fills. One gold for lines, one gold
ink for text. Token names are unchanged from the parchment/bronze system; only
the values moved (`src/index.css`, `:root`).

## Inks

| Token | Value | Ratio (handoff) | Use |
|---|---|---|---|
| `--foreground` | `40 5% 12%` · `#201f1d` | body copy, headings |
| `--muted-foreground` | `0 2% 37%` · `#605d5d` | 6.0 on the ground | captions, labels, meta |
| `--accent` / `--highlight-ink` / `--highlight-foreground` | `37 76% 28%` · `#7d5411` | 6.9 | **any text in gold**, eyebrows, figures, label on an outlined CTA |
| `--highlight-on-dark` | `35 67% 64%` · `#e1ad66` | | gold text and strokes on the colophon band (`text-highlight-on-dark`) |
| `--muted-foreground-on-dark` | `0 3% 72%` · `#bab6b6` | | secondary text on the colophon band |

`--highlight` (`36 55% 46%` · `#b68235`) is **strokes only**: borders, rules,
icons, the focus ring. It is too light to carry text. `--highlight-strong`
(`#a06f24`) is the pressed stroke; `--highlight-muted` (`#facb8d`) is for
subtle borders and tints.

Never fade text with an opacity modifier (the one rule above still applies).

## Surfaces

| Token | Value | |
|---|---|---|
| `--background`, `--card` | `0 4% 95%` · `#f3f2f2` | the ground; cards are unfilled |
| `--secondary`, `--muted`, `--popover` | `0 3% 91%` · `#eae9e9` | quiet bands, plate mats |
| `--primary` | `20 6% 10%` · `#1c1a19` | the colophon (footer), user chat bubble |
| `--border` / `--input` | `40 4% 82%` / `40 4% 78%` | hairline |

Radius is 4px (`--radius`) on controls and cards, 0 on plates and bands.

Raw hex stays banned outside `index.css` (eslint). `.plate-dark` uses
`hsl(20 5% 17%)` for its border for that reason.

## Type

Headings: Cormorant Garamond (Latin) falling through to Frank Ruhl Libre
(Hebrew), weight **400**, `letter-spacing: -0.01em`; use `font-medium` (500)
for h3/h4-size titles. Body: Lora falling through to Noto Serif Hebrew,
18px / line-height 1.75. Cormorant and Lora have no Hebrew glyphs, so Hebrew
and Latin render in different faces by design.

**Labels are 14px (`text-sm`) with no letter-spacing and no `uppercase`** —
Hebrew has no capitals to track, and the old 11px tracked labels lost the
letters' distinguishing marks. Above a heading use `<Eyebrow>` (tabular index,
short gold rule, label). 13px is the floor, for the header tagline only.

Anything a visitor is asked to read and confirm — the consent notice above all —
is 15px with loose leading. See `AgentChat`'s gate.

## Components

- **Call to action**: always `ctaClass()` / `CtaLink` / `CtaButton`
  (`primitives/Cta.tsx`). An outline in gold, never a fill; `size="lg"` for the
  hero, `onDark` for the colophon. Hover is a 12% gold tint, pressed 22%,
  disabled 45% opacity, 200ms colour-only transitions.
- **Inputs**: `inputClass()` / `Field` (`primitives/Field.tsx`) - 48px,
  transparent, hairline; focus border gold plus a 3px 20% halo.
- **Plates**: `.plate` (6px `--secondary` mat, 1px outline, slight sepia on the
  image), `.plate-dark` on the colophon. Plates do not zoom (`.lens-hover` is
  gone), and the header is opaque (`.glass` no longer blurs).

## Motion

`prefers-reduced-motion` is honoured in two places, because one does not cover
the other:

- `MotionConfig reducedMotion="user"` in `App.jsx` — framer-motion components
- the media query in `index.css` — CSS transitions and keyframes

Note that framer-motion deliberately keeps **opacity** animations under reduced
motion: a fade is not a vestibular trigger the way a transform is. That is
correct behaviour, and it is why the contrast scan also waits for entrances to
settle before reading the page — a snapshot taken mid-fade reports ink that does
not exist by the time anybody sees it.

---

## How this is enforced

`e2e/a11y/axe.spec.ts` scans every public page for `color-contrast` at WCAG AA,
with reduced motion emulated and entrances settled.

**Enforced on the desktop projects. Reported on the mobile ones.** Not a double
standard about who deserves legible text — a statement about what the
measurement is currently worth. On mobile viewports the scan still returns a
continuum of intermediate shades (2.16, 2.28, 2.43, 2.52 …), which is the
signature of sampling an element part-way through an entrance rather than of a
palette with a few bad values. Enforcing on a reading that cannot be trusted
would train everyone to ignore it.

The palette itself is viewport-independent, so the desktop gate catches token
regressions wherever they are introduced. Closing the mobile gap means making
the mobile scan deterministic — worth doing, and a separate piece of work from
choosing colours.

Run it:

```bash
E2E_ENFORCE_CONTRAST=1 npx playwright test e2e/a11y --project=web-chromium
```
