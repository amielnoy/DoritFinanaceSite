# AGENTS.md

## Project Context

This is a Base44 app repository. Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

Start with `README.md` for local setup, environment variables, and publish workflow.

## Base44 References

- CLI overview: https://docs.base44.com/developers/references/cli/get-started/overview.md
- Agent skills: https://docs.base44.com/developers/backend/overview/skills.md

If your agent supports Agent Skills, install or update Base44 skills before Base44-specific work:

```bash
npx skills add base44/skills
```

## Key Files

- `src/`: frontend application source.
- `src/api/base44Client.js`: frontend Base44 SDK client.
- `base44/functions/*/entry.ts`: backend functions. Isolated entry points with no
  shared module, so some helpers are duplicated by hand — `redact`, `escapeHtml`,
  `buildClientHtml`, `SHEET_COLUMNS`, `NOTIFY_EMAILS`. Duplicated is fine;
  drifted is not, and `tests/contract/agents.contract.test.ts` fails when copies
  stop matching. `NOTIFY_EMAILS` is the easiest to get wrong: a mailbox added to
  one function and not another raises no error anywhere — the mail simply
  reaches one fewer person, and escalations are where that costs most.
- `vite.config.js`: Vite config and Base44 Vite plugin setup.
- `.env.local`: local-only environment values; never commit secrets.
- `tests/test-plan/`: the test plan and one Software Test Description per suite.
  Update the relevant STD when you add or change tests.

## Working Notes

- Use `base44 dev` as the default local development command when you need the local Base44 backend. It can run the backend and frontend together.
- When docs or code mention the frontend being started automatically, that usually means the Base44 project config includes `site.serveCommand`, for example `"serveCommand": "npm run dev"` in `base44/config.jsonc`.
- Use `npm run dev` only for frontend-only work against the hosted Base44 backend.
- Prefer the existing Base44 CLI workflow over adding new npm scripts for Base44-specific tasks.
- Reuse the existing SDK client and Vite plugin patterns before adding new Base44 integration paths.
- Run the relevant checks from `package.json` before finishing code changes:
  `npm run lint`, `npm run typecheck:gate`, `npm run test:vitest`, and
  `npm run test:e2e` (or `./scripts/run-tests.sh` for everything with a summary).
- Anchors like `#about` name sections that exist **only on the home page**, while
  the header and footer render on every route. Use `useSectionNav` and give the
  anchor a real `/#section` href — a bare `#section` is inert off the home page
  and fails silently.
