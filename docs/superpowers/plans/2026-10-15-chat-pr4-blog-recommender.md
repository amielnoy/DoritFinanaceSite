# Chat PR 4 — the blog recommender on the `chat` function — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `blog_recommender` (the reading recommender on /blog) from the Supabase `chat` function, its hidden ```` ```recommended ```` block replaced by a `recommendArticles` tool — shipped dark behind `VITE_CHAT_AGENTS`.

**Architecture:** A fourth role, `blog`, with the article tools, a new `recommendArticles` tool and the hand-off. `recommendArticles({ slugs })` keeps at most three slugs that `readArticle` would find (published, the agency's) and the turn's answer carries them as `recommended`. The site's adapter (`SupabaseAgentService`) appends them to the reply as the same ```` ```recommended ```` block the page already reads, so `/blog` keeps one protocol for both backends; the page matches a card by its `slug` as well as its `id`. No migration (`chat_conversations.role` allows `'blog'`); not sheet-logged (Base44's recommender never logged).

**Tech Stack:** Deno Edge Function (TypeScript), React 18 + Vite, Vitest, the chat eval scripts.

**Spec:** `docs/superpowers/specs/2026-10-13-chat-off-base44-design.md` — "Amendments during PR 2": *PR 4 is `blog_recommender`*; *the blog recommender's hidden block becomes a `recommend_articles` tool in PR 4.* Pattern: PR 3 (#232) and its plan `docs/superpowers/plans/2026-10-15-chat-pr3-procedures-agent.md`.

## Global Constraints

- `blog.md` is `blog_recommender.jsonc`'s instructions byte for byte apart from `BLOG_TOOL_SECTION` (`tests/helpers/chat-prompt-sources.mjs`), with `{{agency.*}}` placeholders. Change both, or neither.
- Each role gets only its own tools (`ROLE_TOOLS`); anything else answers `unknown_tool`.
- The tool's name is `recommendArticles` (camelCase like the others; the spec's `recommend_articles` is the same tool).
- At most 3 recommended slugs per turn, each one `readArticle` would find; never an id or slug the store does not hold.
- Every agent in `CHAT_FUNCTION_AGENTS` has a v6 notice in `CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT`; `CHAT_FUNCTION_CONSENT_VERSION` stays `"2026-10-agents-v6"`.
- Ships dark. Before pushing: lint, typecheck, `build:prerender`, the five suites, `deno check --no-config supabase/functions/*/index.ts`.

## Review Focus

