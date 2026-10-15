# Traceability Matrix

Every user-facing capability of the site mapped to the cases that cover it, so a
gap is visible and a failure points at a feature.

| # | Capability | Unit | Component | Contract | Integration | Eval | API | UI e2e | Mobile | Security | a11y |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Landing page renders in Hebrew RTL | — | — | — | — | — | API-HTP-001/002 | E2E-HOM-001..004 | E2E-MOB-005 | — | A11Y-AXE-001, A11Y-STR-001 |
| F-02 | Visitor reads adviser profile, services, proof, testimonials | — | CMP-RVW-001..003, CMP-TST-001..003/006..009, CMP-PRF-001..005, CMP-HTR-001..005 | CTR-TST-001..003 | — | — | API-CTR-002 | E2E-HOM-003/005/008 | E2E-MOB-022/023/024/028/029/030/031/032/033/034/035, E2E-DSK-004 | SEC-XSS-005 | A11Y-AXE-001 |
| F-03 | Visitor models pension management fees (/tools) | UNIT-PFC-001..012, UNIT-CLD-001..004, UNIT-CLD-008, UNIT-GA4-020/021 | CMP-PFC-001..004, CMP-CLD-001..010 | — | — | — | — | E2E-CAL-001..007 | E2E-MOB-009, E2E-CAL-009 | — | A11Y-AXE-008 |
| F-04 | Visitor submits the quick contact form, beside the chat in `#start` | UNIT-SUB-001..008 | CMP-QCF-001..005 | CTR-LED-001..013, CTR-EML-001/002 | INT-LEAD-001..024 | — | API-CTR-003/005/006 | E2E-FRM-001..004 | E2E-MOB-008, E2E-MOB-001c/007/025 | SEC-RLS-001 | A11Y-AXE-008, A11Y-STR-002 |
| F-06 | Visitor books the first meeting inside the interview chat | UNIT-RCP-001..003 | CMP-NWZ-101..107 | CTR-FN-001..011 | INT-LEAD-025..030, INT-LEAD-080..087 | — | API-LIV-004 | E2E-AGT-001..005 | E2E-MOB-026/027 | — | A11Y-AXE-008 |
| F-07 | Visitor calls / opens WhatsApp | UNIT-CNT-001..005 | CMP-BAR-001, CMP-FLA-001/002 | — | — | — | — | E2E-HOM-007 | E2E-MOB-001/001a/002/006/021/025, E2E-DSK-004 | SEC-LNK-001 | A11Y-STR-003 |
| F-08 | Visitor browses the blog and reads a post | — | — | CTR-BLG-001..003 | — | — | API-HTP-008 | E2E-BLG-001..006 | — | SEC-XSS-001..004 | A11Y-AXE-002/003 |
| F-09 | Visitor shares a post | — | CMP-SHR-001 | — | — | — | — | E2E-BLG-005 | — | SEC-LNK-001, SEC-STA-014/015 | — |
| F-10 | Visitor navigates between routes | UNIT-UTL-001..003 | — | — | — | — | API-HTP-008 | E2E-NAV-001..017 | E2E-MOB-003 | — | — |
| F-11 | Visitor reads privacy / accessibility statements | — | — | — | — | — | API-HTP-006 | E2E-NAV-005/006 | E2E-MOB-005 | — | A11Y-AXE-005/006, A11Y-STR-006 |
| F-12 | Admin signs in | UNIT-RET-001..020, UNIT-SBA-001..012 | — | — | — | — | — | E2E-NAV-007 | — | SEC-RED-001, SEC-STA-019..021 | — |
| F-13 | Admin manages leads and blog posts | UNIT-ADM-001..011 | — | CTR-RLS-001/002, CTR-BLG-002 | INT-LEAD-001..009 | — | API-LIV-003 | E2E-NAV-018 | — | SEC-RLS-001, SEC-STA-022/023 | — |
| F-14 | Site is discoverable by search and AI crawlers | SEO-URL-*, SEO-DSC-* | — | — | — | — | API-HTP-002..007/010 | SEO-PRE-001..011 | — | — | — |
| F-17 | Every route is indexed under its own title, description and canonical | SEO-APL-001..010 | — | — | — | — | — | SEO-MET-001..008 | SEO-MOB-001/002 | SEO-IDX-007..012 | — |
| F-18 | Rich results: FAQ, article, breadcrumb, service | SEO-BRD-001 | — | — | — | — | — | SEO-LD-001..005, SEO-PRE-010 | SEO-MOB-001 | — | — |
| F-19 | Mobile-first indexing parity and mobile usability | — | — | — | — | — | — | — | SEO-MOB-001..007 | — | A11Y-STR-007, E2E-MOB-005/010 |
| F-15 | Site degrades safely when the backend fails | UNIT-SUB-005/007 | CMP-RVW-003, CMP-QCF-004, CMP-CLM-002 | — | INT-LEAD-018..024, INT-CLAIM-008..011 | — | — | E2E-HOM-006, E2E-BLG-006, E2E-FRM-003, E2E-CLM-004 | — | SEC-ERR-001 | — |
| F-20 | Visitor talks to an on-site agent, behind a consent gate | — | — | CTR-AGT-* (compliance block) | INT-LEAD-031..064 | EVAL-INT-001..008 | — | E2E-AGT-001..003 | — | — | — |
| F-21 | Visitor is handed to a person whenever the agent may not answer | UNIT-RCP-004 | — | CTR-AGT-*, CTR-FN-* | INT-ESC-001..019 | EVAL-INT-006/008 | — | E2E-AGT-004/005, E2E-AGT-010 | — | — | — |
| F-22 | Published articles carry the mandatory גילוי נאות | UNIT-SEED-001..007 | — | CTR-ART-001..019 | — | — | — | — | — | — | — |
| F-23 | Visitor reports an insurance claim | UNIT-SUB-001..008 | CMP-CLM-001..003 | CTR-LED-*, CTR-EML-* | INT-CLAIM-001..013 | — | — | E2E-CLM-001..005 | — | SEC-XSS-* | A11Y-AXE-008 |
| F-24 | Interview hands the agency a structured summary, not free text | — | — | CTR-AGT-* (profile schema) | INT-LEAD-039..064 | EVAL-INT-002..005/007 | — | — | — | SEC-AGT-* | — |
| F-25 | Every enquiry reaches the agency by mail | — | — | CTR-AGT-*, CTR-EML-*, CTR-CLK-001/002 | INT-LEAD-*, INT-ESC-*, INT-MAIL-*, INT-CLAIM-* | — | — | — | — | SEC-AGT-* | — |
| F-16 | No secrets ship to the browser | — | — | CTR-FN-009/010 | — | — | — | — | — | SEC-STA-001..009, SEC-BND-001 | — |
| F-26 | Visitor runs the insurance self-assessment (/tools) | UNIT-ASM-001..008, UNIT-CLD-005..007 | CMP-CLD-011..015 | — | — | — | — | E2E-CAL-008 | E2E-CAL-009 | — | A11Y-AXE-009 |
| F-27 | Visitor reads the FAQ library and asks the support chat (/faq) | UNIT-FAQ-001..006, UNIT-GA4-022..027 | CMP-FAQ-001, CMP-BAR-002/003, CMP-FLA-003, CMP-HDR-009/010, CMP-SHEET-001..011 | CTR-AGT-* | INT-SUPPORT-001..012 | — | API-HTP-008 | E2E-NAV-004, E2E-AGT-006..008, E2E-SUP-001..005 | E2E-SUP-001/002, E2E-MOB-011..020, E2E-DSK-003/004 | — | A11Y-AXE-001 |
| F-28 | Visitor asks how a procedure is carried out, in the procedures chat (/tools) | — | — | CTR-AGT-* | — | EVAL-PRC-001..009 | — | E2E-AGT-009..012 | — | — | A11Y-AXE-008 |
| F-29 | Signed-in visitor sees their own enquiries (/account) | UNIT-ACC-001..017 | CMP-ACC-001..023, CMP-HDR-001..005 | CTR-ACC-001..006 | INT-ACC-001..010 | — | — | E2E-ACC-001 | — | — | — |
| F-30 | Admin sees which lead events reach GA4, and marks a browser internal (/admin/leads) | UNIT-GA4-001..014 | CMP-GA4-001..005, CMP-QCF-006 | — | — | — | — | — | — | — | — |
| F-31 | The FAQ chat runs on the chat function: its own tools, its own notice, no lead tool | UNIT-CHTOOL-020..028, UNIT-CHART-001..009, UNIT-CHHANDLER-048..051, UNIT-CHCONFIG-005..009 | CMP-CHSUP-001/002 | CTR-CHPROMPT-009..012 | — | EVAL-CHAT (UNIT-EVALCHAT-034..042; `npm run test:eval:chat`, manual) | — | — | — | — | — |
| F-33 | The procedures chat runs on the chat function: the FAQ chat's tools, its own notice, logged to the Support tab | UNIT-CHHANDLER-061/062, UNIT-CHSWEEP-007, UNIT-CHCONFIG-010/011 | CMP-CHPROC-001/002 | CTR-CHPROMPT-014..017 | — | EVAL-CHAT (`proc-01..06`, UNIT-EVALCHAT-046/047; manual) | — | — | — | — | — |
| F-32 | A finished FAQ conversation is logged to the sheet by the function itself, once | UNIT-CHSWEEP-001..014, UNIT-CHSTORE-016..019, UNIT-CHHANDLER-052..059 | — | CTR-CHSCH-011..014, CTR-CHFN-009/010 | — | — | — | — | — | — | — |

