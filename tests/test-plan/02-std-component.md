# STD-02 — Component Tests

**Suite:** `component` · **Runner:** `npm run test:component` (Vitest + React Testing Library)
**Location:** `tests/component/sanity.test.tsx` · **Cases:** 21 · **Environment:** jsdom

---

## 1. Purpose

Sanity-check every first-party component that carries behaviour: that it
renders, exposes the accessible names screen readers and the e2e suite depend
on, and calls the Base44 client with the payload the backend contract expects.

## 2. Test items

`Stars`, `MobileStickyBar`, `FloatingActions`, `PensionFeeCalculator`,
`QuickContact`, `FAQ`, `ShareButtons`, `ReviewsWidget` — all in
`src/components/dorit/`.

## 3. Approach

| Concern | Handling |
|---|---|
| Base44 SDK | `vi.mock("@/api/base44Client")` → `tests/component/base44-mock.ts`; assertions are on the recorded calls |
| `framer-motion` | Replaced with a pass-through proxy; jsdom has no layout engine for its animations |
| Router | Components using `<Link>` are wrapped in `MemoryRouter` |
| Queries | Role and label based (`getByRole`, `getByLabelText`) — the same accessibility surface the e2e suite asserts on |
| Cleanup | `tests/setup/testing-library.ts` runs `cleanup()` after each case |

## 4. Test cases

### 4.1 `<Stars />`

| ID | Title | Expected result |
|---|---|---|
| CMP-STR-001 | "exposes the rating as an image with an accessible name" | `role="img"` named `דירוג 4 מתוך 5` |
| CMP-STR-002 | "rounds a fractional rating" | `4.6` → `דירוג 5 מתוך 5` |
| CMP-STR-003 | "renders five stars regardless of the value" | Exactly 5 `<svg>` |
| CMP-STR-004 | "treats a missing value as zero rather than NaN" | Named `דירוג 0 מתוך 5` |

### 4.2 `<MobileStickyBar />` / `<FloatingActions />`

| ID | Title | Expected result |
|---|---|---|
| CMP-BAR-001 | "offers a dial link and a consultation anchor" | `tel:+972508311776` and `#consultation` |
| CMP-FLA-001 | "links to WhatsApp with a prefilled Hebrew message and a safe rel" | `wa.me/<number>`, `target=_blank`, `rel` contains `noopener`, message decodes to Hebrew |
| CMP-FLA-002 | "links to the phone number in E.164 form" | `href === tel:${CONTACT.phoneE164}` |

### 4.3 `<PensionFeeCalculator />`

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-PFC-001 | "renders the default scenario" | render | Deposit `2000`, years `25`, totals visible |
| CMP-PFC-002 | "recomputes the totals when an input changes" | clear + type `4000` | First result card changes |
| CMP-PFC-003 | "never shows NaN when every field is cleared" | clear all 5 inputs | Rendered text contains no `NaN` |
| CMP-PFC-004 | "labels every input for assistive tech" | render | Every `spinbutton` has an accessible name |

### 4.4 `<QuickContact />` — the primary lead form

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-QCF-001 | "disables submit until name and phone are present" | type name, then phone | Submit enabled only after both |
| CMP-QCF-002 | "emails the office and records a Lead with source=quick" | fill + submit | `SendEmail` called with a recipient and the phone in the body; `Lead.create` called with `{name, phone, email, source:"quick", status:"new"}` |
| CMP-QCF-003 | "confirms to the visitor and clears the form after a successful send" | submit, then "send another" | Confirmation shown; fields reset |
| CMP-QCF-004 | "keeps the visitor's input and offers a fallback when sending fails" | `SendEmail` rejects | Error message shown; typed name still present |
| CMP-QCF-005 | "does not submit twice on a double click" | double-click submit | `Lead.create` called exactly once |

### 4.5 `<FAQ />`, `<ShareButtons />`, `<ReviewsWidget />`

| ID | Title | Expected result |
|---|---|---|
| CMP-FAQ-001 | "renders questions as buttons and reveals the answer on click" | Content grows after clicking the first question |
| CMP-SHR-001 | "renders share targets that all use https and a safe rel" | Every `target=_blank` href is `https:` or `mailto:`; `rel` contains `noopener` |
| CMP-RVW-001 | "asks the backend for testimonials on mount" | `Testimonial.list("-created_date", 50)` |
| CMP-RVW-002 | "renders without crashing when the backend returns nothing" | No throw on an empty list |
| CMP-RVW-003 | "survives a backend error without throwing" | No throw when `list` rejects |

## 5. Pass criteria

All 21 cases pass. A `Lead.create` payload assertion failing here is a contract
break — cross-check [STD-03](03-std-contract.md) before changing the test.