1. **The model recommends a slug that does not exist, or six of them.** Expected: unknown slugs dropped, at most three kept, the page narrows to those it has. Test in Task 2.
2. **The model writes a ```` ```recommended ```` block in its reply anyway** (Base44 habit). Expected: the page still reads it and the chat still hides it — `readRecommendation` handles any block; but the function must not *double* it. Test in Task 3 (adapter: an answer with both keeps one block).
3. **A recommendation in a turn whose reply later fails (503).** Expected: no `recommended` on a failed turn; the page is not narrowed to articles the visitor never saw named. Test in Task 2.
4. **The page holds Base44 ids for older posts and slugs for new ones.** Expected: a card matches by `slug` or `id`. Test in Task 3.
5. **The recommender's notice.** Expected: its two adviser-approved lines plus the v6 line naming the AI provider and the 12 months — never the interview's "נאספים שם וטלפון". Test in Task 3.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/helpers/chat-prompt-sources.mjs` | modify | `BLOG_TOOL_SECTION`; `withToolSection` also matches `{ equals }` (the fence's bare ```` ``` ```` line) |
| `supabase/functions/chat/prompts/blog.md`, `scripts/build-chat-prompts.mjs`, `prompts.generated.ts` | create / modify / regenerate | The prompt |
| `supabase/functions/chat/tools.ts` | modify | `RECOMMEND_ARTICLES_TOOL`, `BLOG_TOOLS`, the runner case, `ToolOutcome.recommended` |
| `supabase/functions/chat/prompt.ts`, `handler.ts` | modify | `ChatRole` `'blog'`; `AGENT_ROLES.blog_recommender`; `ROLE_TOOLS.blog`; `recommended` in the 200 answer |
| `src/services/supabase/SupabaseAgentService.ts` | modify | Append the block from `answer.recommended` |
| `src/pages/Blog.tsx` | modify | Match by `slug` or `id` |
| `src/config/chat-agents.ts`, `src/config/compliance.ts` | modify | Routing; `CHAT_FUNCTION_BLOG_CONSENT_POINTS` |
| eval files, docs, test plan | modify / create | As each task says |

---

### Task 1: The prompt

**Files:** `tests/helpers/chat-prompt-sources.mjs`, create `supabase/functions/chat/prompts/blog.md`, `scripts/build-chat-prompts.mjs:12`, regenerate `prompts.generated.ts`; Test: `tests/contract/chat-prompts.contract.test.ts`

**Interfaces:** Produces `BLOG_TOOL_SECTION`; `PROMPTS.blog`; `withToolSection` accepting entries `{ equals, replacement }` beside `{ startsWith, replacement }`.

- [ ] **Step 1: Failing contract tests** — append, importing `BLOG_TOOL_SECTION`:

```ts
const blogInstructions: string = readAgentInstructions(join(REPO_ROOT, "base44/agents/blog_recommender.jsonc"));
const matches = (l: string, c: { startsWith?: string; equals?: string }) => (c.equals !== undefined ? l === c.equals : l.startsWith(c.startsWith!));

describe("blog.md against the prompt Base44 runs today", () => {
  it("each replaced or removed line exists exactly once today", () => {
    const lines = blogInstructions.split("\n");
    for (const c of BLOG_TOOL_SECTION) expect(lines.filter((l: string) => matches(l, c)), JSON.stringify(c).slice(0, 60)).toHaveLength(1);
  });

  it("equals today's instructions with only the tool section changed", () => {
    expect(fillPlaceholders(PROMPTS.blog)).toBe(
      collapseBlankRuns(withToolSection(blogInstructions, (s: string) => fillPlaceholders(s), BLOG_TOOL_SECTION)),
    );
  });

  it("recommends through the tool, never a fenced block, and names no Base44 tool", () => {
    expect(PROMPTS.blog).toMatch(/recommendArticles/);
    expect(PROMPTS.blog).toMatch(/listArticles/);
    expect(PROMPTS.blog).toMatch(/escalateToHuman/);
    expect(PROMPTS.blog).not.toMatch(/```recommended|BlogPost/);
    expect(PROMPTS.blog).toMatch(/\(\/blog\/<slug>\)/);
  });

  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) expect(PROMPTS.blog).not.toContain(literal);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/contract/chat-prompts.contract.test.ts` — FAIL (`BLOG_TOOL_SECTION` undefined).

- [ ] **Step 3:** In `chat-prompt-sources.mjs`, make `withToolSection` find a change by `c.equals !== undefined ? line === c.equals : line.startsWith(c.startsWith)`, and add (lines of `blog_recommender.jsonc` today: 11, 12, 14, 16–18, 20):

```js
/**
 * The reading recommender's tool section. BlogPost reads become listArticles /
 * readArticle; the hidden ```recommended block becomes the recommendArticles
 * tool — the function returns the slugs, and the site's adapter hands the page
 * the same block it always read (SupabaseAgentService).
 */
export const BLOG_TOOL_SECTION = [
  {
    startsWith: '   a. קרא תחילה רק את המאמרים',
    replacement: '   a. קרא תחילה את רשימת המאמרים שפורסמו ב-listArticles, ובחר תחילה מאמרים שהתגיות שלהם נוגעות לנושא שעלה מהשיחה (פנסיה, מיסוי, ביטוח, וכו\').',
  },
  {
    startsWith: '   b. אם לא מצאת מספיק מאמרים',
    replacement: '   b. קרא ב-readArticle את המאמרים המתאימים ביותר מהרשימה כדי לאתר התאמות עמוקות יותר לפי התוכן.',
  },
  {
    startsWith: '5. בחר עד 3 מאמרים רלוונטיים ביותר.',
    replacement:
      "5. בחר עד 3 מאמרים רלוונטיים ביותר. לכל מאמר, כתוב: הכותרת, משפט קצר משלך שמסביר למה הוא רלוונטי למה שנאמר בשיחה, וקישור לקריאה בתחביר מרקדאון: [קריאת המאמר](/blog/<slug>), כאשר <slug> הוא שדה ה-slug שחזר מ-listArticles (זהו קישור אמיתי שהמבקר יכול ללחוץ עליו). בכל הודעה שבה המלצת על מאמרים קרא גם ל-recommendArticles עם slugs — מערך של עד 3 ה-slug שהמלצת עליהם, בסדר הרלוונטיות; הדף מבליט אותם וגולל אליהם. אם לא המלצת על אף מאמר — אל תקרא לה. אל תזכיר את הקריאה במילים.",
  },
  { startsWith: '```recommended', replacement: null },
  { startsWith: '["", "", ""]', replacement: null },
  { equals: '```', replacement: null },
  { startsWith: 'מערך JSON תקין בלבד של עד 3 ה-id', replacement: null },
];
```

Add the header comment line (`blog.md = … the BlogPost reads name listArticles/readArticle and the recommended block becomes recommendArticles`). Generate `blog.md` with the same one-liner PR 3 used (`toTemplate(readAgentInstructions('base44/agents/blog_recommender.jsonc'), BLOG_TOOL_SECTION)` through `collapseBlankRuns`), set `PROMPT_NAMES` to `[…, 'procedures', 'blog']`, run `npm run build:chat-prompts`. Grep `blog.md` for any remaining `BlogPost` or ``` and, if found outside the section, add that line to `BLOG_TOOL_SECTION` (PR 3 found one such line) and ledger it.

