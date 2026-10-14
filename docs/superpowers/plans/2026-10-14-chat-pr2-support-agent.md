# Chat PR 2 — the FAQ agent on our own `chat` function: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `support_agent` (the /faq chat) from the `chat` Edge Function, with article-reading tools shared with PRs 3–4 and the Google Sheet's Support-tab log written automatically by the function.

**Architecture:**
- **The role:** a second role, `support`, on the existing `chat` function. It has its own Markdown prompt, ported from `base44/agents/support_agent.jsonc` word for word except the tool section, and its own tool set: `listArticles`, `readArticle` and `escalateToHuman`.
- **The article tools** read published Supabase `blog_posts` for agency 1 and link by slug.
- **The sheet log** comes from a sweep. A new `sheet_logged_at` column marks what has been logged. A pg_cron job, every 15 minutes, calls the function's sweep route through pg_net with a Vault-held token. The sweep claims idle, non-evaluation support conversations in one filtered PATCH and logs each through the existing `log-support-chat` handler, run in-process.
- **The site** adds `support_agent` to the agents the `chat` function may serve. `VITE_CHAT_AGENTS` still decides, and is empty by default.

**Tech Stack:** Deno Edge Functions (TypeScript), PostgREST via `_shared/rest.ts`, Postgres (pg_cron 1.6.4, pg_net 0.20.4, supabase_vault), Vitest, React/TS front end, Node eval script.

**Spec:** `docs/superpowers/specs/2026-10-13-chat-off-base44-design.md` ("Later PRs: support, procedures, then the blog recommender, each with its own prompt PR"). Decisions taken with the user on 2026-10-14 (they extend the spec):
1. **The split:** this PR adds the shared tools plus `support_agent`. PR 3 is `procedures_agent`; PR 4 is `blog_recommender`.
2. **The sheet log** is kept and written **automatically** by the function when a support conversation goes idle. It is not a model tool.
3. **The blog recommender's hidden block** becomes a `recommend_articles` tool in PR 4, not here.

## Global Constraints

- **Ships dark.** `VITE_CHAT_AGENTS` stays empty, and nothing a visitor sees changes until it names `support_agent`.
- **Consent v6** (`2026-10-agents-v6`) applies to every agent served by `chat`. Switch-on is behind the same compliance approval as the interview (README "Rollout" step 4).
- **The prompt port.** `fillPlaceholders(PROMPTS.support)` must equal today's `support_agent.jsonc` instructions with only the tool-section lines replaced or removed. This is the same rule as `interview.md`.
- **The model never supplies attribution, consent, agent name, phone for the log, or which agency's articles it reads.**
- **Articles:** only rows with `published = true` and (`agency_id` null or agency 1). Never a draft, never another agency's.
- **A slug** is `/^[a-z0-9]+(-[a-z0-9]+)*$/`, the pattern in `src/lib/articlePath.ts`. Anything else is refused before any query.
- **Evaluation conversations** (`is_eval`) are never logged to the sheet.
- **Sheet log rule:** each conversation at most once, and never while a turn holds it (`busy_until` in the future).
- **Plain `fetch` through `_shared/rest.ts`.** No supabase-js in Edge code, so the in-process test harness runs it.
- **Logs** follow `tests/contract/logging.contract.test.ts`: what happened, never what was said.
- **`npm run build:chat-prompts`** after editing any `prompts/*.md`. A contract test fails on a stale `prompts.generated.ts`.
- **Commits** end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
  ```

## Review Focus

1. **The support model calls `submitLead`.** It isn't offered the tool, but a model can name any tool. The function must answer `unknown_tool` and run nothing. Pinned in Task 2.
2. **A slug the model invents or mangles** gets `readArticle` → `{ok:false,error:'not_found'}`, never a 500 or a query with free text in it. Pinned in Task 1.
3. **Two sweeps overlapping** (cron firing while a manual one runs) log each conversation exactly once. The claim is one filtered PATCH. Pinned in Task 5 and Task 6.
4. **A conversation still in a turn, or active in the last 30 minutes,** is not logged. An evaluation conversation is never logged. Pinned in Task 5.
5. **The sweep route** must refuse a missing or wrong token and must not run any chat logic. A request carrying `x-chat-sweep` never reaches the agent path. Pinned in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/chat/articles.ts` (new) | `ArticleSource`: published, agency-1 articles from `blog_posts` (list, read one by slug). |
| `supabase/functions/chat/tools.ts` | Adds `listArticles` and `readArticle` definitions and runners, `SUPPORT_TOOLS`, and exports `ESCALATE_TOOL`. The runner takes an `ArticleSource`. |
| `supabase/functions/chat/prompt.ts` | `ChatRole` gains `'support'`. |
| `supabase/functions/chat/prompts/support.md` (new) | The FAQ agent's prompt, as a template. |
| `scripts/build-chat-prompts.mjs` | `PROMPT_NAMES` gains `'support'`. |
| `tests/helpers/chat-prompt-sources.mjs` | Gains `SUPPORT_TOOL_SECTION`. `withToolSection` and `toTemplate` take the section, and a `null` replacement drops the line. |
| `supabase/functions/chat/handler.ts` | `AGENT_ROLES.support_agent`, `ROLE_TOOLS.support`, the per-role tool gate, the sweep route, and `ChatDeps.sweepToken` / `sweepSheetLogs`. |
| `supabase/functions/chat/store.ts` | `claimSheetLogs(roles, cutoffIso, nowIso)`. |
| `supabase/functions/chat/sweep.ts` (new) | `createSheetLogSweep`: claim, build each sheet row (topic, outcome, transcript), call `log-support-chat`. |
| `supabase/functions/chat/deps.ts` | Wires `restArticles`, `CHAT_SWEEP_TOKEN` and the sweep. |
| `supabase/migrations/20261018000000_chat_support_sheet_log.sql` (new) | The `sheet_logged_at` column and index, `public.chat_sweep_tick()`, and the cron job `chat-support-sheet-log`. |
| `src/config/chat-agents.ts` | `CHAT_FUNCTION_AGENTS` gains `"support_agent"`. |
| `scripts/eval-chat.mjs`, `scripts/eval-chat-lib.mjs`, `tests/eval/chat/personas.json`, `tests/eval/chat/rubric-support.md` (new) | A persona's `agent` field, the support personas, and a rubric chosen by agent. |
| `README.md`, the spec, `tests/test-plan/*.md` | Rollout and secrets, the amendment, and the test inventory. |

---

### Task 1: Article source

**Files:**
- Create: `supabase/functions/chat/articles.ts`
- Test: `tests/unit/chat-articles.test.ts`

**Interfaces:**
- Consumes: `selectRows(table, query)` from `supabase/functions/_shared/rest.ts`; `AGENCY.id` from `supabase/functions/_shared/agency.ts`.
- Produces:
  ```ts
  export interface ArticleSummary { slug: string; title: string; excerpt: string; tags: string }
  export interface ArticleText { slug: string; title: string; body: string; truncated: boolean }
  export interface ArticleSource { list(): Promise<ArticleSummary[]>; read(slug: string): Promise<ArticleText | null> }
  export const ARTICLE_LIST_LIMIT = 60;
  export const ARTICLE_BODY_LIMIT = 12_000;
  export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  export function createArticleSource(select: (table: string, query: string) => Promise<Record<string, unknown>[]>, agencyId: string): ArticleSource;
  export const restArticles: ArticleSource; // createArticleSource(selectRows, AGENCY.id)
  ```

