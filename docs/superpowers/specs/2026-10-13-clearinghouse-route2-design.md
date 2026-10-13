# Clearinghouse analysis — core + route 2 (staff-light) — design

**Status:** approved in conversation 2026-10-13; this document is for review.
**Goal:** a client's full pension picture from the pension clearinghouse (המסלקה הפנסיונית), analysed and ready for Dorit's meeting, with as little work as possible for Dorit and her staff — and no raw clearinghouse file ever stored.

## Decisions (with the user)

| Question | Decision |
|---|---|
| First user | Dorit's back office (not client self-service) |
| Sources | Clearinghouse first; Har HaBituach later, separately |
| Who pulls the data | Route 2: Dorit (or staff) requests it in the clearinghouse advisor portal with the client's authorisation code; ₪14 per client, paid by Dorit |
| Where the ZIP is opened | In the staff member's browser only; only a trimmed result reaches the server |
| Retention | The trimmed snapshot is deleted 24 months after it was taken, on a newer snapshot, on the delete button, or on the client's request |
| Ease | The site does the chasing: it invites the client, collects the code, reminds the team, and matches downloaded files to clients by itself |

## Facts this design rests on (checked 2026-10-13, swiftness.co.il — the clearinghouse operator)

- Registration, for a saver or a licensed advisor, is free. A licensed advisor's request for "information from all bodies" costs ₪14; a saver's own request also ₪14 (the Q&A page elsewhere says ₪20 incl. VAT).
- A saver can generate a power-of-attorney code ("קוד ייפוי כוח") on the clearinghouse site and hand it to an advisor; it replaces the paper Appendix A.
- Since 22.5.2022 bodies answer an all-bodies request within about 3–4 hours. The answer is a ZIP of data files (portal download, and by email to the registered address). **The clearinghouse deletes it after 7 business days.**
- The data is the "holdings interface" (ממשק אחזקות), XML, current version 9.0 (regulator circular 2024-9-3): header `KoteretKovetz`, products `NetuneiMutzar` (`SUG-MUTZAR`: 1 life policy with savings, 2 pension fund, 3 provident fund), accounts/policies `HeshbonOPolisa`, with coverages, fees, balances, deposits, identifying and family details.
- Reference files are in the session scratchpad (`mislaka/`): the holdings-interface rules v9.0 (text extracted), the 2024-09 XSD corrections, and the operator's sample ZIP (events interface — not holdings). The official holdings XSD (attached to circular 2024-9-3) was not reachable by script.

