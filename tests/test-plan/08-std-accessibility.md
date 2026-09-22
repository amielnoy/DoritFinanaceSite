# STD-08 — Accessibility Tests

**Suite:** `a11y` · **Runner:** `npm run test:e2e:a11y` (Playwright + `@axe-core/playwright`)
**Location:** `e2e/a11y/axe.spec.ts` · **Cases:** 21 per platform · **Standard:** WCAG 2.1 Level AA

---

## 1. Purpose

The site publishes an accessibility statement at `/accessibility`, so its
accessibility is a stated commitment, not a nice-to-have. This suite checks the
commitment automatically on every run, across desktop and both mobile
platforms, and in Hebrew RTL — where labelling and direction bugs are easy to
introduce and hard to spot.

Automated scanning catches roughly a third to a half of real WCAG issues. It
does not replace a screen-reader pass (VoiceOver/NVDA) or a keyboard-only
walkthrough by a person.

## 2. Configuration

| | |
|---|---|
| Engine | axe-core via `@axe-core/playwright` |
| Rule tags | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` |
| Failure threshold | `serious` and `critical` impact |
| Excluded rule | `color-contrast` — reported on every run, enforced with `E2E_ENFORCE_CONTRAST=1` (see §5) |

## 3. Test cases — axe scans

| ID | Title | Target | Expected result |
|---|---|---|---|
| A11Y-AXE-001 | "home has no serious or critical violations" | `/` | Zero |
| A11Y-AXE-002 | "blog list …" | `/blog` | Zero |
| A11Y-AXE-003 | "blog post …" | `/blog/post-1` | Zero |
| A11Y-AXE-004 | "claims …" | `/claims` | Zero |
| A11Y-AXE-005 | "privacy policy …" | `/privacy` | Zero |
| A11Y-AXE-006 | "accessibility statement …" | `/accessibility` | Zero |
| A11Y-AXE-009 | "tools …" | `/tools` | Zero |
| A11Y-AXE-007 | "the open mobile menu is accessible" | drawer open, mobile projects only | Zero |
| A11Y-AXE-008 | "the contact forms are accessible in isolation" | `#quick-contact`, `#detailed-contact`, `#fee-calculator`, `#consultation` | Zero per section |
| A11Y-CON-001..007 | "`<page>` colour contrast (reported; enforced with `E2E_ENFORCE_CONTRAST=1`)" | all seven pages | Always passes; records the failing element count and selectors as a test annotation |

## 4. Test cases — structural sanity

| ID | Title | Expected result |
|---|---|---|
| A11Y-STR-001 | "the document declares Hebrew and RTL" | `lang="he"`, `dir="rtl"` |
| A11Y-STR-002 | "every form control has an accessible name" | Every visible `input`/`select`/`textarea` has a `<label for>`, a wrapping label, `aria-label` or `aria-labelledby` |
| A11Y-STR-003 | "every icon-only control has an accessible name" | Every rendered link/button with no text has `aria-label` or `title` |
| A11Y-STR-004 | "every content image has alt text" | No `<img>` without `alt` (aria-hidden excepted) |
| A11Y-STR-005 | "keyboard focus reaches the primary CTA and stays visible" | 15 Tab presses always land on a real element and reach a link or button. *Skipped on WebKit* — Safari only tabs to links when the OS "Press Tab to highlight each item" preference is on |
| A11Y-STR-006 | "the accessibility statement is reachable from the footer" | Footer link points at `/accessibility` |
| A11Y-STR-007 | "respects prefers-reduced-motion without breaking the layout" | With `reducedMotion: reduce`, hero and `h1` still render |

## 5. Defects found by this suite

| Finding | Rule | Status |
|---|---|---|
| Star-rating `<div aria-label>` with no role (5 nodes on `/`) | `aria-prohibited-attr` | **Fixed** — `role="img"` added in `Stars.tsx` and `ReviewsWidget.tsx` |
| Horizontally scrollable proof carousel unreachable by keyboard | `scrollable-region-focusable` | **Fixed** — `tabIndex={0}`, `role="region"`, `aria-label` and a focus ring in `ProofCarousel.tsx` |
| Burger tap target 38 px | (WCAG 2.5.5, caught by `E2E-MOB-006`) | **Fixed** — `p-3` in `FloatingHeader.tsx` |
| Bronze used as type — `--highlight-muted` 2.07:1 on the case-study figures, `--highlight-strong` 2.73:1 on the calculator | `color-contrast` | **Fixed** (2026-09-22) — `--highlight-ink` at 7.5:1; measured 14 bronze nodes → 0 |
| Opacity-composited greys (`text-foreground/50`, `text-muted-foreground/60` …), 51 nodes, worst 1.6:1 | `color-contrast` | **Open** — palette decision, tracked in [10-known-issues](10-known-issues.md) |
| ~~Brand accent `#7D6B5D` ≈ 4.4:1~~ | — | **Not a defect** — the hex was a stale comment; `--accent: 26 14% 39%` renders `#716256` at 5.5:1 and passes |

## 6. Pass criteria

Zero `serious`/`critical` violations on every page and platform, with
`color-contrast` reported rather than enforced until the palette is settled.