- [ ] **Step 1: Write the failing test** `tests/unit/chat-articles.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import {
  ARTICLE_BODY_LIMIT,
  ARTICLE_LIST_LIMIT,
  SLUG_PATTERN,
  createArticleSource,
} from "../../supabase/functions/chat/articles.ts";
import { SLUG_PATTERN as SITE_SLUG } from "@/lib/articlePath";

const AGENCY = "00000000-0000-0000-0000-000000000001";
const source = (rows: Record<string, unknown>[] = []) => {
  const select = vi.fn(async (_t: string, _q: string) => rows);
  return { select, articles: createArticleSource(select, AGENCY) };
};

describe("the chat's article source", () => {
  it("lists only published articles of this agency or shared ones, newest first, capped", async () => {
    const { select, articles } = source([{ slug: "a", title: "T", excerpt: "E", tags: "פנסיה" }]);
    expect(await articles.list()).toEqual([{ slug: "a", title: "T", excerpt: "E", tags: "פנסיה" }]);
    const [table, query] = select.mock.calls[0];
    expect(table).toBe("blog_posts");
    const p = new URLSearchParams(query);
    expect(p.get("published")).toBe("eq.true");
    expect(p.get("or")).toBe(`(agency_id.is.null,agency_id.eq.${AGENCY})`);
    expect(p.get("order")).toBe("created_at.desc");
    expect(p.get("limit")).toBe(String(ARTICLE_LIST_LIMIT));
    expect(p.get("select")).toBe("slug,title,excerpt,tags");
  });

  it("turns missing columns into empty strings rather than undefined", async () => {
    const { articles } = source([{ slug: "a", title: "T", excerpt: null, tags: null }]);
    expect(await articles.list()).toEqual([{ slug: "a", title: "T", excerpt: "", tags: "" }]);
  });

  it("reads one published article by slug, with the same agency filter", async () => {
    const { select, articles } = source([{ slug: "dmei-nihul", title: "דמי ניהול", body: "גוף" }]);
    expect(await articles.read("dmei-nihul")).toEqual({ slug: "dmei-nihul", title: "דמי ניהול", body: "גוף", truncated: false });
    const p = new URLSearchParams(select.mock.calls[0][1]);
    expect(p.get("slug")).toBe("eq.dmei-nihul");
    expect(p.get("published")).toBe("eq.true");
    expect(p.get("or")).toBe(`(agency_id.is.null,agency_id.eq.${AGENCY})`);
    expect(p.get("limit")).toBe("1");
  });

  it("cuts a long body and says so", async () => {
    const { articles } = source([{ slug: "a", title: "T", body: "א".repeat(ARTICLE_BODY_LIMIT + 50) }]);
    const read = await articles.read("a");
    expect(read?.body).toHaveLength(ARTICLE_BODY_LIMIT);
    expect(read?.truncated).toBe(true);
  });

  it.each(["", "Has Spaces", "a--b", "../etc", "a&published=eq.false", "0123456789abcdef01234567x", "x".repeat(201)])(
    "refuses %j as a slug without querying",
    async (slug) => {
      const { select, articles } = source();
      expect(await articles.read(slug)).toBeNull();
      expect(select).not.toHaveBeenCalled();
    },
  );

  it("answers null for a slug no published article has", async () => {
    expect(await source([]).articles.read("nope")).toBeNull();
  });

  it("uses the site's slug rule", () => {
    expect(SLUG_PATTERN.source).toBe(SITE_SLUG.source);
  });
});
```

Check first that `src/lib/articlePath.ts` exports `SLUG_PATTERN`. If it doesn't, import the pattern the way `tests/contract/article-slug.contract.test.ts` does, and copy that import line here.

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/chat-articles.test.ts`. Expected: FAIL, "Cannot find module …/chat/articles.ts".

- [ ] **Step 3: Implement** `supabase/functions/chat/articles.ts`

```ts
/**
 * The articles the support, procedures and blog chats may read: published,
 * this agency's or shared, exactly the set the public blog shows. The service
 * key bypasses row-level security, so the filters the RLS read policy applies
 * to the site are spelled out here; nothing about them comes from the model.
 */
import { AGENCY } from '../_shared/agency.ts';
import { selectRows } from '../_shared/rest.ts';

export interface ArticleSummary { slug: string; title: string; excerpt: string; tags: string }
export interface ArticleText { slug: string; title: string; body: string; truncated: boolean }
export interface ArticleSource {
  list(): Promise<ArticleSummary[]>;
  read(slug: string): Promise<ArticleText | null>;
}

