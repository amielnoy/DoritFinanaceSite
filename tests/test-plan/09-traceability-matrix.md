# Traceability Matrix

Every user-facing capability of the site mapped to the cases that cover it, so a
gap is visible and a failure points at a feature.

| # | Capability | Unit | Component | Contract | Integration | Eval | API | UI e2e | Mobile | Security | a11y |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Landing page renders in Hebrew RTL | — | — | — | — | — | API-HTP-001/002 | E2E-HOM-001..004 | E2E-MOB-005 | — | A11Y-AXE-001, A11Y-STR-001 |
| F-02 | Visitor reads adviser profile, services, proof, testimonials | — | CMP-RVW-001..003 | CTR-TST-001..003 | — | — | API-CTR-002 | E2E-HOM-003/005 | — | SEC-XSS-005 | A11Y-AXE-001 |
| F-03 | Visitor models pension management fees (/tools) | UNIT-PFC-001..012 | CMP-PFC-001..004 | — | — | — | — | E2E-CAL-001..006 | E2E-MOB-009 | — | A11Y-AXE-008 |
| F-04 | Visitor submits the quick contact form | — | CMP-QCF-001..005 | CTR-LED-001..013, CTR-EML-001/002 | INT-LEAD-001..024 | — | API-CTR-003/005/006 | E2E-FRM-001..004 | E2E-MOB-008 | SEC-RLS-001 | A11Y-AXE-008, A11Y-STR-002 |
| F-05 | Visitor leaves details in the short form beside the chat | — | — | CTR-LED-* | INT-LEAD-001..024 | — | API-CTR-003 | E2E-FRM-005..007 | — | — | A11Y-AXE-008 |
| F-06 | Visitor books the first meeting inside the interview chat | — | — | CTR-FN-001..011 | INT-LEAD-025..030, INT-LEAD-080..087 | — | API-CTR-004, API-LIV-004 | E2E-FRM-008..011 | — | — | A11Y-AXE-008 |
| F-07 | Visitor calls / opens WhatsApp | UNIT-CNT-001..005 | CMP-BAR-001, CMP-FLA-001/002 | — | — | — | — | E2E-HOM-007 | E2E-MOB-001/002/006 | SEC-LNK-001 | A11Y-STR-003 |
| F-08 | Visitor browses the blog and reads a post | — | — | CTR-BLG-001..003 | — | — | API-HTP-008 | E2E-BLG-001..006 | — | SEC-XSS-001..004 | A11Y-AXE-002/003 |
| F-09 | Visitor shares a post | — | CMP-SHR-001 | — | — | — | — | E2E-BLG-005 | — | SEC-LNK-001, SEC-STA-014/015 | — |
| F-10 | Visitor navigates between routes | UNIT-UTL-001..003 | — | — | — | — | API-HTP-008 | E2E-NAV-001..017 | E2E-MOB-003 | — | — |
| F-11 | Visitor reads privacy / accessibility statements | — | — | — | — | — | API-HTP-006 | E2E-NAV-005/006 | E2E-MOB-005 | — | A11Y-AXE-005/006, A11Y-STR-006 |
| F-12 | Admin signs in | UNIT-RET-001..020 | — | — | — | — | — | E2E-NAV-007 | — | SEC-RED-001, SEC-STA-019..021 | — |
| F-13 | Admin manages leads and blog posts | — | — | CTR-RLS-001/002, CTR-BLG-002 | INT-LEAD-001..009 | — | API-LIV-003 | E2E-NAV-018 | — | SEC-RLS-001, SEC-STA-022/023 | — |
| F-14 | Site is discoverable by search and AI crawlers | SEO-URL-*, SEO-DSC-* | — | — | — | — | API-HTP-002..007/010 | SEO-PRE-001..011 | — | — | — |
| F-17 | Every route is indexed under its own title, description and canonical | SEO-APL-001..010 | — | — | — | — | — | SEO-MET-001..008 | SEO-MOB-001/002 | SEO-IDX-007..012 | — |
| F-18 | Rich results: FAQ, article, breadcrumb, service | SEO-BRD-001 | — | — | — | — | — | SEO-LD-001..005, SEO-PRE-010 | SEO-MOB-001 | — | — |
| F-19 | Mobile-first indexing parity and mobile usability | — | — | — | — | — | — | — | SEO-MOB-001..007 | — | A11Y-STR-007, E2E-MOB-005/010 |
| F-15 | Site degrades safely when the backend fails | — | CMP-RVW-003, CMP-QCF-004 | — | INT-LEAD-018..024, INT-CLAIM-008..011 | — | — | E2E-HOM-006, E2E-BLG-006, E2E-FRM-003/010 | — | SEC-ERR-001 | — |
| F-20 | Visitor talks to an on-site agent, behind a consent gate | — | — | CTR-AGT-001..083 | INT-LEAD-031..064 | EVAL-INT-001..008 | — | E2E-AGT-001..003 | — | — | — |
| F-21 | Visitor is handed to a person whenever the agent may not answer | — | — | CTR-AGT-001..083, CTR-FN-* | INT-ESC-001..019 | EVAL-INT-006/008 | — | E2E-AGT-004/005 | — | — | — |
| F-22 | Published articles carry the mandatory גילוי נאות | — | — | CTR-ART-001..013 | — | — | — | — | — | — | — |
| F-23 | Visitor reports an insurance claim | — | — | CTR-LED-*, CTR-EML-* | INT-CLAIM-001..013 | — | — | — | — | SEC-XSS-* | A11Y-AXE-008 |
| F-24 | Interview hands the agency a structured summary, not free text | — | — | CTR-AGT-084..116 | INT-LEAD-039..064 | EVAL-INT-002..005/007 | — | — | — | SEC-AGT-* | — |
| F-25 | Every enquiry reaches the agency by mail | — | — | CTR-AGT-*, CTR-EML-* | INT-LEAD-*, INT-ESC-*, INT-MAIL-*, INT-CLAIM-* | — | — | — | — | SEC-AGT-* | — |
| F-16 | No secrets ship to the browser | — | — | CTR-FN-009/010 | — | — | — | — | — | SEC-STA-001..009, SEC-BND-001 | — |

## Coverage gaps (accepted)

| Gap | Why it is accepted |
|---|---|
| Registration, password reset, OTP flows | Base44 starter screens, unmodified by this project |
| `BlogAdmin` and `Leads` admin UIs end-to-end | Require an authenticated admin session; covered statically (CTR-BLG-*, SEC-STA-022) and by RLS assertions |
| Google Calendar event creation | Third-party side effect; the client contract and error handling are covered (CTR-FN-*, E2E-FRM-010) |
| Visual regression | No baseline strategy chosen; layout is guarded indirectly by E2E-MOB-005 |
| Blog post URLs in the static sitemap | Posts are entity-backed, so their URLs are unknown at build time; they are reachable from `/blog` and each carries its own canonical and `BlogPosting` markup (SEO-LD-004) |
| Performance / Core Web Vitals | Out of scope for a sanity suite |
| Real-device iOS/Android | Needs a device lab; see [STD-07 §1](07-std-mobile.md) |
| What an agent actually says in a live conversation | The reply comes from a model, so it cannot be asserted. What is testable is split out and tested: the shell's gates (E2E-AGT-*) and the presence of every mandatory clause in the prompts (CTR-AGT-*). See [`base44/agents/COMPLIANCE.md`](../../base44/agents/COMPLIANCE.md) §4 for which rules are enforced where |
| The `escalateToHuman` notification reaching דורית | A third-party side effect; the function's contract and its error path are covered (CTR-AGT-*, E2E-AGT-005) |
