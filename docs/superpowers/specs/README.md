# Design records

These dated records preserve the decisions and proposed work at the time they
were written. They do not establish current production configuration or completion.
Use [current architecture and operations](../../current-state.md) for current
routing, permissions and release conditions.

| Record |
| --- |
| [Moving auth and data off Base44 onto Supabase](2026-09-21-supabase-auth-data-migration-design.md) |
| [A personal area for signed-in visitors](2026-10-06-personal-area-design.md) |
| [Ranking leads by the channel that brought them](2026-10-09-lead-source-attribution-design.md) |
| [Multi-agent platform, Phase 1: tenant schema](2026-10-10-multi-agent-phase1-tenant-schema-design.md) |
| [Multi-agent platform design](2026-10-10-multi-agent-platform-design.md) |
| [Retiring Base44 as an auth fallback](2026-10-11-auth-cutover-design.md) |
| [Entities → Supabase: cutting Base44's remaining reads over](2026-10-11-entities-to-supabase-design.md) |
| [Claims and the admin's lead writes → Supabase](2026-10-12-claims-and-lead-writes-to-supabase-design.md) |
| [Connectors off Base44 — leads, hand-offs and the chat log on Supabase](2026-10-12-connectors-off-base44-design.md) |
| [Chat agents off Base44 — the interview first, on our own `chat` function](2026-10-13-chat-off-base44-design.md) |
| [Clearinghouse analysis — core + route 2 (staff-light) — design](2026-10-13-clearinghouse-route2-design.md) |
| [SEO and AI visibility for govari-fin.co.il — design](2026-10-13-seo-ai-visibility-design.md) |
| [Agencies and their roles: Owner, Admin, User](2026-10-15-agency-roles-design.md) |
| ["סוכנות חדשה" — the new-agency setup wizard](2026-10-16-new-agency-wizard-design.md) (draft for review, not built) |
| [Saving a client's meetings with Dorit](2026-10-17-client-meetings-design.md) |
| [Adding a lead by hand: a lead someone on the team brought in](2026-10-20-staff-lead-design.md) |
| [Adding a client by hand: a client who never came in as a lead](2026-10-22-staff-client-design.md) (draft for review, not built) |

When a design changes, record the new decision and its relationship to the old
one. Preserve incident measurements and original implementation steps; update
the operational guides and test descriptions to describe the implemented result.