### Review Focus of the FAQ-chat branch (feat/chat-pr2-support)

| # | Review Focus | Cases |
|---|---|---|
| 1 | The support model naming `submitLead` gets `unknown_tool`-style refusal: nothing is run, the conversation stays open (and the interview is gated the same way for the article tools) | UNIT-CHHANDLER-049, UNIT-CHHANDLER-051, UNIT-CHTOOL-020 |
| 2 | An invented or mangled slug answers `not_found` with no query; a failing store answers `tool_failed`, never `not_found` | UNIT-CHART-007, UNIT-CHART-008, UNIT-CHTOOL-024, UNIT-CHTOOL-025, UNIT-CHTOOL-028 |
| 3 | Two overlapping sweeps log each conversation once | UNIT-CHHANDLER-059, UNIT-CHSWEEP-012, UNIT-CHSTORE-016 |
| 4 | A conversation in a turn, one the handler has not yet closed plus a 5-minute margin (active in the last 2 h 5 min), or an evaluation one is not logged; a logged one cannot continue | UNIT-CHHANDLER-058, UNIT-CHHANDLER-060, UNIT-CHSWEEP-007, UNIT-CHSTORE-016 |
| 5 | The sweep route refuses a missing or wrong token and runs no chat logic | UNIT-CHHANDLER-052..054, CTR-CHSCH-012 |

