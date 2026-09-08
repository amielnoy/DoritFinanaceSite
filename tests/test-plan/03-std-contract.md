# STD-03 — Contract Tests

**Suite:** `contract` · **Runner:** `npm run test:contract` (Vitest, node)
**Location:** `tests/contract/` · **Cases:** 52

---

## 1. Purpose

Keep the frontend and the Base44 backend definitions from drifting apart. These
tests do not restate the payloads: they **read the real call sites out of
`src/`** and the **real schemas out of `base44/`**, so a renamed field, a new
`source` value outside the entity enum, or a loosened RLS rule fails here rather
than in production.

## 2. Test items

| Item | Source |
|---|---|
| Entity schemas | `base44/entities/{BlogPost,Lead,Testimonial,User}.jsonc` |
| Frontend write paths | `base44.entities.*.create/update/filter`, `integrations.Core.SendEmail` |
| Backend function | `base44/functions/createConsultationEvent/entry.ts` |
| Connector | `base44/connectors/googlecalendar.jsonc` |

## 3. Approach

Two helpers do the work:

- `tests/helpers/entity-schema.ts` — loads the `.jsonc` entity definitions and
  validates a payload against the JSON-Schema subset they use (type, required,
  enum, minimum/maximum, no undeclared properties).
- `tests/helpers/source-scan.ts` — a balanced-brace scanner that extracts the
  object literal passed to a call matching a pattern, returning its top-level
  keys and string-literal values.

## 4. Test cases

### 4.1 Entity definitions — `entities.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-ENT-001 | "ships the entities the frontend depends on" | Exactly `BlogPost, Lead, Testimonial, User` |
| CTR-ENT-002..017 | Per entity (×4): well-formed and name matches filename; only supported property types; `required` lists only declared properties; enums and defaults consistent | All pass |
| CTR-RLS-001 | "Lead: anyone may submit, only admins may read/update/delete" | `create === true`; read/update/delete gated on `role: admin` |
| CTR-RLS-002 | "BlogPost: world-readable, admin-writable" | `read === true`; writes gated on `role: admin` |
| CTR-RLS-003 | "no entity is left world-writable by accident" | No entity has `update`/`delete` set to `true` |

### 4.2 Frontend payloads — `frontend-payloads.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-LED-001 | "finds every Lead.create call site" | Exactly 3: `QuickContact`, `DetailedContactForm`, `ConsultationBuilder` |
| CTR-LED-002..010 | Per call site (×3): sends only declared fields; sends `name` and `phone`; uses enum-legal `source`/`status` literals | All pass |
| CTR-LED-011 | "covers all three declared lead sources across the site" | `{quick, detailed, consultation}` = the entity's `source` enum |
| CTR-LED-012 | "validates a representative payload from each form end to end" | Zero validation issues for all three |
| CTR-LED-013 | "rejects a payload with an unknown source or a stray field" | Exactly two issues: `source`, `utm_campaign` (negative control) |
| CTR-BLG-001 | "the admin payload carries title and body and nothing undeclared" | `BlogAdmin` payload conforms |
| CTR-BLG-002 | "publish toggles only flip the declared boolean field" | Every updated key is declared |
| CTR-BLG-003 | "the public blog list filters on the published flag only" | One `filter` call, `{published}`, declared boolean |
| CTR-TST-001 | "sends only declared fields and both required ones" | `Testimonial.create` conforms |
| CTR-TST-002 | "keeps the rating inside the declared 1..5 range" | 5 valid; 6 and 0 rejected |
| CTR-TST-003 | "only accepts the declared review sources" | `google \| midrag`; `yelp` rejected |
| CTR-EML-001 | "every send supplies to, subject and body" | Exactly those three keys on every `SendEmail` |
| CTR-EML-002 | "never hardcodes a recipient inline" | No literal `to:` string — recipients come from named constants |

### 4.3 Backend function — `consultation-function.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-FN-001 | "is invoked from the consultation builder" | One call site, in `ConsultationBuilder.tsx` |
| CTR-FN-002 | "the client sends exactly the fields the function reads" | Client keys ≡ the function's destructured body fields |
| CTR-FN-003 | "the function's mandatory fields are the same as the Lead entity's" | Guard is on `name` and `phone`, matching `Lead.required` |
| CTR-FN-004 | "returns 400 with an error message when name or phone is missing" | A 400 `Response.json({error})` exists |
| CTR-FN-005 | "surfaces an upstream Google Calendar failure as 502" | `if (!res.ok)` → status 502 |
| CTR-FN-006 | "catches unexpected errors as 500" | `catch (error)` → status 500 |
| CTR-FN-007 | "returns `{ ok, eventId, htmlLink }` on success" | Success literal carries all three keys |
| CTR-FN-008 | "every error response carries an `error` key" | ≥3 error responses, all with `error` |
| CTR-FN-009 | "takes the Google token from the connector, never from a literal" | `connectors.getConnection('googlecalendar')`; no secret literals |
| CTR-FN-010 | "does not echo the access token back to the caller" | No `accessToken` in any `Response.json(...)` |
| CTR-FN-011 | "uses a declared connector that exists in the repo" | `base44/connectors/googlecalendar.jsonc` present |

## 5. Runtime counterpart

[STD-05 §4.2](05-std-api.md) re-checks the same contract against **observed
browser traffic**, and an opt-in block re-checks it against a **live backend**.
The static tests catch drift at review time; the runtime ones catch it at run
time.

## 6. Pass criteria

All 52 cases pass. A failure means either the frontend or the backend definition
moved — fix the side that is wrong; do not relax the assertion.
