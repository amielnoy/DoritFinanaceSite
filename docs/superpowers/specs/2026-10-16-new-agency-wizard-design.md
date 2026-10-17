# "סוכנות חדשה" — the new-agency setup wizard

Status: draft for review, 2026-10-16. Builds on
`2026-10-10-multi-agent-platform-design.md` (Phase 4, "first outside agency")
and `2026-10-15-agency-roles-design.md` (Owner / Admin / User, owner-only
profile).

## Why

Everything that makes the site *Dorit's* is still spread across code:
`src/config/agencyProfile.ts` (contact, licence, GA4), the Hebrew copy in
`src/i18n/locales/he/home.json` (bio, family, career, stats, success cases),
`public/images/dorit-office-portrait-*` (the portrait), `ReviewsWidget.tsx`
(a TODO Google search link), `compliance.ts` (feminine-grammar disclosures
naming her), the chat agents' greetings in `src/config/agents.ts`, and
`index.html` / `llms.txt` / `poa.html` (about 20 mentions). `agency_profiles`
holds only the nine contact-and-licence fields, and there is no `agents` table
yet.

A second agency cannot be opened without a developer editing all of that. The
wizard collects every one of these values once, stores them in the database,
and the site reads them from there. Running Dorit's own data through the same
model is the proof that it works (Rollout step 2).

## What the wizard does, in one line

The platform operator opens a **draft** agency and invites its owner; the owner
(or the operator on their behalf) fills seven short steps, with autosave and a
live preview; the operator checks the licence and the processing agreement and
**activates** it.

## Who does what

| Step | Platform operator | Owner of the new agency |
|---|---|---|
| 0 · Open the agency (name, owner's email, DPA date) | ✓ only | — |
| 1–6 · Details, photo, licence, contact, about, testimonials, booking | ✓ (on behalf) | ✓ |
| Domain, GA4, mail sender | ✓ only | sees, read-only |
| 7 · Review → "send for approval" | ✓ | ✓ |
| Verify licence on the regulator's register, activate | ✓ only | — |

This follows the roles design: only the Owner edits the agency profile, the
operator creates and activates agencies.

## Data model

One new migration (never an edit to an applied one).

### `agencies.status` gains `draft` and `pending_review`

```
draft → pending_review → active ⇄ suspended
          ↑      ↓ (operator returns with notes)
          └──────┘
```

`agency_role()` today returns null unless `status = 'active'`, so an owner of
a draft agency would have no access at all. Add a second helper rather than
loosening the first:

```sql
-- Membership role in an agency that is still being set up.
-- Used ONLY by the onboarding policies below; lead data keeps agency_role().
create function public.onboarding_role(p_agency_id uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select m.role from public.memberships m
    join public.agencies a on a.id = m.agency_id
   where m.agency_id = p_agency_id and m.user_id = auth.uid()
     and a.status in ('draft', 'pending_review', 'active')
$$;
```

A draft agency has no leads (no domain resolves to it), so there is nothing
else to open up.

### `agents` — the licensee (new table, from the platform design)

Personal facts belong to the person, not the agency: an agency can later have
several licensees. The wizard creates the first `agents` row for the owner.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `agency_id` | uuid not null → agencies | |
| `user_id` | uuid null → auth.users | the owner's account |
| `full_name` | text not null | "דורית גוב ארי" |
| `grammatical_gender` | text check in (`f`,`m`) | **drives every Hebrew sentence that names them** — "בעלת/בעל רישיון", "מתכננת/מתכנן" |
| `professional_title` | text not null | "מתכננת פיננסית וסוכנת ביטוח" — chosen from a list, editable |
| `photo_path` | text null | storage path, see Photo below. Null = initials monogram |
| `photo_alt` | text null | defaults to "{name} — דיוקן מקצועי" |
| `licence_number` | text not null | |
| `licence_types` | text[] not null | `pension_agent`, `life_agent`, `general_agent`, `pension_advisor`, `pension_marketer` |
| `licence_regulator` | text not null default 'רשות שוק ההון, ביטוח וחיסכון' | |
| `has_institutional_affiliation` | boolean not null | decides which disclosure is shown (שיווק vs ייעוץ) |
| `affiliations` | text[] | names of the institutional bodies, if any |
| `licence_verified_at`, `licence_verified_by` | timestamptz, uuid | set by the operator only (trigger) |
| `bio` | jsonb | see "About" below |
| `stats` | jsonb | up to three `{num, label}` |
| `booking_url` | text null | first step for calendars (platform-design open question: booking link before OAuth) |
| `meeting_minutes` | int default 15 | |
| `review_links` | jsonb | `{google?: url, midrag?: url}` — replaces the TODO in `ReviewsWidget.tsx` |

RLS: select for `onboarding_role(agency_id) is not null` and public read of the
display columns for an active agency (through a view, `public_agent_cards`, so
licence-verification columns are never exposed); update for owner or operator;
`licence_verified_*` changed by operator only (trigger).

### `agency_profiles` gains

| Column | Notes |
|---|---|
| `notify_emails text[]` | where lead mail goes (replaces `NOTIFY_EMAILS` copies) |
| `domain text unique` | operator only |
| `mail_from text` | verified sender subdomain, operator only |
| `consent_version text` | per agency, because the notice names the licensee |
| `service_area text` | optional, "מרכז והשרון" |
| `onboarding jsonb` | wizard state: last step, per-step `complete` flags, operator's return notes |

`phone_e164`, `phone_display` and `whatsapp` stay as columns, but the wizard
asks for **one** phone number and derives all three (`src/lib/phone.ts`
already normalises). Today's profile screen asks for the same number three
times.

### `testimonials` gains

`agent_id`, `source_url` (link to the original review), `consent_confirmed_by`
+ `consent_confirmed_at` (who confirmed the reviewer agreed to publication),
`sort_order`, and `source` widened to `('google','midrag','direct')`.

### `success_cases` (new, optional step)

`id, agency_id, agent_id, title, body, metric, sort_order, published`. Today
these are `proof.c1…c7` in `home.json`. Anonymised by rule: the step's form
warns against names, ages+cities together, or exact sums.

## Photo upload

Optional. Without it, the hero and the about block show a monogram on the
brand background — designed as a first-class state, not a broken image.

- Bucket `agent-photos`, **public read** (it is shown on the public site),
  path `<agency_id>/<agent_id>/portrait-<w>.<ext>`.
- Write policy: `onboarding_role(agency_id) = 'owner' or is_admin()`, path
  prefix must match the agency id.
- Client: accept JPG / PNG / WebP / HEIC up to 10 MB; crop to 4:5 with a
  face-centred frame; re-encode in the browser to WebP at 480 / 768 / 1080
  (the same widths as Dorit's portrait today, so `Hero.tsx`'s `srcset` works
  unchanged). Re-encoding also strips EXIF, including GPS.
- Replace = upload new versions, then delete the old ones; "remove photo"
  returns to the monogram.

## The steps

Each step saves on "המשך" and on blur (autosave); leaving and coming back
returns to the last step. A side panel shows a live preview of the hero and
about block with what has been typed.

### 0 · פתיחת סוכנות (operator)
Agency name · one licensee or several · owner's email (sends the existing
`invite-user` mail with role `owner`) · processing-agreement date (may be empty
now, required to activate).