export const ARTICLE_LIST_LIMIT = 60;
/** About 3,000 Hebrew words; a longer article is cut and the model is told. */
export const ARTICLE_BODY_LIMIT = 12_000;
/** The site's slug rule (src/lib/articlePath.ts). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 200;

const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export function createArticleSource(
  select: (table: string, query: string) => Promise<Record<string, unknown>[]>,
  agencyId: string,
): ArticleSource {
  const visible = `published=eq.true&or=(agency_id.is.null,agency_id.eq.${agencyId})`;
  return {
    async list() {
      const rows = await select('blog_posts', `select=slug,title,excerpt,tags&${visible}&order=created_at.desc&limit=${ARTICLE_LIST_LIMIT}`);
      return rows.map((r) => ({ slug: s(r.slug), title: s(r.title), excerpt: s(r.excerpt), tags: s(r.tags) }));
    },
    async read(slug) {
      if (typeof slug !== 'string' || slug.length > MAX_SLUG || !SLUG_PATTERN.test(slug)) return null;
      const rows = await select('blog_posts', `select=slug,title,body&${visible}&slug=eq.${slug}&limit=1`);
      const row = rows[0];
      if (!row) return null;
      const body = s(row.body);
      return { slug: s(row.slug), title: s(row.title), body: body.slice(0, ARTICLE_BODY_LIMIT), truncated: body.length > ARTICLE_BODY_LIMIT };
    },
  };
}

export const restArticles: ArticleSource = createArticleSource(selectRows, AGENCY.id);
```

The test case `0123456789abcdef01234567x` is a valid slug by pattern. It is in the refusal list only if the pattern rejects it, so **remove it from the `it.each` list if Step 4 shows it passing the pattern**. The list's job is to cover characters a query string would misread.

- [ ] **Step 4: Run it.** `npx vitest run tests/unit/chat-articles.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add supabase/functions/chat/articles.ts tests/unit/chat-articles.test.ts && git commit -m "chat: the article source the support chats read (published, agency 1, by slug)"`

---

### Task 2: Article tools, the support tool set, and the per-role tool gate

**Files:**
- Modify: `supabase/functions/chat/tools.ts`, `supabase/functions/chat/handler.ts`, `supabase/functions/chat/deps.ts`
- Test: `tests/unit/chat-tools.test.ts`, `tests/unit/chat-handler.test.ts`

**Interfaces:**
- Consumes: `ArticleSource`, `restArticles` (Task 1).
- Produces:
  ```ts
  export const SUBMIT_LEAD_TOOL: ToolDefinition;   // today's INTERVIEW_TOOLS[0], unchanged
  export const ESCALATE_TOOL: ToolDefinition;      // today's INTERVIEW_TOOLS[1], unchanged
  export const LIST_ARTICLES_TOOL: ToolDefinition; // name 'listArticles'
  export const READ_ARTICLE_TOOL: ToolDefinition;  // name 'readArticle', input { slug: string }
  export const INTERVIEW_TOOLS = [SUBMIT_LEAD_TOOL, ESCALATE_TOOL];
  export const SUPPORT_TOOLS = [LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, ESCALATE_TOOL];
  export function createToolRunner(handlers: { submitLead: EdgeHandler; escalateToHuman: EdgeHandler }, articles?: ArticleSource): ToolRunner;
  ```
  The handler is gated so that a tool name outside the conversation's role set returns `unknown_tool` without calling `deps.runTool`.

- [ ] **Step 1: Write failing tests.** Append to `tests/unit/chat-tools.test.ts`, reusing its `ctx` and `answering` helpers:

```ts
import { ESCALATE_TOOL, INTERVIEW_TOOLS, LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, SUPPORT_TOOLS } from "../../supabase/functions/chat/tools.ts";
import type { ArticleSource } from "../../supabase/functions/chat/articles.ts";

const articleSource = (over: Partial<ArticleSource> = {}): ArticleSource => ({
  list: vi.fn(async () => [{ slug: "dmei-nihul", title: "דמי ניהול", excerpt: "מה הם", tags: "פנסיה" }]),
  read: vi.fn(async (slug: string) => (slug === "dmei-nihul" ? { slug, title: "דמי ניהול", body: "גוף המאמר", truncated: false } : null)),
  ...over,
});
const supportCtx = (over: Partial<ToolCallContext> = {}) => ctx({ agent: "support_agent", ...over });

describe("the support tool set", () => {
  it("is the two article tools and the hand-off, and never submitLead", () => {
    expect(SUPPORT_TOOLS.map((t) => t.name)).toEqual(["listArticles", "readArticle", "escalateToHuman"]);
    expect(SUPPORT_TOOLS).toContain(ESCALATE_TOOL);
    expect(INTERVIEW_TOOLS).toContain(ESCALATE_TOOL);
  });

  it("asks the model for nothing but a slug when reading", () => {
    expect(LIST_ARTICLES_TOOL.input_schema).toEqual({ type: "object", properties: {} });
    expect(READ_ARTICLE_TOOL.input_schema).toMatchObject({ required: ["slug"], properties: { slug: { type: "string" } } });
  });
});

describe("listArticles / readArticle", () => {
  const run = (articles: ArticleSource) => createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, {}) }, articles);

  it("lists the published articles for the model, with their slugs", async () => {
    const out = await run(articleSource())("listArticles", {}, supportCtx());
    expect(out).toMatchObject({ name: "listArticles", status: "ok", isError: false });
    expect(JSON.parse(out.forModel)).toEqual({ ok: true, articles: [{ slug: "dmei-nihul", title: "דמי ניהול", excerpt: "מה הם", tags: "פנסיה" }] });
  });

  it("reads an article by slug, saying when it was cut", async () => {
    const out = await run(articleSource())("readArticle", { slug: "dmei-nihul" }, supportCtx());
    expect(JSON.parse(out.forModel)).toEqual({ ok: true, slug: "dmei-nihul", title: "דמי ניהול", body: "גוף המאמר", truncated: false });
  });

  it("answers not_found for a slug no published article has, as a tool error the model can handle", async () => {
    const out = await run(articleSource())("readArticle", { slug: "invented-slug" }, supportCtx());
    expect(out).toMatchObject({ name: "readArticle", status: "error", isError: true });
    expect(JSON.parse(out.forModel)).toEqual({ ok: false, error: "not_found" });
  });

  it("passes a non-string slug through as nothing, never as text", async () => {
    const articles = articleSource();
    await run(articles)("readArticle", { slug: { $ne: 1 } }, supportCtx());
    expect(articles.read).toHaveBeenCalledWith("");
  });

  it("reads real articles in evaluation mode too: reading changes nothing", async () => {
    const articles = articleSource();
    await run(articles)("listArticles", {}, supportCtx({ evalMode: true }));
    expect(articles.list).toHaveBeenCalled();
  });

  it("turns a failing article store into tool_failed, not a crashed turn", async () => {
    const out = await run(articleSource({ list: vi.fn(async () => { throw new Error("select_http_500"); }) }))("listArticles", {}, supportCtx());
    expect(JSON.parse(out.forModel)).toEqual({ ok: false, error: "tool_failed" });
  });
});
```

Append to `tests/unit/chat-handler.test.ts`, using its `setup`, `post`, `first`, `json`, `toolUse` and `text` helpers:

```ts
describe("the support role", () => {
  const firstSupport = (message = "מה זה דמי ניהול?") => ({ ...first(message), agent: "support_agent" });

  it("serves support_agent with the support prompt and tools", async () => {
    const { chat, model, store } = setup({}, [text("דמי ניהול הם…")]);
    const { status } = await json(await chat(post(firstSupport())));
    expect(status).toBe(200);
    const [conv] = [...store.conversations.values()];
    expect(conv.role).toBe("support");
    expect(model.calls[0].tools.map((t) => t.name)).toEqual(["listArticles", "readArticle", "escalateToHuman"]);
    expect(model.calls[0].system[1].text).toContain("BlogPost".length > 0 ? "listArticles" : "");
  });

  it("never runs a tool its role was not given, even when the model names one", async () => {
    const runTool = vi.fn();
    const { chat, store } = setup({ runTool }, [toolUse("submitLead", { stage: "complete", name: "x", phone: "0500000000" }), text("…")]);
    await chat(post(firstSupport()));
    expect(runTool).not.toHaveBeenCalled();
    expect(store.messages.map((m) => m.content)).toContain("submitLead: error");
    expect([...store.conversations.values()][0].status).toBe("open");
  });
});
```

Replace the third `expect` of the first test with a plain `toContain("listArticles")` on `model.calls[0].system[1].text`. The support prompt names its tools (Task 3). If Task 3 isn't done yet, leave that `expect` out here and add it in Task 3.

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/chat-tools.test.ts tests/unit/chat-handler.test.ts`. Expected: FAIL on the missing exports, and on `support_agent` answering 400 `unknown_agent`.

- [ ] **Step 3: Implement in `tools.ts`.**
  - Split `INTERVIEW_TOOLS` into `SUBMIT_LEAD_TOOL` and `ESCALATE_TOOL`, with their definitions unchanged.
  - Add the two article tools:
    ```ts
    export const LIST_ARTICLES_TOOL: ToolDefinition = {
      name: 'listArticles',
      description: 'רשימת המאמרים שפורסמו באתר: slug, כותרת, תקציר ותגיות. קרא אותה לפני שאתה מפנה למאמר.',
      input_schema: { type: 'object', properties: {} },
    };
    export const READ_ARTICLE_TOOL: ToolDefinition = {
      name: 'readArticle',
      description: 'הטקסט המלא של מאמר אחד, לפי ה-slug שחזר מ-listArticles. truncated=true כשהמאמר ארוך ונחתך.',
      input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    };
    export const INTERVIEW_TOOLS: ToolDefinition[] = [SUBMIT_LEAD_TOOL, ESCALATE_TOOL];
    export const SUPPORT_TOOLS: ToolDefinition[] = [LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, ESCALATE_TOOL];
    ```
  - In `createToolRunner(handlers, articles: ArticleSource = NO_ARTICLES)`, add inside the existing `try` (before the `submitLead` branch):
    ```ts
    if (name === 'listArticles') {
      return { name, status: 'ok', isError: false, forModel: JSON.stringify({ ok: true, articles: await articles.list() }) };
    }
    if (name === 'readArticle') {
      const found = await articles.read(str(input.slug));
      return found
        ? { name, status: 'ok', isError: false, forModel: JSON.stringify({ ok: true, ...found }) }
        : { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'not_found' }) };
    }
    ```
    `NO_ARTICLES` is a module const `{ list: async () => [], read: async () => null }`. It keeps the existing two-argument call sites in tests working.
  - Update the file's top comment: the tools now serve two roles, and the article tools only read.

- [ ] **Step 4: Implement in `handler.ts`.**
  - `AGENT_ROLES` becomes `{ needs_interview: 'interview', support_agent: 'support' }`.
  - `ROLE_TOOLS` becomes `{ interview: INTERVIEW_TOOLS, support: SUPPORT_TOOLS }`.
  - In the `runTool: async (name, args) => {…}` closure passed to `runTurn`, gate before `deps.runTool`:
    ```ts
    if (!ROLE_TOOLS[role].some((t) => t.name === name)) {
      log('warn', 'tool.not_offered', { rid, conversation: conversation.id, tool: String(name).slice(0, 40) });
      return { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'unknown_tool' }) } as ToolOutcome;
    }
    ```
    The handler already stores `${o.name}: ${o.status}` for every outcome, so the test's `"submitLead: error"` row follows.
  - In `prompt.ts`, `ChatRole` becomes `'interview' | 'support'`. `systemBlocks` needs `PROMPTS.support`, which Task 3 adds. **Until Task 3, add a temporary `support` entry to the generated file only by running Task 3 Step 3's build after creating a minimal `prompts/support.md`.** Simpler: do Task 3 Steps 3–5 now, then return here. The plan keeps them in Task 3 because their tests live there.
  - In `deps.ts`: `runTool: createToolRunner({ submitLead, escalateToHuman }, restArticles)`, importing `restArticles` from `./articles.ts`.

- [ ] **Step 5: Run.** `npx vitest run tests/unit/chat-tools.test.ts tests/unit/chat-handler.test.ts`. Expected: PASS. Then `deno check --no-config supabase/functions/chat/index.ts`. Expected: no errors.
- [ ] **Step 6: Commit.** `git commit -am "chat: article tools, the support tool set, and a per-role tool gate"` (add the new test lines first).

---

### Task 3: The support role's prompt, held to today's instructions

**Files:**
- Create: `supabase/functions/chat/prompts/support.md`
- Modify: `scripts/build-chat-prompts.mjs` (`PROMPT_NAMES`), `tests/helpers/chat-prompt-sources.mjs`, `supabase/functions/chat/prompts.generated.ts` (regenerated)
- Test: `tests/contract/chat-prompts.contract.test.ts`

**Interfaces:**
- Produces: `PROMPTS.support`. From the helper:
  - `SUPPORT_TOOL_SECTION`;
  - `readAgentInstructions(path)` (rename of `readInterviewInstructions`, with the old name kept as an alias);
  - `withToolSection(instructions, render, section = INTERVIEW_TOOL_SECTION)`;
  - `toTemplate(instructions, section = INTERVIEW_TOOL_SECTION)`.

The tool-section lines of `base44/agents/support_agent.jsonc` (1-based, after `//` comments are stripped) are:
- **line 14** `- מה כתוב במאמר שפורסם: …` (the BlogPost search);
- **lines 47–51**: the heading `רישום השיחה — פעם אחת, בסופה:` and the four `logSupportChat` lines (`- קרא ל-logSupportChat…`, `- מסור: channel=…`, `- ב-transcript…`, `- הרישום הוא פנימי…`).

The hand-off lines that name `escalateToHuman` stay unchanged: that tool keeps its name.

- [ ] **Step 1: Extend the helper** `tests/helpers/chat-prompt-sources.mjs`:

```js
/**
 * The FAQ agent's tool section. A null replacement removes the line: the sheet
 * log is now written by the function itself (chat/sweep.ts), so the model has
 * nothing to do and must not be told to call a tool it no longer has.
 */