**To verify while building** (each is a task's first step, not an assumption to build on):
1. Whether the advisor portal needs the client's ID number besides the code. Assumed yes; if not, the ID field and its storage are dropped.
2. The real ZIP's layout and XML version — from the user's own report (₪14), which becomes the test fixture after his details are replaced with fake ones.

## The flow

### Client (prompted by the site)
1. A lead answers "מעוניין/ת" to the clearinghouse question (needs wizard screen 5, or the chat interview). `submit-lead` creates a `masleka_requests` row (status `invited`) with an unguessable token and emails the client a link to `/masleka?t=<token>`. Staff can also create a request by hand from the queue (for leads from the phone) and copy the link to send.
2. `/masleka` — three numbered steps with screenshots, in plain Hebrew: register on swiftness.co.il (free); press "הפקת קוד ייפוי כוח"; paste the code and your ID number here. The ID is checked with the Israeli check-digit rule before sending.
3. The form posts to the Edge Function `masleka-code`, which encrypts both values and moves the request to `code_received`. The client sees "תודה — דורית תטפל בזה" and nothing else.

### Staff (one screen: "מסלקה" in the admin)
A board worked left to right:

| ממתין להגשה | הוגש — ממתין להורדה | הושלם |
|---|---|---|
| Client name · **העתק ת״ז** · **העתק קוד** · **פתח את המסלקה** (the advisor portal) · **הגשתי** | "מוכן בעוד כ־3–4 שעות" → "מוכן להורדה" · **ימים עד מחיקה במסלקה** | Link to the analysis · **הדפסה** |

- The copy buttons call `masleka-reveal`, which returns the decrypted values to a signed-in member of the agency and writes an access-log row.
- **הגשתי** calls `masleka-submitted`: the ciphertexts are wiped; only the ID's last 4 digits and the client's name remain, for matching. Status `submitted`, timestamp recorded.
- **Drop zone** (the whole board): drop all of the day's ZIPs at once. Each is opened and parsed in the browser, matched to a `submitted` request by ID last-4 + family name, saved as a snapshot, and analysed; the request becomes `completed`. A ZIP that matches nothing, or more than one, asks once: "לאיזה לקוח?".
- A one-time guide page: registering as an advisor on the clearinghouse (free), with screenshots.

### Reminders (email to every staff member, via dorit-mailer)
- "קוד מסלקה חדש לטיפול" — when a client submits a code.
- "יש קבצים להורדה" — 4 hours after **הגשתי**.
- "נמחק במסלקה בעוד יומיים" — on business day 5 after **הגשתי** if no snapshot yet.
- A request still `invited` after 7 days gets one reminder email to the client; after 30 days it expires.

## What cannot be automated, and why

Submitting the request, paying ₪14 and downloading happen inside the clearinghouse's own portal. Licensed advisors have no public API, and the site will not hold Dorit's clearinghouse credentials or act in that portal on her behalf. Everything around those three steps is automated.

## Components

**Roles.** Staff are `memberships` rows with role `staff` (or `agent`/`owner`) in agency 1 — the Phase 1 mechanism; `can_see(agency_id)` already gates agency rows. The admin route guard admits members as well as `admin`; the blog and site administration stay `admin`-only. Adding a staff member is one SQL insert (documented), like the admin role today.

**Data** (new migration):
- `masleka_requests`: `id`, `agency_id`, `lead_id` (nullable for hand-made requests), `client_name`, `contact_email`, `token_hash`, `status` (`invited` · `code_received` · `submitted` · `completed` · `expired` · `cancelled`), `code_ciphertext`, `id_ciphertext`, `id_last4`, timestamps per status. RLS: agency members only; `anon` nothing (the client reaches it only through `masleka-code`).
- `clearinghouse_snapshots`: `id`, `agency_id`, `lead_id`, `request_id`, `taken_at`, `delete_after` (= `taken_at` + 24 months), `interface_version`, `data jsonb` (trimmed). RLS: agency members only. A new snapshot for the same lead deletes the older one.
- `masleka_access_log`: who revealed which request, when.
- Nightly `pg_cron`: delete snapshots past `delete_after`; expire stale requests; wipe any ciphertext older than 9 days whatever its status.

**Encryption.** AES-GCM with a key held only as an Edge Function secret (`MASLEKA_KEY`); the database never sees plaintext or the key. Ciphertexts live at most until **הגשתי** (and never more than 9 days).

**Edge Functions** (each imports `_shared/`):
- `masleka-code` — public; validates token and ID check digit; rate-limited with `allow_submission`; encrypts; notifies staff.
- `masleka-reveal` — members only (verifies the Supabase session and membership); decrypts; logs.
- `masleka-submitted` — members only; wipes ciphertexts; records time.
- `masleka-remind` — invoked hourly by `pg_cron`/`pg_net`; sends the reminders above.
- `submit-lead` — creates the request and sends the invitation when the clearinghouse answer is "מעוניין/ת" (replacing the `POA_URL` link in that email). Active once `VITE_LEAD_FUNCTIONS=supabase`; until then staff create requests by hand.

**Parser** — `src/lib/clearinghouse/`, pure TypeScript, browser-only: unzip (fflate, small and dependency-free), read the holdings XML, return a `Snapshot` (products, accounts, balances, deposits, fees, coverages, insured-family counts, interface version). Trimming happens inside the parser: the ID becomes its last 4 digits, family members become counts, free text is dropped. Unknown versions or unreadable files are reported plainly, never guessed.

**Analysis** — `src/lib/clearinghouse/analysis.ts`, pure functions over a `Snapshot`:
- fees per product against the legal maximum and the current default-fund fees (a reference table in the repo with source and date, verified from official sources when built), and the cost of the difference to retirement using `pension-fee.ts`;
- consolidation: small inactive accounts still charged fees; several active pension funds;
- insurance duplicates inside savings products: survivors/disability cover in two pension funds, or a managers' policy plus a pension fund;
- gaps: no disability cover; no survivors' cover where there are dependants.

**View** — per snapshot: totals (savings, yearly fees), the 3–5 findings worth raising, a table per product, and a print stylesheet. Framed as preparation for Dorit's meeting, not advice; the pension-marketing disclosure line is on the printout.

## Release gates

1. **Compliance adviser review** before anything collects a code or an ID (PR A) — the page text, the storage and wipe rules, the 24-month retention, and the printout's framing.
2. A real ZIP (the user's own report) before the parser is built (PR B).

## Delivery (three PRs, each usable on its own)

- **PR A — the request pipeline:** staff access via memberships, `masleka_requests`, `/masleka`, `masleka-code`/`-reveal`/`-submitted`/`-remind`, the board's first two columns, reminders, the advisor-registration guide, hand-made requests. Useful alone: requests flow and nobody chases codes; files are still opened by hand.
- **PR B — parse and store:** the parser, the drop zone, matching, `clearinghouse_snapshots`, the purge. Gated on the real ZIP.
- **PR C — analysis and print:** the findings, the view, the printout.

## Testing

- Parser: unit tests on the anonymised real fixture (every product type present), plus malformed and unknown-version files.
- Analysis: one unit test per finding, including the no-finding case.
- RLS checks (`supabase/tests/`): `anon` cannot read requests, snapshots or the log; a non-member cannot; a member can; a snapshot past `delete_after` is gone after the purge.
- Edge: `masleka-code` rejects a bad token, a bad ID check digit, and floods; `masleka-reveal` rejects non-members and logs members; `masleka-submitted` leaves no ciphertext.
- Contract: no raw XML or ZIP is uploaded anywhere (the parser's output type has no raw-text fields; no storage bucket for clearinghouse files exists); the public page and emails never echo the ID or code.
- e2e: a staff member works one request end to end with a fixture ZIP.

## Out of scope

Route 1 (client uploads their own report), Har HaBituach import, any automatic pull, client-facing analysis, and showing snapshots in the personal area.

## Risks

- **The ID-plus-code store is the most sensitive thing the site has held.** Mitigations: encryption with a key outside the database, a 9-day hard wipe, member-only reveal with an audit log, rate limits, and the compliance gate.
- **Staff miss the 7-business-day window**: day-5 reminder; a missed file means one more ₪14 request.
- **The holdings format changes version**: the parser reports the version it can't read instead of misreading it.
- **Matching by ID last-4 + family name** can collide in a busy queue: it asks instead of guessing.