- [ ] **Step 4:** Run the contract test — PASS. Read `blog.md` once by eye around step 5.
- [ ] **Step 5:** Commit `"Chat PR 4: the blog recommender's prompt, the hidden block now a tool call"`.

### Task 2: `recommendArticles` and the `blog` role

**Files:** `supabase/functions/chat/tools.ts`, `prompt.ts:10`, `handler.ts:29-31` and the 200 answer (~285); Test: `tests/unit/chat-tools.test.ts`, `tests/unit/chat-handler.test.ts`

**Interfaces:** Produces `RECOMMEND_ARTICLES_TOOL`, `BLOG_TOOLS = [LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, RECOMMEND_ARTICLES_TOOL, ESCALATE_TOOL]`, `ToolOutcome.recommended?: string[]`, `ChatRole` `'blog'`, the 200 answer's `recommended?: string[]` (present only when non-empty).

- [ ] **Step 1: Failing tests** — `chat-tools.test.ts` (the runner takes the article source as its second argument; use a fake `ArticleSource` whose `read(slug)` returns an article for `"dmei-nihul"`, `"tikun-190"`, `"pensia"`, `"kupat-gemel"` and null otherwise):

```ts
describe("recommendArticles", () => {
  it("keeps the slugs the store has, in order, at most three", async () => {
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, {}) }, fakeArticles);
    const out = await run("recommendArticles", { slugs: ["dmei-nihul", "made-up", "tikun-190", "pensia", "kupat-gemel"] }, ctx());
    expect(out).toMatchObject({ status: "ok", isError: false, recommended: ["dmei-nihul", "tikun-190", "pensia"] });
    expect(JSON.parse(out.forModel)).toMatchObject({ ok: true, recommended: ["dmei-nihul", "tikun-190", "pensia"], dropped: ["made-up"] });
  });

  it("refuses a call with no slug it can show", async () => {
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, {}) }, fakeArticles);
    for (const input of [{}, { slugs: "dmei-nihul" }, { slugs: ["nope", 7] }]) {
      expect(await run("recommendArticles", input, ctx())).toMatchObject({ status: "error", isError: true });
    }
  });
});
```

`chat-handler.test.ts`, a `describe("the blog role")` beside "the procedures role":

```ts
  it("serves blog_recommender with the article tools, recommendArticles and the hand-off", async () => {
    const { chat, model, store } = setup({}, [text("הנה מאמר…")]);
    expect((await json(await chat(post({ ...first("על דמי ניהול"), agent: "blog_recommender" })))).status).toBe(200);
    expect([...store.conversations.values()][0].role).toBe("blog");
    expect(model.calls[0].tools.map((t) => t.name)).toEqual(["listArticles", "readArticle", "recommendArticles", "escalateToHuman"]);
  });

  it("answers with the recommended slugs of the turn, and none on a turn that failed", async () => {
    const runTool = vi.fn(async () => ({ name: "recommendArticles", status: "ok", isError: false, forModel: "{}", recommended: ["dmei-nihul"] }));
    const ok = setup({ runTool }, [toolUse("recommendArticles", { slugs: ["dmei-nihul"] }), text("הנה…")]);
    expect((await json(await ok.chat(post({ ...first("x"), agent: "blog_recommender" })))).body.recommended).toEqual(["dmei-nihul"]);
    const failed = setup({ runTool }, [toolUse("recommendArticles", { slugs: ["dmei-nihul"] })]); // no closing reply → 503
    const res = await json(await failed.chat(post({ ...first("x"), agent: "blog_recommender" })));
    expect(res.status).toBe(503);
    expect(res.body.recommended).toBeUndefined();
  });
```