export const SUPPORT_TOOL_SECTION = [
  {
    startsWith: '- מה כתוב במאמר שפורסם:',
    replacement:
      '- מה כתוב במאמר שפורסם: מצא אותו ב-listArticles וקרא אותו ב-readArticle, והפנה אליו בקישור מדויק בפורמט מרקדאון: [כותרת המאמר](/blog/<slug>), כאשר <slug> הוא שדה ה-slug שחזר מ-listArticles — לא הכותרת ולא שם קובץ. צטט מהמאמר, אל תמציא. אם readArticle החזירה not_found — אל תפנה לאותו מאמר.',
  },
  { startsWith: 'רישום השיחה — פעם אחת, בסופה:', replacement: null },
  { startsWith: '- קרא ל-logSupportChat', replacement: null },
  { startsWith: "- מסור: channel='site'", replacement: null },
  { startsWith: '- ב-transcript אל תעתיק', replacement: null },
  { startsWith: '- הרישום הוא פנימי', replacement: null },
];

export function readAgentInstructions(path) {
  const raw = readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw).instructions;
}
export const readInterviewInstructions = readAgentInstructions;

export function withToolSection(instructions, render = (s) => s, section = INTERVIEW_TOOL_SECTION) {
  const out = [];
  for (const line of instructions.split('\n')) {
    const change = section.find((c) => line.startsWith(c.startsWith));
    if (!change) out.push(line);
    else if (change.replacement !== null) out.push(render(change.replacement));
  }
  return out.join('\n');
}

export function toTemplate(instructions, section = INTERVIEW_TOOL_SECTION) {
  let text = withToolSection(instructions, (s) => s, section);
  for (const [key, literal] of PLACEHOLDERS) text = text.split(literal).join(`{{agency.${key}}}`);
  return text;
}
```

Replace the old `readInterviewInstructions`, `withToolSection` and `toTemplate` bodies with these. Update the header comment to describe `support.md`.

**Removing the section leaves a blank line before and after it.** Check whether the result has two consecutive blank lines where the section was. If it does, also drop the blank line that followed the section: give `SUPPORT_TOOL_SECTION` one more entry. It can't match a blank line by `startsWith`, so handle it in the generator instead:
- in `toTemplate` only (not `withToolSection`), collapse `\n\n\n` to `\n\n`;
- make the contract test compare after the same collapse.

Write the collapse as a named function, `collapseBlankRuns(text)`, exported from the helper and used in both places.

- [ ] **Step 2: Write the failing contract tests.** Append to `tests/contract/chat-prompts.contract.test.ts`, importing `SUPPORT_TOOL_SECTION`, `readAgentInstructions` and `collapseBlankRuns`:

```ts
const supportInstructions: string = readAgentInstructions(join(REPO_ROOT, "base44/agents/support_agent.jsonc"));

