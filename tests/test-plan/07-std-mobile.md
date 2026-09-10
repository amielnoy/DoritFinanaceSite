# STD-07 — Mobile Web (iOS & Android)

**Suite:** `ui` (mobile block) · **Runners:** `npm run test:e2e:ios`, `npm run test:e2e:android`
**Location:** `e2e/ui/mobile.spec.ts` · **Cases:** 10 × 3 platforms

---

## 1. Scope and a deliberate clarification

This repository contains **no native iOS or Android application** — it is a Vite
React SPA. "iOS" and "Android" here mean the **mobile web** experience, driven
through Playwright's device descriptors on the engine each platform actually
ships:

| Project | Engine | Device descriptor | Viewport | DPR | Touch |
|---|---|---|---|---|---|
| `ios-safari` | WebKit | iPhone 14 | 390 × 664 | 3 | yes |
| `android-chrome` | Chromium | Pixel 7 | 412 × 839 | 2.625 | yes |
| `android-galaxy` | Chromium | Galaxy S24 | 360 × 780 | 3 | yes |

WebKit is the engine behind Safari on iOS (and the only engine iOS permits), so
a WebKit run is a faithful check of iOS rendering and JS behaviour. It is **not**
a substitute for a real-device pass on installability, push, or Safari UI chrome
(address-bar resize, safe-area insets) — those need a device lab.

Playwright ships no Galaxy S25 descriptor; the S24 is its newest Samsung
flagship and the two share a display geometry (6.2", 1080×2340 → 360×780 CSS px
at dpr 3), so `android-galaxy` covers the S25 class without inventing metrics.
It earns its place on width rather than engine — it runs the same Chromium as
the Pixel, but 52px narrower, and narrow viewports are where RTL layouts break
first.

The block is selected by Playwright's `isMobile` fixture, so it runs on exactly
the three mobile projects and is skipped on the two desktop ones.

## 2. Test cases

| ID | Title | Steps | Expected result |
|---|---|---|---|
| E2E-MOB-001 | "renders the sticky call/consult bar instead of the desktop dock" | Load `/` | Sticky bar shows `tel:+972508311776` and `#consultation`; desktop WhatsApp dock hidden |
| E2E-MOB-002 | "the sticky bar stays pinned while scrolling" | Scroll to `#testimonials` | Call link still in viewport |
| E2E-MOB-003 | "opens and closes the burger menu and navigates from it" | Tap burger → tap "בלוג" | Drawer opens with a close button; navigation lands on `/blog` |
| E2E-MOB-004 | "the burger menu closes on Escape and on backdrop tap" | Tap burger, press Escape | Close button gone |
| E2E-MOB-005 | "no page scrolls horizontally on a phone viewport" | Load `/`, `/blog`, `/claims`, `/privacy`, `/accessibility` | `scrollWidth − clientWidth ≤ 1px` on every page |
| E2E-MOB-006 | "primary tap targets meet the 44px minimum" | Load `/` | Sticky call, sticky consult and the burger each ≥44px on the long edge and ≥36px on the short edge (WCAG 2.5.5 / iOS HIG) |
| E2E-MOB-007 | "the phone keyboard gets the right input types" | Scroll to `#quick-contact` | Phone field `type=tel`, email field `type=email` |
| E2E-MOB-008 | "a visitor can submit the quick contact form by touch" | Tap and fill, tap submit | Confirmation shown; `Lead.create` with `source: quick` |
| E2E-MOB-009 | "the calculator is usable on a narrow screen" | Scroll to `#fee-calculator`, set deposit | Field visible and editable; no `NaN` |
| E2E-MOB-010 | "the viewport meta allows pinch-zoom" | Load `/` | `width=device-width` present; no `user-scalable=no` or `maximum-scale=1` |

## 3. Defect found by this suite

`E2E-MOB-006` failed on first run: the header's burger button was 38 × 38 px
(`p-2` around a 22 px icon), under the 44 px minimum. `FloatingHeader.tsx` now
uses `p-3` (46 px). See [10-known-issues](10-known-issues.md).

## 4. Not covered

Real-device gestures (pinch, long-press), iOS safe-area insets, address-bar
resize behaviour, PWA installability, push notifications, and native app
stores — none of which apply to this codebase today.

## 5. Pass criteria

All 10 cases pass on both `ios-safari` and `android-chrome`. The mobile
accessibility case (`A11Y-AXE-007`) in [STD-08](08-std-accessibility.md) also
runs only on these two projects.