## Coverage gaps (accepted)

| Gap | Why it is accepted |
|---|---|
| The detailed contact form and the three-step consultation builder (was F-05, E2E-FRM-005..011, API-CTR-004) | Both were removed from the site; the interview agent in `#start` and the short form beside it replaced them. Nothing is untested — there is nothing left to test. See [STD-06 §3.4](06-std-ui-e2e.md) |
| Registration, password reset, OTP flows | Base44 starter screens, unmodified by this project |
| `BlogAdmin` and `Leads` admin UIs end-to-end | Require an authenticated admin session; covered statically (CTR-BLG-*, SEC-STA-022) and by RLS assertions |
| Google Calendar event creation | Third-party side effect; the client contract and error handling are covered (CTR-FN-*, INT-LEAD-025..030) |
| Visual regression | No baseline strategy chosen; layout is guarded indirectly by E2E-MOB-005 |
| Blog post URLs in the static sitemap | Posts are entity-backed, so their URLs are unknown at build time; they are reachable from `/blog` and each carries its own canonical and `BlogPosting` markup (SEO-LD-004) |
| Performance / Core Web Vitals | Out of scope for a sanity suite |
| Real-device iOS/Android | Needs a device lab; see [STD-07 §1](07-std-mobile.md) |
| What an agent actually says in a live conversation | The reply comes from a model, so it cannot be asserted. What is testable is split out and tested: the shell's gates (E2E-AGT-*) and the presence of every mandatory clause in the prompts (CTR-AGT-*). See [`base44/agents/COMPLIANCE.md`](../../base44/agents/COMPLIANCE.md) §4 for which rules are enforced where |
| The `escalateToHuman` notification reaching דורית | A third-party side effect; the function's contract and its error path are covered (CTR-AGT-*, E2E-AGT-005) |