(If `setup`'s scripted model needs a different shape to end a turn without a reply, follow the file's existing 503 test.)

- [ ] **Step 2:** Run both files — FAIL (unknown tool / unknown agent).
- [ ] **Step 3: Implement.** In `tools.ts`:

```ts
export const RECOMMEND_ARTICLES_TOOL: ToolDefinition = {
  name: 'recommendArticles',
  description: 'מסמן לדף את המאמרים שהמלצת עליהם בהודעה הזו, כדי שיבליט אותם: עד 3 slug שחזרו מ-listArticles, בסדר הרלוונטיות.',
  input_schema: { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, required: ['slugs'] },
};
export const BLOG_TOOLS: ToolDefinition[] = [LIST_ARTICLES_TOOL, READ_ARTICLE_TOOL, RECOMMEND_ARTICLES_TOOL, ESCALATE_TOOL];
/** At most this many articles highlighted per turn — the prompt's "עד 3". */
export const RECOMMEND_LIMIT = 3;
```

`ToolOutcome` gains `/** recommendArticles: the slugs the page should highlight. */ recommended?: string[];`. In the runner, before `submitLead`:

```ts
      if (name === 'recommendArticles') {
        const asked = Array.isArray(input.slugs) ? input.slugs.filter((v): v is string => typeof v === 'string') : [];
        const kept: string[] = [];
        const dropped: string[] = [];
        for (const slug of [...new Set(asked)]) {
          if (kept.length >= RECOMMEND_LIMIT) break;
          if (await articles.read(slug)) kept.push(slug);
          else dropped.push(slug);
        }
        return kept.length
          ? { name, status: 'ok', isError: false, recommended: kept, forModel: JSON.stringify({ ok: true, recommended: kept, dropped }) }
          : { name, status: 'error', isError: true, forModel: JSON.stringify({ ok: false, error: 'no_known_article', dropped }) };
      }
```

`prompt.ts`: `ChatRole = 'interview' | 'support' | 'procedures' | 'blog'`. `handler.ts`: `AGENT_ROLES.blog_recommender = 'blog'`; `ROLE_TOOLS.blog = BLOG_TOOLS`; in the 200 answer, after `leadSaved`:

```ts
          // The articles this turn highlighted, last call wins — the adapter hands them to the page.
          ...(recommended.length ? { recommended } : {}),
```

with `const recommended = [...outcomes].reverse().find((o) => o.recommended?.length)?.recommended ?? [];` beside `leadSaved`. The 503 path is unchanged (no `recommended`).

- [ ] **Step 4:** Run the two test files and `deno check --no-config supabase/functions/chat/index.ts` — PASS.
- [ ] **Step 5:** Commit `"Chat PR 4: recommendArticles and the blog role"`.

### Task 3: The site — adapter, page, routing, notice

**Files:** `src/services/supabase/SupabaseAgentService.ts` (~23, ~86), `src/pages/Blog.tsx:128-135`, `src/config/chat-agents.ts`, `src/config/compliance.ts`; Test: `tests/unit/supabase-agent-service.test.ts` (or the adapter's existing test file — find it with `grep -rl SupabaseAgentService tests/unit`), `tests/unit/chat-agents-config.test.ts`, `tests/component/blog-recommendation-filter.test.tsx`, create `tests/component/chat-function-blog.test.tsx`

**Interfaces:** Consumes the 200 answer's `recommended`. Produces `CHAT_FUNCTION_BLOG_CONSENT_POINTS`.

- [ ] **Step 1: Failing tests.**
  - Adapter: an answer `{ ok: true, reply: "הנה…", recommended: ["dmei-nihul", "tikun-190"] }` publishes an assistant message whose `readRecommendation(content)` gives `ids ["dmei-nihul","tikun-190"]` and `visible "הנה…"`; an answer with no `recommended` is unchanged; a reply that already carries a ```` ```recommended ```` block is not given a second one.
  - Blog page (`blog-recommendation-filter.test.tsx`): a `recommended` block naming a post's **slug** narrows the grid to that post, as one naming its id does.
  - Config: `CHAT_FUNCTION_AGENTS` contains `blog_recommender`; `CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.blog_recommender` is `CHAT_FUNCTION_BLOG_CONSENT_POINTS` = `[BLOG_RECOMMENDER_CONSENT_POINTS[0], BLOG_RECOMMENDER_CONSENT_POINTS[1], CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3]]`, never containing "נאספים שם וטלפון". Update `UNIT-CHCONFIG-003/005`'s "cannot serve" example to an agent name the function does not know (e.g. `"some_other_agent"`).
  - `chat-function-blog.test.tsx`: the procedures component test with `blog_recommender` / `AGENTS.blogRecommender` and `CHAT_FUNCTION_BLOG_CONSENT_POINTS` (read the descriptor's own start-button and placeholder strings from `src/config/agents.ts:163`).
- [ ] **Step 2:** Run them — FAIL.
- [ ] **Step 3: Implement.**
  - `SupabaseAgentService`: `recommended?: string[]` on the answer type; when it is a non-empty string array and the reply has no ```` ```recommended ```` block, publish `content: \`${answer.reply}\n\n\`\`\`recommended\n${JSON.stringify(answer.recommended)}\n\`\`\`\``. Comment: the page's one protocol for both backends (`src/lib/blog-recommendation.ts`).
  - `Blog.tsx` `recommended` memo: `const byKey = new Map(posts.flatMap((p) => [[p.id, p], ...(p.slug ? [[p.slug, p] as const] : [])]));` and look ids up in `byKey`; update the comment (a recommendation names a post by slug from the chat function, by id from Base44).
  - `chat-agents.ts`: add `"blog_recommender"`. `compliance.ts`: `CHAT_FUNCTION_BLOG_CONSENT_POINTS` (doc comment: the adviser-approved two lines of 2026-10-10 plus the v6 line; `TODO(compliance)` like the others) and the map entry.