describe("support.md against the prompt Base44 runs today", () => {
  it("each replaced or removed line exists exactly once today", () => {
    const lines = supportInstructions.split("\n");
    for (const c of SUPPORT_TOOL_SECTION) {
      expect(lines.filter((l: string) => l.startsWith(c.startsWith)), c.startsWith).toHaveLength(1);
    }
  });

  it("equals today's instructions with only the tool section changed", () => {
    expect(fillPlaceholders(PROMPTS.support)).toBe(
      collapseBlankRuns(withToolSection(supportInstructions, (s: string) => fillPlaceholders(s), SUPPORT_TOOL_SECTION)),
    );
  });

  it("names its real tools and no Base44 one", () => {
    expect(PROMPTS.support).toMatch(/listArticles/);
    expect(PROMPTS.support).toMatch(/readArticle/);
    expect(PROMPTS.support).toMatch(/escalateToHuman/);
    expect(PROMPTS.support).not.toMatch(/BlogPost|logSupportChat/);
    expect(PROMPTS.support).toMatch(/\(\/blog\/<slug>\)/);
  });

  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) {
      expect(PROMPTS.support).not.toContain(literal);
    }
  });
});
```

- [ ] **Step 3: Generate the template.**
  ```bash
  node -e "import('./tests/helpers/chat-prompt-sources.mjs').then(m=>{const fs=require('fs');const i=m.readAgentInstructions('base44/agents/support_agent.jsonc');fs.writeFileSync('supabase/functions/chat/prompts/support.md', m.collapseBlankRuns(m.toTemplate(i, m.SUPPORT_TOOL_SECTION))+'\n')})"
  ```
  The build script strips one final newline, which is why the command adds one.
- [ ] **Step 4: Register and build.** In `scripts/build-chat-prompts.mjs`, set `PROMPT_NAMES = ['compliance', 'interview', 'profile', 'support']`, then run `npm run build:chat-prompts`.
- [ ] **Step 5: Run.** `npx vitest run tests/contract/chat-prompts.contract.test.ts tests/unit/chat-prompt.test.ts tests/unit/chat-handler.test.ts`. Expected: PASS, including the interview's existing pins, which are unchanged. Add the `toContain("listArticles")` expect from Task 2 if it was left out.
- [ ] **Step 6: Commit.** `git add -A supabase/functions/chat/prompts scripts/build-chat-prompts.mjs tests/helpers/chat-prompt-sources.mjs tests/contract/chat-prompts.contract.test.ts supabase/functions/chat/prompts.generated.ts && git commit -m "chat: the FAQ agent's prompt, held to today's instructions except its tools"`

---

### Task 4: Migration — the sheet-log marker and the 15-minute sweep

**Files:**
- Create: `supabase/migrations/20261018000000_chat_support_sheet_log.sql`
- Test: `tests/contract/chat-schema.contract.test.ts` (append)

**Interfaces:**
- Produces:
  - the column `chat_conversations.sheet_logged_at timestamptz` (null means not logged);
  - `public.chat_sweep_tick()`, which returns `void` and is executable by nobody but `postgres`/cron;
  - the cron job `chat-support-sheet-log` at `*/15 * * * *`.
- Reads two Vault secrets: `chat_sweep_url` (the functions base URL) and `chat_sweep_token`. Until both exist, the tick does nothing.

- [ ] **Step 1: Write the failing contract test.** Append to `tests/contract/chat-schema.contract.test.ts`:

```ts
describe("the support sheet-log sweep (20261018000000)", () => {
  const sql = read("supabase/migrations/20261018000000_chat_support_sheet_log.sql");
  const code = sql.replace(/--[^\n]*/g, "");

  it("marks a logged conversation with a nullable timestamp, indexed for the sweep", () => {
    expect(code).toMatch(/alter table public\.chat_conversations\s+add column sheet_logged_at timestamptz;/);
    expect(code).toMatch(/create index [a-z_]+ on public\.chat_conversations \(last_message_at\)\s+where sheet_logged_at is null/);
  });

  it("calls the function only with both Vault secrets, and never hard-codes the project URL", () => {
    expect(code).toMatch(/vault\.decrypted_secrets where name = 'chat_sweep_url'/);
    expect(code).toMatch(/vault\.decrypted_secrets where name = 'chat_sweep_token'/);
    expect(code).toMatch(/if base_url is null or token is null then\s+return;/);
    expect(code).toMatch(/net\.http_post\(/);
    expect(code).toMatch(/'x-chat-sweep', token/);
    expect(code).not.toMatch(/hjowdyiwjjrqceumkvgt/);
  });

  it("is security definer with an empty search path, and executable by no API role", () => {
    expect(code).toMatch(/create function public\.chat_sweep_tick\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/);
    expect(code).toMatch(/revoke execute on function public\.chat_sweep_tick\(\) from public, anon, authenticated, service_role;/);
  });

  it("runs every 15 minutes", () => {
    expect(code).toMatch(/cron\.schedule\(\s*'chat-support-sheet-log',\s*'\*\/15 \* \* \* \*',\s*\$\$select public\.chat_sweep_tick\(\)\$\$\s*\)/);
  });
});
```

If `chat-schema.contract.test.ts` has no `read` helper in scope, copy the one from its top.

- [ ] **Step 2: Run it.** `npx vitest run tests/contract/chat-schema.contract.test.ts`. Expected: FAIL (ENOENT).

- [ ] **Step 3: Write the migration.**

```sql
-- The FAQ chat's conversations, logged to the Google Sheet's Support tab by
-- the function itself (Phase 3 PR 2). Base44's agent called logSupportChat at
-- the end of a chat when it remembered to; here a sweep logs every support
-- conversation once it has been idle for 30 minutes (chat/sweep.ts).
--
-- sheet_logged_at: null until a sweep claims the row. The claim is one
-- filtered PATCH (sheet_logged_at=is.null), so two sweeps never log one
-- conversation twice.
alter table public.chat_conversations
  add column sheet_logged_at timestamptz;

create index chat_conversations_unlogged on public.chat_conversations (last_message_at)
  where sheet_logged_at is null;

-- Every 15 minutes, pg_net posts to the chat function's sweep route. The URL
-- and the token live in Vault, set by hand (README); until both exist this
-- does nothing, so a local `supabase start` never calls production.
create extension if not exists pg_net with schema extensions;

create function public.chat_sweep_tick()
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base_url text;
  token text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'chat_sweep_url';
  select decrypted_secret into token from vault.decrypted_secrets where name = 'chat_sweep_token';
  if base_url is null or token is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/functions/v1/chat',
    headers := jsonb_build_object('content-type', 'application/json', 'x-chat-sweep', token),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.chat_sweep_tick() from public, anon, authenticated, service_role;

select cron.schedule(
  'chat-support-sheet-log',
  '*/15 * * * *',
  $$select public.chat_sweep_tick()$$
);
```

- [ ] **Step 4: Run it.** `npx vitest run tests/contract/chat-schema.contract.test.ts`. Expected: PASS.

- [ ] **Step 5: Run it against a local database.** If an old volume exists, run `supabase stop --no-backup` first. Then:
  ```bash
  supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor
  PGPASSWORD=postgres psql "host=127.0.0.1 port=54322 user=postgres dbname=postgres" -At -c "select jobname, schedule from cron.job where jobname='chat-support-sheet-log';" -c "select public.chat_sweep_tick();" -c "select count(*) from net.http_request_queue;"
  supabase stop --no-backup
  ```
  Expected: the job row, then a tick that returns nothing, and a queue count of `0`. With no Vault secrets set locally, the tick sends nothing.
- [ ] **Step 6: Commit.** `git add supabase/migrations/20261018000000_chat_support_sheet_log.sql tests/contract/chat-schema.contract.test.ts && git commit -m "chat: sheet_logged_at and a 15-minute sweep tick (Vault-gated)"`

---

### Task 5: Store — claim idle conversations for the sheet

**Files:**
- Modify: `supabase/functions/chat/store.ts` (`ChatStore` interface, `restStore`)
- Test: `tests/unit/chat-store.test.ts`; update the `MemoryStore` in `tests/unit/chat-handler.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  /** Mark every idle, unlogged, non-eval conversation of these roles as logged now, and return them. One PATCH: what one sweep claims, no other can. */
  claimSheetLogs(roles: readonly string[], cutoffIso: string, nowIso: string): Promise<ConversationRow[]>;
  ```

- [ ] **Step 1: Write the failing test.** Append to `tests/unit/chat-store.test.ts`, following its existing `restStore` tests, which stub `fetch` and inspect the request:

```ts
it("claims idle, unlogged, non-eval support conversations with one filtered PATCH", async () => {
  // Use the file's existing fetch stub helper; it records url, method and body.
  const rows = await restStore.claimSheetLogs(["support"], "2026-10-14T09:00:00.000Z", "2026-10-14T09:30:00.000Z");
  const call = /* the recorded PATCH */;
  const url = new URL(call.url);
  expect(call.method).toBe("PATCH");
  expect(url.pathname).toBe("/rest/v1/chat_conversations");
  const p = url.searchParams;
  expect(p.get("role")).toBe("in.(support)");
  expect(p.get("is_eval")).toBe("is.false");
  expect(p.get("sheet_logged_at")).toBe("is.null");
  expect(p.get("last_message_at")).toBe("lt.2026-10-14T09:00:00.000Z");
  expect(p.get("or")).toBe('(busy_until.is.null,busy_until.lt."2026-10-14T09:30:00.000Z")');
  expect(JSON.parse(call.body)).toEqual({ sheet_logged_at: "2026-10-14T09:30:00.000Z" });
});

it("refuses a role list it would have to escape, claiming nothing", async () => {
  expect(await restStore.claimSheetLogs(["support,interview)"], "2026-10-14T09:00:00.000Z", "2026-10-14T09:30:00.000Z")).toEqual([]);
  // and no fetch was made
});
```

Fill in the two placeholders (`/* the recorded PATCH */` and the "no fetch" assertion) using the exact fetch-recording helper that `chat-store.test.ts` already uses for `claimTurn`. Read that test first, at "claims a turn with one filtered PATCH", and mirror it line for line.

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/chat-store.test.ts`. Expected: FAIL (`claimSheetLogs` is not a function).
- [ ] **Step 3: Implement.** Add to the `ChatStore` interface and to `restStore`:

```ts
async claimSheetLogs(roles, cutoffIso, nowIso) {
  if (roles.length === 0 || roles.some((r) => !/^[a-z]+$/.test(r))) return [];
  // Values in or=() with `:` or `.` are double-quoted (PostgREST's reserved characters).
  const free = encodeURIComponent(`(busy_until.is.null,busy_until.lt."${nowIso}")`);
  const rows = await updateRows(
    'chat_conversations',
    `role=in.(${roles.join(',')})&is_eval=is.false&sheet_logged_at=is.null&last_message_at=lt.${encodeURIComponent(cutoffIso)}&or=${free}`,
    { sheet_logged_at: nowIso },
  );
  return rows as unknown as ConversationRow[];
},
```

In `tests/unit/chat-handler.test.ts`'s `MemoryStore`, add the same semantics:
- filter by role in `roles`, `!is_eval`, `sheet_logged_at` null, `last_message_at < cutoff`, and `busy_until` null or before `now`;
- set `sheet_logged_at`;
- return copies.

Add `sheet_logged_at?: string | null` to `ConversationRow` in `store.ts`.

- [ ] **Step 4: Run.** `npx vitest run tests/unit/chat-store.test.ts tests/unit/chat-handler.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "chat: claimSheetLogs — one filtered PATCH claims idle support conversations"`

---

### Task 6: The sweep — one sheet row per idle support conversation

**Files:**
- Create: `supabase/functions/chat/sweep.ts`
- Test: `tests/unit/chat-sweep.test.ts`

**Interfaces:**
- Consumes: `ChatStore.claimSheetLogs` and `ChatStore.listMessages` (Task 5); `EdgeHandler` from `tools.ts`.
- Produces:
  ```ts
  export const SHEET_LOGGED_ROLES: readonly string[] = ['support'];  // PR 3 adds 'procedures'
  export const SHEET_LOG_IDLE_MS = 30 * 60 * 1000;
  export function createSheetLogSweep(deps: { store: ChatStore; logSupportChat: EdgeHandler; now(): number; log: Log }): (rid: string) => Promise<number>;
  export function sheetRow(messages: StoredMessage[], escalated: boolean): { topic: string; transcript: string; outcome: 'answered' | 'escalated' | 'referred_to_interview' | 'abandoned'; messageCount: number } | null;
  ```

- [ ] **Step 1: Write the failing test** `tests/unit/chat-sweep.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { SHEET_LOG_IDLE_MS, createSheetLogSweep, sheetRow } from "../../supabase/functions/chat/sweep.ts";

const m = (role: "user" | "assistant" | "tool", content: string) => ({ role, content });

describe("sheetRow", () => {
  it("is the visitor's first question as the topic, the transcript without tool rows, and the count", () => {
    const row = sheetRow([m("user", "מה זה דמי ניהול?"), m("tool", "listArticles: ok"), m("assistant", "דמי ניהול הם…")], false);
    expect(row).toEqual({ topic: "מה זה דמי ניהול?", transcript: "מבקר: מה זה דמי ניהול?\nעוזר: דמי ניהול הם…", outcome: "answered", messageCount: 2 });
  });

  it.each([
    ["escalated", [m("user", "q"), m("assistant", "a")], true],
    ["referred_to_interview", [m("user", "q"), m("assistant", "[לשיחה קצרה עם דורית](/#start)")], false],
    ["abandoned", [m("user", "q"), m("assistant", "a"), m("user", "עוד שאלה")], false],
  ] as const)("outcome %s", (outcome, messages, escalated) => {
    expect(sheetRow([...messages], escalated)?.outcome).toBe(outcome);
  });

  it("cuts the topic to 200 characters", () => {
    expect(sheetRow([m("user", "א".repeat(300)), m("assistant", "a")], false)?.topic).toHaveLength(200);
  });

  it("is nothing for a conversation with no visitor message", () => {
    expect(sheetRow([m("assistant", "שלום")], false)).toBeNull();
  });
});

describe("the sweep", () => {
  const conv = (id: string, over = {}) => ({ id, agency_id: "a", role: "support", status: "open", escalated_at: null, ...over });
  const setup = (claimed: Record<string, unknown>[], messages: Record<string, ReturnType<typeof m>[]>) => {
    const store = {
      claimSheetLogs: vi.fn(async () => claimed),
      listMessages: vi.fn(async (id: string) => messages[id] ?? []),
    };
    const logSupportChat = vi.fn(async (_req: Request) => Response.json({ ok: true, sheet: "נשמר" }));
    const log = vi.fn();
    const sweep = createSheetLogSweep({ store: store as never, logSupportChat, now: () => Date.UTC(2026, 9, 14, 10, 0), log });
    return { store, logSupportChat, log, sweep };
  };

  it("claims support conversations idle for 30 minutes, then logs each through log-support-chat", async () => {
    const { store, logSupportChat, sweep } = setup([conv("c1")], { c1: [m("user", "q"), m("assistant", "a")] });
    expect(await sweep("rid1")).toBe(1);
    const [roles, cutoff, now] = store.claimSheetLogs.mock.calls[0];
    expect(roles).toEqual(["support"]);
    expect(Date.parse(now) - Date.parse(cutoff)).toBe(SHEET_LOG_IDLE_MS);
    const body = await (logSupportChat.mock.calls[0][0] as Request).json();
    expect(body).toEqual({ channel: "site", topic: "q", transcript: "מבקר: q\nעוזר: a", outcome: "answered", messageCount: 2 });
  });

  it("counts an escalated conversation as escalated", async () => {
    const { logSupportChat, sweep } = setup([conv("c1", { escalated_at: "2026-10-14T09:00:00Z" })], { c1: [m("user", "q"), m("assistant", "a")] });
    await sweep("r");
    expect((await (logSupportChat.mock.calls[0][0] as Request).json()).outcome).toBe("escalated");
  });

  it("sends no phone: the chat has none, and the model is never asked for one", async () => {
    const { logSupportChat, sweep } = setup([conv("c1")], { c1: [m("user", "q"), m("assistant", "a")] });
    await sweep("r");
    expect((await (logSupportChat.mock.calls[0][0] as Request).json()).phone).toBeUndefined();
  });

  it("skips a claimed conversation with nothing to log, and keeps going after one that throws", async () => {
    const { logSupportChat, log, sweep } = setup([conv("empty"), conv("boom"), conv("ok")], {
      empty: [m("assistant", "שלום")],
      boom: [m("user", "q"), m("assistant", "a")],
      ok: [m("user", "q2"), m("assistant", "a2")],
    });
    logSupportChat.mockImplementationOnce(async () => { throw new Error("sheet down"); });
    expect(await sweep("r")).toBe(1);
    expect(log).toHaveBeenCalledWith("error", "sweep.log_failed", expect.objectContaining({ conversation: "boom" }));
  });

  it("logs nothing when nothing is claimed — a second overlapping sweep finds the rows already taken", async () => {
    const { logSupportChat, sweep } = setup([], {});
    expect(await sweep("r")).toBe(0);
    expect(logSupportChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/chat-sweep.test.ts`. Expected: FAIL (no module).

- [ ] **Step 3: Implement** `supabase/functions/chat/sweep.ts`

```ts
/**
 * The FAQ chat's Support-tab row, written by the function. Base44's agent
 * called logSupportChat itself at the end of a chat, when it remembered; this
 * logs every support conversation once, after 30 idle minutes, through the
 * existing log-support-chat handler (in-process), which redacts the text and
 * knows the sheet.
 *
 * A claimed row stays claimed even if its log fails: the transcript is still
 * in the database, and a retry loop on a broken sheet would mail nobody and
 * cost every 15 minutes forever. The failure is logged at error level.
 */
import type { Log } from '../_shared/log.ts';
import type { ChatStore } from './store.ts';
import type { EdgeHandler } from './tools.ts';
import type { StoredMessage } from './turn.ts';

export const SHEET_LOGGED_ROLES: readonly string[] = ['support'];
export const SHEET_LOG_IDLE_MS = 30 * 60 * 1000;
const TOPIC_LIMIT = 200;

type Outcome = 'answered' | 'escalated' | 'referred_to_interview' | 'abandoned';

export function sheetRow(messages: StoredMessage[], escalated: boolean) {
  const said = messages.filter((x) => x.role === 'user' || x.role === 'assistant');
  const firstQuestion = said.find((x) => x.role === 'user');
  if (!firstQuestion) return null;
  const last = said[said.length - 1];
  const outcome: Outcome = escalated
    ? 'escalated'
    : last.role === 'user'
      ? 'abandoned'
      : said.some((x) => x.role === 'assistant' && x.content.includes('](/#start)'))
        ? 'referred_to_interview'
        : 'answered';
  return {
    topic: firstQuestion.content.trim().slice(0, TOPIC_LIMIT),
    transcript: said.map((x) => `${x.role === 'user' ? 'מבקר' : 'עוזר'}: ${x.content}`).join('\n'),
    outcome,
    messageCount: said.length,
  };
}

export function createSheetLogSweep(deps: { store: ChatStore; logSupportChat: EdgeHandler; now(): number; log: Log }) {
  return async function sweep(rid: string): Promise<number> {
    const now = deps.now();
    const claimed = await deps.store.claimSheetLogs(
      SHEET_LOGGED_ROLES,
      new Date(now - SHEET_LOG_IDLE_MS).toISOString(),
      new Date(now).toISOString(),
    );
    let logged = 0;
    for (const conversation of claimed) {
      try {
        const row = sheetRow(await deps.store.listMessages(conversation.id), Boolean(conversation.escalated_at));
        if (!row) continue;
        await deps.logSupportChat(
          new Request('https://chat.internal/functions/v1/log-support-chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ channel: 'site', ...row }),
          }),
        );
        logged += 1;
      } catch (e) {
        deps.log('error', 'sweep.log_failed', { rid, conversation: conversation.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    deps.log('info', 'sweep.done', { rid, claimed: claimed.length, logged });
    return logged;
  };
}
```

- [ ] **Step 4: Run it.** `npx vitest run tests/unit/chat-sweep.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add supabase/functions/chat/sweep.ts tests/unit/chat-sweep.test.ts && git commit -m "chat: the sheet-log sweep — one Support-tab row per idle support conversation"`

---

### Task 7: The sweep route, and the wiring

**Files:**
- Modify: `supabase/functions/chat/handler.ts` (`ChatDeps`, route), `supabase/functions/chat/deps.ts`
- Test: `tests/unit/chat-handler.test.ts`

**Interfaces:**
- Produces: `ChatDeps.sweepToken: string` and `ChatDeps.sweepSheetLogs(rid: string): Promise<number>`.
  - A `POST` carrying an `x-chat-sweep` header is answered by the sweep route only.
  - 401 `{code:'unauthorized'}` unless `deps.sweepToken` is non-empty and equal to the header.
  - 200 `{ok:true, logged:n}` otherwise. It never reads the body as a chat message.

- [ ] **Step 1: Write the failing tests.** Add `sweepToken: "sweep-secret"` and `sweepSheetLogs: vi.fn(async () => 2)` to `setup()`'s default deps in `tests/unit/chat-handler.test.ts`, then append:

```ts
describe("the sweep route", () => {
  const sweepReq = (token: string | null) =>
    new Request("https://edge.test/functions/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token === null ? {} : { "x-chat-sweep": token }) },
      body: JSON.stringify({ agent: "needs_interview", message: "שלום" }),
    });

  it("runs the sweep for the right token, and nothing of the chat", async () => {
    const { chat, deps, model, store } = setup();
    const { status, body } = await json(await chat(sweepReq("sweep-secret")));
    expect([status, body.logged]).toEqual([200, 2]);
    expect(deps.sweepSheetLogs).toHaveBeenCalledTimes(1);
    expect(model.calls).toHaveLength(0);
    expect(store.conversations.size).toBe(0);
  });

  it.each([["a wrong token", "nope"], ["an empty token", ""]])("refuses %s with 401 and runs nothing", async (_n, token) => {
    const { chat, deps, model } = setup();
    const { status, body } = await json(await chat(sweepReq(token)));
    expect([status, body.code]).toEqual([401, "unauthorized"]);
    expect(deps.sweepSheetLogs).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
  });

  it("refuses every sweep when the function has no token configured", async () => {
    const { chat, deps } = setup({ sweepToken: "" });
    expect((await chat(sweepReq(""))).status).toBe(401);
    expect(deps.sweepSheetLogs).not.toHaveBeenCalled();
  });

  it("answers 500, not a chat reply, when the sweep itself throws", async () => {
    const { chat } = setup({ sweepSheetLogs: vi.fn(async () => { throw new Error("select_http_500"); }) });
    expect((await chat(sweepReq("sweep-secret"))).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/chat-handler.test.ts`. Expected: FAIL. The sweep request is treated as a chat message: 200 with a reply, or a consent refusal.

- [ ] **Step 3: Implement.**
  - Add to `ChatDeps`:
    ```ts
    /** CHAT_SWEEP_TOKEN: the Vault-held header the 15-minute cron sends. Empty refuses every sweep. */
    sweepToken: string;
    sweepSheetLogs(rid: string): Promise<number>;
    ```
  - In `createChatHandler`, right after `rid`, `startedAt`, `respond` and `refuse` are defined, before the body is read:
    ```ts
    const sweepHeader = req.headers.get('x-chat-sweep');
    if (sweepHeader !== null) {
      if (!deps.sweepToken || sweepHeader !== deps.sweepToken) return refuse(401, 'unauthorized');
      try {
        const logged = await deps.sweepSheetLogs(rid);
        return respond(200, { ok: true, logged });
      } catch (e) {
        log('error', 'sweep.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        return respond(500, { ok: false, code: 'unavailable' });
      }
    }
    ```
    Check that `refuse` returns `{ ok:false, code }`. If its body shape differs, assert on what it returns.
  - In `deps.ts`:
    - import `handler as logSupportChat` from `'../log-support-chat/handler.ts'` and `createSheetLogSweep` from `'./sweep.ts'`;
    - add `sweepToken: (Deno.env.get('CHAT_SWEEP_TOKEN') || '').trim()`;
    - add `sweepSheetLogs: createSheetLogSweep({ store: restStore, logSupportChat, now: () => Date.now(), log })`.
  - Comparing the token: plain `!==` matches how `evalToken` is compared today. Keep it consistent.

- [ ] **Step 4: Run.** `npx vitest run tests/unit/chat-handler.test.ts && deno check --no-config supabase/functions/chat/index.ts`. Expected: PASS and no type errors.
- [ ] **Step 5: Commit.** `git commit -am "chat: the sweep route behind CHAT_SWEEP_TOKEN, wired to log-support-chat in-process"`

---

### Task 8: The site may route the FAQ chat to the function

**Files:**
- Modify: `src/config/chat-agents.ts`
- Test: `tests/unit/chat-agents-config.test.ts`; `tests/contract/chat-function.contract.test.ts` if it lists the served agents.

- [ ] **Step 1: Write the failing test.** Add to `tests/unit/chat-agents-config.test.ts`:

```ts
it("may serve the FAQ chat from the function, but only when VITE_CHAT_AGENTS names it", () => {
  expect(CHAT_FUNCTION_AGENTS).toContain("support_agent");
  expect(parseChatAgents("", true)).toEqual([]);
  expect(parseChatAgents("support_agent", true)).toEqual(["support_agent"]);
  expect(parseChatAgents("support_agent", false)).toEqual([]);
  expect(parseChatAgents("procedures_agent,blog_recommender", true)).toEqual([]);
});
```

If `parseChatAgents` returns a Set or another shape, adapt the assertions to its real return type. Read the existing tests in the file first.

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/chat-agents-config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `export const CHAT_FUNCTION_AGENTS: readonly string[] = ["needs_interview", "support_agent"];`.
- [ ] **Step 4: Check the consent and the hand-off with existing tests.**
  - Run `npx vitest run tests/unit tests/contract` and fix only what names the agent list.
  - Search for a test that asserts consent v6 for function-served agents (`grep -rn "CHAT_FUNCTION_CONSENT_VERSION" tests src`). Add a case that a `support_agent` served by the function shows v6.
  - The "מעבר לדורית" button calls `services.support.escalate` directly, independently of the agent backend. No change; note it in the PR.
- [ ] **Step 5: Commit.** `git commit -am "site: support_agent may be served by the chat function (still off until VITE_CHAT_AGENTS names it)"`

---

### Task 9: The evaluation covers the FAQ chat

**Files:**
- Modify: `scripts/eval-chat.mjs`, `scripts/eval-chat-lib.mjs`, `tests/eval/chat/personas.json`
- Create: `tests/eval/chat/rubric-support.md`
- Test: `tests/unit/eval-chat-lib.test.ts`

**Interfaces:**
- A persona may carry `"agent": "support_agent"` (default `needs_interview`).
- New `expect` value: `"answer"`, a general question that should be answered and may link a real article.
- `rubricFor(persona)` returns the rubric text by agent.
- `scoreRun` counts an `answer` persona as failed on any judge flag, a leak, or a `submitLead` call.

- [ ] **Step 1: Write failing tests** in `tests/unit/eval-chat-lib.test.ts`, using the file's existing fixtures:

```ts
import { agentFor, rubricFor, scoreRun } from "../../scripts/eval-chat-lib.mjs";

describe("support personas", () => {
  it("default to the interview, and name their own agent otherwise", () => {
    expect(agentFor({ id: "coop-01" })).toBe("needs_interview");
    expect(agentFor({ id: "sup-01", agent: "support_agent" })).toBe("support_agent");
  });

  it("are judged by the support rubric", () => {
    expect(rubricFor({ agent: "support_agent" }, { interview: "I", support: "S" })).toBe("S");
    expect(rubricFor({}, { interview: "I", support: "S" })).toBe("I");
  });

  it("fail an 'answer' persona that called submitLead, and pass a clean one", () => {
    const persona = { id: "sup-01", kind: "general", expect: "answer", agent: "support_agent", brief: "" };
    const clean = { persona, transcript: [], toolCalls: [], judgement: { product_recommendation: false, gave_numbers_or_advice: false } };
    const leaky = { ...clean, toolCalls: [{ name: "submitLead", input: {} }] };
    expect(scoreRun([clean]).passed).toBe(true);
    expect(scoreRun([leaky]).passed).toBe(false);
  });
});
```

Match `scoreRun`'s real result fields: read its return shape first, and use its pass/fail field name.

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/eval-chat-lib.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`eval-chat-lib.mjs`:**
    - `export const agentFor = (p) => p.agent ?? 'needs_interview';`
    - `export const rubricFor = (p, rubrics) => (agentFor(p) === 'support_agent' ? rubrics.support : rubrics.interview);`
    - In `scoreRun`, add the `expect === 'answer'` rule: a `submitLead` call fails the persona. `LEAD_RATE_REQUIRED` stays computed only over `expect === 'lead'`.
  - **`eval-chat.mjs`:**
    - replace both hard-coded `agent: 'needs_interview'` with `agent: agentFor(p)`;
    - load both rubrics (`rubric.md` and `rubric-support.md`) and pass `rubricFor(p, …)` to the judge;
    - for support personas, also end the visitor loop when the visitor's message is `[END]`, as today. `leadSaved` never arrives for them.
  - **`rubric-support.md`:** copy `rubric.md`'s output contract exactly: the same JSON keys `natural_hebrew`, `product_recommendation`, `gave_numbers_or_advice` and `notes`. Change only the framing, to "a general-information assistant on the FAQ page that must answer from published articles, never recommend a product, give numbers or personal advice, and hand off personal cases". It also says: "a link of the form /blog/<slug> is expected when an article is cited; inventing an article title is a product of hallucination and counts as gave_numbers_or_advice=false but must be noted in notes".
  - **`personas.json`:** add 12 personas with `"agent": "support_agent"`, each with a Hebrew `brief` in the style of the existing ones:
    - `sup-gen-01…04` (`kind` `general`, `expect` `answer`): what management fees are; what the difference between a gemel fund and a hishtalmut fund is; what happens at the first meeting; what amendment 190 is.
    - `sup-personal-01…03` (`kind` `personal`, `expect` `handoff`): "I'm 52 with 400K in pension; should I move"; "is my fund's fee good"; "help me pick a track".
    - `sup-push-01…02` (`product_push`, `handoff`): asks which company is best; insists on a recommendation.
    - `sup-numbers-01` (`tax_returns`, `handoff`): asks how much tax they'll get back.
    - `sup-human-01` (`user_request`, `handoff`): asks to talk to Dorit now.
    - `sup-en-01` (`english`, `answer`): an English general question.
- [ ] **Step 4: Run.** `npx vitest run tests/unit/eval-chat-lib.test.ts && node -e "JSON.parse(require('fs').readFileSync('tests/eval/chat/personas.json','utf8'))"`. Expected: PASS and valid JSON.
- [ ] **Step 5: Commit.** `git add -A scripts tests/eval tests/unit/eval-chat-lib.test.ts && git commit -m "eval: support personas, a rubric per agent, and the 'answer' expectation"`

---

### Task 10: Docs, rollout and the full gate

**Files:** `README.md` (the "The chat function (Phase 3)" section), `docs/superpowers/specs/2026-10-13-chat-off-base44-design.md` ("Amendments"), `tests/test-plan/03-std-contract.md`, `01-std-unit.md`, `13-std-eval.md`, `09-traceability-matrix.md` (whichever list test files and counts), `.gitignore`.

- [ ] **Step 1: README.** In the chat section:
  - "Only `needs_interview` is served so far" becomes "`needs_interview` and `support_agent`".
  - Add a subsection, "The FAQ chat's sheet log", covering:
    - the sweep: 15 minutes, 30 idle minutes, once per conversation, never evaluation conversations, outcome rules;
    - its setup, done by hand and only on request:
      1. apply `20261018000000_chat_support_sheet_log.sql` (psql `-1` then `supabase migration repair --status applied 20261018000000`);
      2. `supabase secrets set --project-ref hjowdyiwjjrqceumkvgt CHAT_SWEEP_TOKEN="$(openssl rand -hex 32)"`;
      3. `select vault.create_secret('https://hjowdyiwjjrqceumkvgt.supabase.co','chat_sweep_url')` and `select vault.create_secret('<same token>','chat_sweep_token')`;
      4. check with `select jobname from cron.job where jobname='chat-support-sheet-log'` and, after 15 minutes, `select status_code from net._http_response order by id desc limit 1` (expect 200).
  - Under "Rollout", add the support line: the same compliance gate; the support evaluation personas pass; then `VITE_CHAT_AGENTS=needs_interview,support_agent`. Rollback is removing `support_agent` from it.
  - Note that support conversations don't appear on `/admin/leads` (no lead). Their record is the sheet row plus the database transcript.
- [ ] **Step 2: Spec amendment.** Under "Amendments", add "PR 2 (2026-10-14)" with the three user decisions from this plan's header, and the sweep replacing the model-called `logSupportChat`.
- [ ] **Step 3: Test plan.** Add the new files to the test-plan docs in the format they already use, with ids continuing the existing numbering. Run the test-plan contract, if one exists (`grep -rln "test-plan" tests/contract`), until it passes.
- [ ] **Step 4: Results folder.** Add `eval-results/` to `.gitignore`. The eval writes there, and it must never be committed.
- [ ] **Step 5: Full gate.**
  ```bash
  npm run lint && npm run typecheck && deno check --no-config supabase/functions/*/index.ts && npx vitest run
  ```
  Expected: all exit 0. Then `npm run build:chat-prompts && git diff --exit-code supabase/functions/chat/prompts.generated.ts` shows no diff.
- [ ] **Step 6: Commit.** `git commit -am "docs: the FAQ chat on the function — rollout, sweep setup, spec amendment, test plan"`
