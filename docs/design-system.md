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

## Inks

| Token | Value | Worst case | Use |
|---|---|---|---|
| `--foreground` | `240 3% 10%` · `#19191a` | **14.14** | body copy, headings |
| `--muted-foreground` | `30 8% 32%` · `#58524b` | **6.21** | captions, labels, meta — everything secondary |
| `--accent` | `26 14% 39%` · `#716256` | **4.72** | eyebrows and small accents only |
| `--highlight-ink` | `27 38% 30%` · `#6a4a2f` | **6.42** | figures and type on highlight surfaces |
| `--muted-foreground-on-dark` | `36 20% 78%` · `#d2c9bc` | **10.73** on `#19191a` | secondary text on the obsidian band and footer |

`--muted-foreground` was `30 10% 40%`. It measured **4.52** against the darkest
surface it sits on — a margin of 0.02 over the floor, which is why every faded
variant of it failed and why it could not safely carry a hover state or sit on a
tinted card. At 32% it has room.

`--accent` at 4.72 is the tightest ink in the system. It passes, and it has
nothing spare: use it for short accents, never for a paragraph, and never on
anything but the standard surfaces.

**There is no ink for "a bit lighter than muted".** If a design seems to need
one, the answer is smaller or lighter weight, not fainter.

## Surfaces

| Token | Value | |
|---|---|---|
| `--card` | `#fcfaf8` | lightest |
| `--background` | `#faf8f4` | the page |
| `--secondary` | `#eae6e1` | panels |
| `--muted` | `#e8e3dc` | darkest light surface — **the one every ink is measured against** |
| `--primary` | `#19191a` | the obsidian band and footer; use `--primary-foreground` and `--muted-foreground-on-dark` |

On dark, `--primary-foreground` faded to `/50` still measures 5.03 and is
acceptable. Below `/50` it is not — `/40` measured **3.65**, which is where the
footer's copyright line was.

## Type

**11px is the floor.** The site previously carried 8px, 9px and 10px labels. At
those sizes Hebrew loses its distinguishing marks regardless of contrast, and
the audience skews older.

Anything a visitor is asked to read and confirm — the consent notice above all —
is 15px with loose leading. See `AgentChat`'s gate.

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
