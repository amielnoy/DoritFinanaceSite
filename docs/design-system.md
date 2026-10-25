# The design system

Three inks, four surfaces, and one rule that does most of the work.

Token values are defined in [`src/index.css`](../src/index.css); the tables below
were checked against that source on 2026-10-22. Contrast figures retain their
original measurement context. See the [documentation index](README.md) for
architecture, operations and test guidance.

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

## Blue, day and night

One blue for actions, white cards on a cool grey ground, and a dark variant
chosen by the visitor. The values live in `src/index.css`: `:root` for day and
`:root.dark` for night. Token names are unchanged from the earlier gold palette;
only the values moved.

The day/night switch is in the header, the phone menu and the admin top bar
(`primitives/ThemeSwitch.tsx`, `hooks/useTheme.ts`). The choice is stored in
`localStorage` as `theme`. With none stored, the system setting decides. The
inline script in `index.html` sets `class="dark"` before the first paint, so a
dark page never flashes white. That script is hashed in `vercel.json`'s CSP:
change one character and update the hash (`scripts/check-csp-hashes.mjs`).

## Inks

| Token | Day | Night | Use |
|---|---|---|---|
| `--foreground` | `222.2 47.4% 11.2%` · `#0f172a` | `214 32% 91%` | body copy, headings |
| `--muted-foreground` | `215 19% 40%` | `215 20% 65%` | captions, labels, meta |
| `--accent` / `--highlight-ink` / `--highlight-foreground` | `228 75% 50%` / `45%` | `228 90% 74%` | text in blue: links, eyebrows, figures |
| `--highlight-on-dark` | `226 100% 92%` | `226 100% 97%` | text and strokes on a blue band |
| `--muted-foreground-on-dark` | `226 60% 88%` | `226 50% 95%` | secondary text on a blue band |

Every ink measures at least 4.5:1 on each surface it is allowed on, in both
modes. Never fade text with an opacity modifier (the one rule above still
applies). Text on the WhatsApp green is `text-slate-900` in both modes: the
theme's ink turns light at night.

## Surfaces

| Token | Day | Night | |
|---|---|---|---|
| `--background` | `225 25% 96%` · `#f2f4f7` | `222 47% 7%` | the ground |
| `--card`, `--popover`, `--surface` | white | `222 40% 11%` | cards, menus, the admin sidebar |
| `--secondary`, `--muted` | `225 25% 96%` | `222 35% 15%` | quiet bands, pills, tiles |
| `--primary` | `228 75% 50%` · `#2046df` | `228 75% 48%` | the call to action, blue bands (footer), the visitor's chat bubble |
| `--border` / `--input` | `220 16% 90%` / `86%` | `220 30% 18%` / `24%` | hairline |

Radius is 12px (`--radius`). The favicon's tile is `--primary`'s hex
(`favicon.contract.test.ts`).

Raw hex stays banned outside `index.css` (eslint).

## Type

Heebo for everything, self-hosted like the other faces
(`scripts/self-host-fonts.mjs`), with the system sans as fallback. The two
Hebrew faces preloaded in `index.html` are Heebo 400 and 700.

**Labels are 14px (`text-sm`) with no letter-spacing and no `uppercase`** —
Hebrew has no capitals to track, and the old 11px tracked labels lost the
letters' distinguishing marks. Above a heading use `<Eyebrow>` (tabular index,
short rule, label). 13px is the floor, for the header tagline only.

Anything a visitor is asked to read and confirm — the consent notice above all —
is 15px with loose leading. See `AgentChat`'s gate.

## Components

- **Call to action**: always `ctaClass()` / `CtaLink` / `CtaButton`
  (`primitives/Cta.tsx`). A blue fill with white text; `muted` is the hairline
  outline, `size="lg"` for the hero, `onDark` for a blue band. Disabled is 45%
  opacity, 200ms colour-only transitions.
- **Inputs**: `inputClass()` / `Field` (`primitives/Field.tsx`) - 48px,
  transparent, hairline; focus border blue plus a 3px 20% halo.
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