### 1 · בעל/ת הרישיון
Full name · לשון פנייה (נקבה / זכר) · professional title (list + free text) ·
**portrait (optional)** with crop.

### 2 · רישוי וגילוי נאות
Licence number (format check only — `L-` followed by digits is accepted
loosely; real verification is the operator's, on the regulator's register) ·
licence types (multi-select) · regulator · "יש לך זיקה לגופים מוסדיים?" +
which ones · the licence-entity line, pre-filled from name + title.
**Live preview of the exact disclosure sentences** the visitor will see
(consent gate, pension-marketing disclosure), built from these fields and the
gender. This is the text the compliance reviewer approves.

### 3 · פרטי קשר
One mobile number (→ e164, display, WhatsApp) · email · opening WhatsApp
message (pre-filled template with the first name) · service area (optional) ·
notification addresses (default: the email above).

### 4 · אודות
Structured, so every agency's page reads well without a copywriter:

| Field | Shown as | Required |
|---|---|---|
| Headline sentence | hero lead | ✓ (template offered) |
| Professional background | about › career | ✓ |
| Education and certificates | about › credentials | — |
| What sets you apart | about › unique | — |
| A personal line (family, hobby) | about › family | — , with a note that it is public |
| Up to 3 numbers (years, clients, …) | about › stats | — |
| Signature | "— דורית" | defaults to first name |

Counters show the recommended length. Hebrew only in this version (see Open
questions for en/fr).

### 5 · המלצות ותיקי הצלחה
- Links to the Google Business and Midrag profiles.
- Add testimonials: reviewer name (or initials), context ("לקוחה מאז 2019"),
  quote, rating, source + link to the original, optional photo, and a required
  checkbox: "ההמלצה אמיתית, והממליץ/ה הסכים/ה לפרסומה". Drag to order.
  Zero is allowed — the section simply hides.
- Success cases (optional), with the anonymisation warning.

### 6 · פגישות
Booking link (Google appointment schedule, Calendly, Outlook Bookings) ·
meeting length. OAuth calendar connection stays a later project.

### 7 · סקירה ושליחה
A checklist of every required field with a link back to its step, a full-page
preview of the home page as the agency (rendered from the draft), and
"שליחה לאישור" → `pending_review`.

### Operator review (not part of the owner's wizard)
`/admin/agencies/:id/review`: everything above, plus domain, mail sender,
GA4, and three gates that block "הפעלה":
1. Licence checked on the regulator's register → sets `licence_verified_*`.
2. Processing-agreement date present.
3. Disclosures approved (who approves is an open question in the platform
   design).
"החזרה לתיקונים" with a note returns it to `draft` and mails the owner.