- [ ] **Step 4:** Run the tests and `npm run -s test:contract` — PASS.
- [ ] **Step 5:** Commit `"Chat PR 4: the page reads the function's recommendations; routing and the v6 notice"`.

### Task 4: The eval

**Files:** `tests/eval/chat/personas.json`, create `tests/eval/chat/rubric-blog.md`, `scripts/eval-chat-lib.mjs` (`RUBRIC_BY_AGENT`), `scripts/eval-chat.mjs` (the `rubrics` object; `visitorSystem`'s answer-only list), `tests/unit/eval-chat-lib.test.ts`

- [ ] **Step 1: Failing tests** — `rubricFor({ agent: "blog_recommender" }, { …, blog: "B" })` is `"B"`; the persona file has four `blog-*` personas (update the counts: 53 personas); `pickForReview` includes `blog_recommender`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** `RUBRIC_BY_AGENT.blog_recommender = 'blog'`; load `rubric-blog.md`; `visitorSystem` treats `blog_recommender` as answer-only. Personas (`"agent": "blog_recommender"`, fake data only):
  - `blog-01` `answer`, kind `general`: wants to read about דמי ניהול; leaves after links.
  - `blog-02` `answer`, kind `vague`: "something about retirement"; answers one clarifying question.
  - `blog-03` `handoff`, kind `product_push`: wants to know which fund to pick; `phone` `050-000-0032`, gives it when offered Dorit.
  - `blog-04` `answer`, kind `english`: asks in English for an article on tikun 190.
  `rubric-blog.md`: `rubric-support.md` with the role changed — recommends up to three published articles with a one-sentence reason and a `/blog/<slug>` link that `listArticles` returned, asks at most one clarifying question and never about the visitor's money or products; same JSON contract. Add: an "answer" persona with no `recommendArticles` call while articles were named is noted in `notes`.
- [ ] **Step 4:** Run — PASS. Add a scoring rule: an `answer` persona of `blog_recommender` fails without a `recommendArticles` call (`${id}: recommended nothing the page could highlight`), with its test.
- [ ] **Step 5:** Commit `"Chat PR 4: four blog personas and their rubric"`.

### Task 5: Docs and the test plan

README (the chat function serves all four agents; the recommended block now from the tool, re-encoded by the adapter), AGENTS.md (prompt-equality line: `blog.md` / `BLOG_TOOL_SECTION`), the spec ("Amendments during PR 4": `recommendArticles` name; the adapter re-encodes; slug matching on the page; not sheet-logged), `src/lib/blog-recommendation.ts`'s header (two producers now), test-plan rows (01, 02, 03, 09, 13). Run the whole gate; commit `"Chat PR 4: docs and the test plan"`.

## After merge (the user's steps)

1. CI deploys the function. 2. `EVAL_ONLY=blog-01,blog-02,blog-03,blog-04 node scripts/eval-chat.mjs` and read the transcripts. 3. Add `blog_recommender` to `VITE_CHAT_AGENTS`, redeploy through CI. With all four agents on the function, `VITE_CONTENT_WRITES=supabase` becomes possible (N-03).
