# Documentation index

Use [current architecture and operations](current-state.md) for the implemented
system as checked on 2026-10-17, and the [root README](../README.md) for setup,
environment variables, publishing and operational runbooks.

| Documentation | Purpose |
| --- | --- |
| [Contributor instructions](../AGENTS.md) | Repository conventions and invariants |
| [Design system](design-system.md) | UI foundations and component conventions |
| [Test plan and STDs](../tests/test-plan/README.md) | Coverage, commands, traceability and known issues |
| [Architecture review](../Architecture.html) | Architecture and dated review findings |
| [System map](../SystemMap.html) | Visual component and service inventory |
| [Design drift review](../CodeReview.html) | Recorded design-system findings |
| [Base44 exit record](base44-exit/README.md) | Historical measurements and migration evidence |
| [Agency roles design](superpowers/specs/2026-10-15-agency-roles-design.md) | Owner/Admin/User permissions and rollout |
| [Agent compliance](../base44/agents/COMPLIANCE.md) | Compliance constraints and unresolved decisions |
| [UI typing guide](../src/components/ui/README-types.md) | Shared UI component typing conventions |

[`superpowers/specs/`](superpowers/specs/README.md) records designs;
[`superpowers/plans/`](superpowers/plans/README.md) records implementation plans. Their checkboxes and proposed steps are not deployment attestations. Confirm
implemented behavior against code, and deployed state against the relevant account.
The Base44 exit measurements retain their original dates and counts.

`content/blog/` contains publishable articles. `supabase/functions/chat/prompts/`
contains runtime prompt sources. Both use Markdown but require their own product,
compliance and generation workflows when changed.