## Backend

| Piece | Kind | Gate |
|---|---|---|
| `create_agency(name, owner_email, dpa_date)` | RPC + `invite-user` | operator |
| step saves | direct writes under RLS (`agency_profiles`, `agents`, `testimonials`, `success_cases`) | owner or operator, via `onboarding_role` |
| photo upload | Storage policy | same |
| `submit_agency_for_review(agency_id)` | RPC; checks required fields server-side | owner or operator |
| `return_agency(agency_id, note)`, `activate_agency(agency_id)` | RPCs; activate re-checks the three gates | operator |

Every RPC: security definer, `set search_path = ''`, EXECUTE to
`authenticated` only, revoked from `public` and `anon` by name (AGENTS.md).

## Frontend

- Route `/admin/agencies/new` (operator, step 0) and
  `/admin/onboarding/:agencyId` (owner or operator, steps 1–7).
- After sign-in, an owner whose only agency is `draft` lands in the wizard.
- `src/config/onboarding.ts` declares the steps, fields and required flags
  as data (same Open/Closed approach as `agents.ts`); the checklist, the
  server-side `submit` check and a contract test all read it.
- **Read side** — the actual de-hardcoding. A `useAgencyContent()` hook
  (agency from the host name) feeds `Hero`, `About`, `Testimonials`,
  `ReviewsWidget`, `ProofCarousel`, `StartConversation`, the chat greetings,
  `compliance.ts` and SEO. Hebrew strings that name the licensee become
  templates with `{name}` and gendered variants, e.g.
  `"{entity} {f:בעלת|m:בעל} רישיון סוכן מ{regulator}"`.
- Prerender (`scripts/prerender.mjs`, `llms.txt`, `poa.html`, JSON-LD in
  `index.html`) reads the profile at build time per domain.
- The existing `/admin/agency` screen becomes "edit any step" of the same
  forms after activation — one set of forms, not two.

## Dorit as agency 1

Before any outside agency, migrate Dorit's own data into the new tables
(seed migration from today's constants and `home.json`, portrait copied into
`agent-photos`), switch the site to read from the database, and compare: the
prerendered home, about, privacy and POA pages must be byte-for-byte or
visually identical (Playwright screenshot diff). Same gate as Phase 0 —
"production smoke shows no change".

## Edge cases

- **Owner never signs in:** the operator can fill the wizard on their behalf;
  the invite can be resent.
- **Two people edit the same step:** last write wins per field; the step
  reloads if `updated_at` moved since it opened, and says so.
- **Licence number changes after activation:** clears
  `licence_verified_*`, bumps `consent_version`, and notifies the operator;
  the site keeps showing the old verified number until re-verified.
- **Gender or name changes after activation:** bumps `consent_version`
  (the notice the visitor consented under changed — same reasoning as
  `compliance.ts` v4).
- **Photo upload fails halfway:** nothing is pointed at until all three sizes
  exist; orphans are cleaned by a nightly job.
- **Testimonial without the consent checkbox:** cannot be saved.
- **Agency abandoned in draft:** listed for the operator with "last edited";
  no automatic deletion.

## Tests

- `supabase/tests/onboarding_check.sql`: owner of a draft agency can write
  its profile, agent row, photos, testimonials; cannot touch another agency;
  cannot set `licence_verified_*`, `domain`, `status`; a User/Admin of the
  draft agency cannot edit the profile; `submit` refuses missing fields;
  `activate` refuses without the three gates.
- Guard: `agency_role()` still returns null for `draft` (lead data stays
  closed).
- Unit: phone derivation, gendered template rendering for every string that
  names the licensee, photo re-encode sizes.
- Component: each step's validation, autosave, resume.
- E2E: operator opens agency → owner completes wizard with and without a
  photo → operator activates → the site on a test host shows the new name,
  licence and disclosures, and none of Dorit's.
- Visual diff for Dorit (above).
- Contract: `onboarding.ts` required fields match the `submit` RPC.

## Rollout

1. Migration: `agents`, new columns, statuses, `onboarding_role`, bucket,
   RPCs. Additive — nothing reads it yet.
2. Seed Dorit into the new tables; switch the read side; visual diff green.
3. Gendered templates in `compliance.ts` and `home.json`; contract tests.
4. Wizard UI steps 0–7 and the operator review screen.
5. Dry run with a fake agency on a staging subdomain, end to end.
6. First real agency — Phase 4 gates (DPA signed, licence on the register).

## Open questions (for Amiel)

1. Who usually fills it — the new owner alone, or you on a call with them?
   (Changes whether autosave + resume is the priority or the operator's
   "fill on behalf" view.)
2. English and French: does a new agency get them at launch (machine draft +
   owner approval) or Hebrew only, with the language switch hidden?
3. Branding per agency (colour, logo) — in this wizard, or keep one platform
   look for now?
4. Success cases and the personal line (family) — keep them as optional
   steps, or leave them out of v1?
5. Should articles in the shared library be on by default for a new agency?
