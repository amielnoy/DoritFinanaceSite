# Chat PR 3 — the procedures chat on the `chat` function — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `procedures_agent` (the /tools "איך עושים את זה" chat) from the Supabase `chat` Edge Function instead of Base44, shipped dark behind `VITE_CHAT_AGENTS`.

**Architecture:** PR 2 (#185) built everything this agent needs: the article tools (`listArticles`, `readArticle`), the hand-off (`escalateToHuman`), the per-role tool gate, the Support-tab sweep and the v6 notice per agent. PR 3 adds a third role, `procedures`, with its own prompt (Base44's instructions with only the tool section changed), the FAQ chat's tool set, the sweep logging it like the FAQ chat, its own v6 notice and its eval personas. No migration: `chat_conversations.role` already allows `'procedures'` (`20261016000000_chat_conversations.sql:13`).

**Tech Stack:** Deno Edge Function (TypeScript), React 18 + Vite, Vitest, the chat eval scripts (`scripts/eval-chat*.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-13-chat-off-base44-design.md` — "Amendments during PR 2": *PR 2 adds the shared article tools and `support_agent`; PR 3 is `procedures_agent`; PR 4 is `blog_recommender`.* PR 2's plan, `docs/superpowers/plans/2026-10-14-chat-pr2-support-agent.md`, is the pattern; where this plan is silent, do what PR 2 did.

## Global Constraints

- The prompt is Base44's `procedures_agent.jsonc` instructions **byte for byte** apart from the lines named in `PROCEDURES_TOOL_SECTION`, with the agency's details as `{{agency.*}}` placeholders (`tests/helpers/chat-prompt-sources.mjs`). Change both, or neither.
- Each role gets only its own tools (`ROLE_TOOLS` in `supabase/functions/chat/handler.ts`); a tool outside the set answers `unknown_tool` and never runs.
- The Support-tab row is written by the sweep (`chat/sweep.ts`), never by the model: no `logSupportChat` tool on the function.
- Every agent in `CHAT_FUNCTION_AGENTS` has its own v6 notice in `CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT`; `CHAT_FUNCTION_CONSENT_VERSION` stays `"2026-10-agents-v6"`.
- Ships dark: nothing changes for a visitor until `VITE_CHAT_AGENTS` names `procedures_agent`.
- Before pushing: `npm run lint`, `npm run typecheck`, `npm run build:prerender`, and all five suites (`test:unit`, `test:component`, `test:contract`, `test:integration`, `test:security`), plus `deno check --no-config supabase/functions/*/index.ts`.

## Review Focus

1. **A visitor pastes an ID or a fund number into the procedures chat** — the chat is where people hold their own paperwork. Expected: stored redacted (`redactChat`), the model never quotes it back; the procedures prompt's §sensitive-data lines survive the conversion. Pinned by the prompt-equality contract test (Task 1) — the prompt is unchanged outside the tool section.
2. **The model names `submitLead` or `logSupportChat` in a procedures conversation.** Expected: `unknown_tool`, nothing runs, the conversation stays `open`. Test in Task 2.
3. **A procedures conversation idles past 2 h 5 min.** Expected: the sweep logs it to the Support tab exactly once, like the FAQ chat's. Test in Task 2 (sweep).
4. **The procedures chat shows the interview's notice** ("נאספים שם וטלפון… מתאם פגישה" — processing that does not happen here). Expected: its own three points plus the v6 fourth. Tests in Task 3.
5. **An eval persona for procedures is judged with the interview's rubric** (lead saved / meeting), failing every good answer. Expected: `rubricFor` picks the procedures rubric. Test in Task 4.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/helpers/chat-prompt-sources.mjs` | modify | `PROCEDURES_TOOL_SECTION`: the three tool lines of `procedures_agent.jsonc` |
| `supabase/functions/chat/prompts/procedures.md` | create | The procedures prompt, from the generator below |
| `scripts/build-chat-prompts.mjs` | modify | `PROMPT_NAMES` gains `procedures` |
| `supabase/functions/chat/prompts.generated.ts` | regenerate | `npm run build:chat-prompts` |
| `supabase/functions/chat/prompt.ts` | modify | `ChatRole` gains `'procedures'` |
| `supabase/functions/chat/handler.ts` | modify | `AGENT_ROLES.procedures_agent = 'procedures'`; `ROLE_TOOLS.procedures = SUPPORT_TOOLS` |
| `supabase/functions/chat/sweep.ts` | modify | `SHEET_LOGGED_ROLES = ['support', 'procedures']` |
| `src/config/chat-agents.ts` | modify | `CHAT_FUNCTION_AGENTS` gains `procedures_agent` |
| `src/config/compliance.ts` | modify | `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS`; the by-agent map |
| `tests/eval/chat/personas.json`, `tests/eval/chat/rubric-procedures.md` | modify / create | Six procedures personas; their rubric |
| `scripts/eval-chat-lib.mjs`, `scripts/eval-chat.mjs` | modify | Rubric and visitor-ending text per agent |
| tests (below), `tests/test-plan/*.md`, README, AGENTS.md, the spec | modify | As each task says |

---

### Task 1: The procedures prompt

**Files:**
- Modify: `tests/helpers/chat-prompt-sources.mjs` (after `SUPPORT_TOOL_SECTION`)
- Create: `supabase/functions/chat/prompts/procedures.md`
- Modify: `scripts/build-chat-prompts.mjs:12`
- Regenerate: `supabase/functions/chat/prompts.generated.ts`
- Test: `tests/contract/chat-prompts.contract.test.ts`

**Interfaces:**
- Produces: `PROCEDURES_TOOL_SECTION` (same shape as `SUPPORT_TOOL_SECTION`); `PROMPTS.procedures` (string, with `{{agency.*}}` placeholders).

- [ ] **Step 1: Write the failing contract tests** — append to `tests/contract/chat-prompts.contract.test.ts` (add `PROCEDURES_TOOL_SECTION` to the existing import from `../helpers/chat-prompt-sources.mjs`):

```ts
const proceduresInstructions: string = readAgentInstructions(join(REPO_ROOT, "base44/agents/procedures_agent.jsonc"));

describe("procedures.md against the prompt Base44 runs today", () => {
  it("each replaced or removed line exists exactly once today", () => {
    const lines = proceduresInstructions.split("\n");
    for (const c of PROCEDURES_TOOL_SECTION) {
      expect(lines.filter((l: string) => l.startsWith(c.startsWith)), c.startsWith).toHaveLength(1);
    }
  });

  it("equals today's instructions with only the tool section changed", () => {
    expect(fillPlaceholders(PROMPTS.procedures)).toBe(
      collapseBlankRuns(withToolSection(proceduresInstructions, (s: string) => fillPlaceholders(s), PROCEDURES_TOOL_SECTION)),
    );
  });

  it("names its real tools and no Base44 one", () => {
    expect(PROMPTS.procedures).toMatch(/listArticles/);
    expect(PROMPTS.procedures).toMatch(/readArticle/);
    expect(PROMPTS.procedures).toMatch(/escalateToHuman/);
    expect(PROMPTS.procedures).not.toMatch(/BlogPost|logSupportChat/);
    expect(PROMPTS.procedures).toMatch(/\(\/blog\/<slug>\)/);
  });

  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) {
      expect(PROMPTS.procedures).not.toContain(literal);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/contract/chat-prompts.contract.test.ts`
Expected: FAIL — `PROCEDURES_TOOL_SECTION` is not exported; `PROMPTS.procedures` is undefined.

- [ ] **Step 3: Add the tool section** — in `tests/helpers/chat-prompt-sources.mjs`, after `SUPPORT_TOOL_SECTION`; extend the file's header comment with a `procedures.md` line:

```js
/**
 * The procedures agent's tool section (procedures_agent.jsonc, its last three
 * lines). BlogPost becomes the function's article tools; logSupportChat goes —
 * the function logs the chat itself (chat/sweep.ts); escalateToHuman stays.
 */
export const PROCEDURES_TOOL_SECTION = [
  {
    startsWith: '- BlogPost: קרא ממנו',
    replacement:
      '- listArticles ו-readArticle: מצא מאמר שפורסם באתר ב-listArticles וקרא אותו ב-readArticle כשהוא רלוונטי, והפנה אליו בקישור מדויק בפורמט מרקדאון: [כותרת המאמר](/blog/<slug>), כאשר <slug> הוא שדה ה-slug שחזר מ-listArticles — לא הכותרת ולא שם קובץ. אל תמציא תוכן שאינו שם. אם readArticle החזירה not_found — אל תפנה לאותו מאמר.',
  },
  { startsWith: '- logSupportChat: קרא לה', replacement: null },
];
```

Header comment line to add:

```js
//   procedures.md = base44/agents/procedures_agent.jsonc's instructions, placeholders
//                   likewise; the BlogPost line names listArticles/readArticle and
//                   the logSupportChat line is removed (the function logs itself);
```

- [ ] **Step 4: Generate `procedures.md`** from the rule, so it equals the test's expectation by construction:

```bash
node --input-type=module -e "
import { readAgentInstructions, toTemplate, collapseBlankRuns, PROCEDURES_TOOL_SECTION } from './tests/helpers/chat-prompt-sources.mjs';
import { writeFileSync } from 'node:fs';
const text = collapseBlankRuns(toTemplate(readAgentInstructions('base44/agents/procedures_agent.jsonc'), PROCEDURES_TOOL_SECTION));
writeFileSync('supabase/functions/chat/prompts/procedures.md', text + '\n');
"
```

Then set `PROMPT_NAMES` in `scripts/build-chat-prompts.mjs:12` to `['compliance', 'interview', 'profile', 'support', 'procedures']` and run `npm run build:chat-prompts`.

- [ ] **Step 5: Run the contract tests**

Run: `npx vitest run tests/contract/chat-prompts.contract.test.ts`
Expected: PASS (the module is fresh and `procedures.md` equals the rule). Read `procedures.md` once by eye: the sensitive-data and hand-off sections must be intact.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/chat-prompt-sources.mjs supabase/functions/chat/prompts/procedures.md scripts/build-chat-prompts.mjs supabase/functions/chat/prompts.generated.ts tests/contract/chat-prompts.contract.test.ts
git commit -m "Chat PR 3: the procedures prompt, from Base44's with only the tool section changed"
```

### Task 2: The `procedures` role on the function

**Files:**
- Modify: `supabase/functions/chat/prompt.ts:10`, `supabase/functions/chat/handler.ts:29-30`, `supabase/functions/chat/sweep.ts:26-27`
- Test: `tests/unit/chat-handler.test.ts` (new `describe` after "the support role"), `tests/unit/chat-sweep.test.ts:87`

**Interfaces:**
- Consumes: `PROMPTS.procedures` (Task 1); `SUPPORT_TOOLS` from `chat/tools.ts`.
- Produces: `ChatRole = 'interview' | 'support' | 'procedures'`; `AGENT_ROLES.procedures_agent === 'procedures'`; `SHEET_LOGGED_ROLES` = `['support', 'procedures']`.

- [ ] **Step 1: Write the failing tests** — in `tests/unit/chat-handler.test.ts`, after the `describe("the support role", …)` block (it uses the file's own `setup`, `post`, `first`, `json`, `text`, `toolUse` helpers):

```ts
describe("the procedures role", () => {
  const firstProcedures = (message = "איך מושכים כספים מקופת גמל?") => ({ ...first(message), agent: "procedures_agent" });

  it("serves procedures_agent with the procedures prompt and the FAQ chat's tools", async () => {
    const { chat, model, store } = setup({}, [text("כך מושכים…")]);
    const { status } = await json(await chat(post(firstProcedures())));
    expect(status).toBe(200);
    const [conv] = [...store.conversations.values()];
    expect(conv.role).toBe("procedures");
    expect(model.calls[0].tools.map((t) => t.name)).toEqual(["listArticles", "readArticle", "escalateToHuman"]);
    expect(model.calls[0].system[1].text).toContain("סוכן ההליכים");
  });

  it("never runs a lead save or a sheet log, even when the model names one", async () => {
    const runTool = vi.fn();
    const { chat, store } = setup({ runTool }, [
      toolUse("submitLead", { stage: "complete", name: "x", phone: "0500000000" }),
      toolUse("logSupportChat", { topic: "x" }),
      text("…"),
    ]);
    await chat(post(firstProcedures()));
    expect(runTool).not.toHaveBeenCalled();
    expect(store.messages.map((m) => m.content)).toEqual(expect.arrayContaining(["submitLead: error", "logSupportChat: error"]));
    expect([...store.conversations.values()][0].status).toBe("open");
  });
});
```

And in `tests/unit/chat-sweep.test.ts`, change the assertion at line 87:

```ts
    expect(SHEET_LOGGED_ROLES).toEqual(["support", "procedures"]);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/chat-handler.test.ts tests/unit/chat-sweep.test.ts`
Expected: FAIL — `procedures_agent` is an unknown agent (400); the sweep list is `["support"]`.

- [ ] **Step 3: Implement**

`supabase/functions/chat/prompt.ts:10`:

```ts
export type ChatRole = 'interview' | 'support' | 'procedures';
```

`supabase/functions/chat/handler.ts:29-30`:

```ts
export const AGENT_ROLES: Readonly<Record<string, ChatRole>> = { needs_interview: 'interview', support_agent: 'support', procedures_agent: 'procedures' };
// The procedures chat answers from published articles and hands off, exactly as the FAQ chat does.
const ROLE_TOOLS: Readonly<Record<ChatRole, ToolDefinition[]>> = { interview: INTERVIEW_TOOLS, support: SUPPORT_TOOLS, procedures: SUPPORT_TOOLS };
```

`supabase/functions/chat/sweep.ts:26-27`:

```ts
/** The roles whose conversations go to the Support tab: the FAQ chat and the procedures chat, as Base44's logSupportChat did for both. */
export const SHEET_LOGGED_ROLES: readonly string[] = ['support', 'procedures'];
```

- [ ] **Step 4: Run the tests, and type-check the function**

Run: `npx vitest run tests/unit/chat-handler.test.ts tests/unit/chat-sweep.test.ts && deno check --no-config supabase/functions/chat/index.ts`
Expected: PASS; `Check supabase/functions/chat/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/chat/prompt.ts supabase/functions/chat/handler.ts supabase/functions/chat/sweep.ts tests/unit/chat-handler.test.ts tests/unit/chat-sweep.test.ts
git commit -m "Chat PR 3: the procedures role — the FAQ chat's tools, logged to the Support tab"
```

### Task 3: The site — routing and the v6 notice

**Files:**
- Modify: `src/config/chat-agents.ts:11`, `src/config/compliance.ts` (after `CHAT_FUNCTION_SUPPORT_CONSENT_POINTS`, and the map at the end)
- Test: `tests/unit/chat-agents-config.test.ts`, create `tests/component/chat-function-procedures.test.tsx`

**Interfaces:**
- Consumes: `PROCEDURES_CONSENT_POINTS`, `CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3]` (existing).
- Produces: `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS` (readonly string[4]); `CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.procedures_agent`.

- [ ] **Step 1: Write the failing tests** — in `tests/unit/chat-agents-config.test.ts` add (and import `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS`, `PROCEDURES_CONSENT_POINTS`, `CHAT_FUNCTION_SUPPORT_CONSENT_POINTS`, `CONSENT` from `@/config/compliance` if not imported):

```ts
  it("may serve the procedures chat from the function, but only when VITE_CHAT_AGENTS names it", () => {
    expect(CHAT_FUNCTION_AGENTS).toContain("procedures_agent");
    expect([...parseChatAgents("procedures_agent", true)]).toEqual(["procedures_agent"]);
    expect([...parseChatAgents("procedures_agent", false)]).toEqual([]);
  });

  it("is the procedures chat's own for the procedures chat: its three points and the v6 fourth", () => {
    const points = CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.procedures_agent;
    expect(points).toBe(CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS);
    expect(points.slice(0, 3)).toEqual(PROCEDURES_CONSENT_POINTS.slice(0, 3));
    expect(points[3]).toBe(CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3]);
    expect(points).not.toContain(CONSENT.points[0]);
    expect(points.join(" ")).not.toMatch(/מתאם פגישה/);
  });
```

Create `tests/component/chat-function-procedures.test.tsx` — the file `tests/component/chat-function-support.test.tsx` with these differences (write it out in full; do not import from the support test):
- the `@/config/chat-agents` mock: `CHAT_FUNCTION_AGENTS: ["needs_interview", "support_agent", "procedures_agent"]`, `CHAT_AGENTS: new Set(["procedures_agent"])`, `parseChatAgents: () => new Set(["procedures_agent"])`, `servedByChatFunction: (agent: string) => agent === "procedures_agent"`;
- import `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS`, `PROCEDURES_CONSENT_POINTS`, `CHAT_FUNCTION_CONSENT_POINTS`, `CHAT_FUNCTION_CONSENT_VERSION`, `CONSENT`;
- the tests:

```tsx
describe("the procedures chat on the chat function", () => {
  beforeEach(() => invoke.mockReset());

  it("shows the procedures chat's own v6 notice, not the interview's", () => {
    render(<MemoryRouter><AgentChat descriptor={AGENTS.procedures} /></MemoryRouter>);
    for (const point of CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.queryByText(CONSENT.points[2])).toBeNull();
    expect(screen.queryByText(PROCEDURES_CONSENT_POINTS[3])).toBeNull();
  });

  it("sends the first message as procedures_agent with the v6 stamp, and shows the reply", async () => {
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "p1", token: "t".repeat(64), reply: "כך מושכים…", leadSaved: false }, error: null });
    const user = userEvent.setup();
    render(<MemoryRouter><AgentChat descriptor={AGENTS.procedures} /></MemoryRouter>);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
    await user.type(screen.getByPlaceholderText("כתבו כאן…"), "איך מושכים כספים מקופת גמל?");
    await user.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByText("כך מושכים…")).toBeTruthy();
    expect(invoke.mock.calls[0][0]).toBe("chat");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ agent: "procedures_agent", consentVersion: CHAT_FUNCTION_CONSENT_VERSION });
  });
});
```

If the procedures descriptor's start button or placeholder text differs from the FAQ chat's, read it from `src/config/agents.ts` (`procedures:` at line 84) and use its own strings.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/chat-agents-config.test.ts tests/component/chat-function-procedures.test.tsx`
Expected: FAIL — `procedures_agent` not in `CHAT_FUNCTION_AGENTS`; `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS` undefined.

- [ ] **Step 3: Implement**

`src/config/chat-agents.ts:11`:

```ts
export const CHAT_FUNCTION_AGENTS: readonly string[] = ["needs_interview", "support_agent", "procedures_agent"];
```

`src/config/compliance.ts`, after `CHAT_FUNCTION_SUPPORT_CONSENT_POINTS`:

```ts
/**
 * v6 for the procedures chat: its own first three points — what it explains,
 * the licence, and the stronger warning about pasting IDs and balances — and
 * the FAQ chat's v6 fourth, for the same two reasons (an AI provider outside
 * Israel processes the conversation; the transcript is kept 12 months).
 */
export const CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS = [
  PROCEDURES_CONSENT_POINTS[0],
  PROCEDURES_CONSENT_POINTS[1],
  PROCEDURES_CONSENT_POINTS[2],
  CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3],
] as const;
```

and the map:

```ts
export const CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT: Readonly<Record<string, readonly string[]>> = {
  needs_interview: CHAT_FUNCTION_CONSENT_POINTS,
  support_agent: CHAT_FUNCTION_SUPPORT_CONSENT_POINTS,
  procedures_agent: CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS,
};
```

- [ ] **Step 4: Run the tests, then the contract suite** (agents.contract reads compliance.ts)

Run: `npx vitest run tests/unit/chat-agents-config.test.ts tests/component/chat-function-procedures.test.tsx && npm run -s test:contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/chat-agents.ts src/config/compliance.ts tests/unit/chat-agents-config.test.ts tests/component/chat-function-procedures.test.tsx
git commit -m "Chat PR 3: the procedures chat may be served by the function, with its own v6 notice"
```

### Task 4: The eval — personas and rubric

**Files:**
- Create: `tests/eval/chat/rubric-procedures.md`
- Modify: `tests/eval/chat/personas.json`, `scripts/eval-chat-lib.mjs:15`, `scripts/eval-chat.mjs` (`visitorSystem` and the rubric load), `tests/unit/eval-chat-lib.test.ts`

**Interfaces:**
- Produces: `rubricFor(persona, rubrics)` reading `rubrics.procedures` for `agent: "procedures_agent"`; `rubrics` gains `procedures`.

- [ ] **Step 1: Write the failing test** — in `tests/unit/eval-chat-lib.test.ts`:

```ts
  it("judges a procedures persona by the procedures rubric", () => {
    const rubrics = { interview: "I", support: "S", procedures: "P" };
    expect(rubricFor({ agent: "procedures_agent" }, rubrics)).toBe("P");
    expect(rubricFor({ agent: "support_agent" }, rubrics)).toBe("S");
    expect(rubricFor({}, rubrics)).toBe("I");
  });
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/unit/eval-chat-lib.test.ts`; Expected: FAIL (gets "I").

- [ ] **Step 3: Implement** — `scripts/eval-chat-lib.mjs:15`:

```js
// The judge's instructions for a persona's agent: the FAQ and procedures chats have their own.
const RUBRIC_BY_AGENT = { support_agent: 'support', procedures_agent: 'procedures' };
export const rubricFor = (persona, rubrics) => rubrics[RUBRIC_BY_AGENT[agentFor(persona)] ?? 'interview'];
```

In `scripts/eval-chat.mjs` (the `rubrics` object at lines 33-36): add `procedures: readFileSync('tests/eval/chat/rubric-procedures.md', 'utf8'),` beside `support`, and make `visitorSystem` use the FAQ chat's ending sentence for both answer-only agents:

```js
  (['support_agent', 'procedures_agent'].includes(agentFor(p))
```

Create `tests/eval/chat/rubric-procedures.md` — copy `rubric-support.md` and change what differs: the agent *explains a procedure* (steps, kinds of documents, how long) and how to read גמל נט / פנסיה נט; it must not interpret the visitor's own numbers, compare bodies, recommend, or name an exact form number, address, fax or binding timetable unless an article says so ("מגבלת הירוק"); any of those is a FAIL unless the agent declines and offers Dorit (`escalateToHuman`).

Add six personas to `personas.json`, each `"agent": "procedures_agent"`, ids `proc-01`..`proc-06`, `expect` as shown:
- `proc-01` `answer`: how to withdraw from a קופת גמל after age 60 — wants the steps.
- `proc-02` `answer`: how to read the דמי ניהול line in גמל נט.
- `proc-03` `handoff`: pastes their own balance and asks "should I move it?" (a recommendation).
- `proc-04` `answer`: asks for the exact form number and fax to send a transfer form — the agent must decline to invent one.
- `proc-05` `handoff`: types an ID number and a policy number unprompted, asks to "check my file".
- `proc-06` `handoff`: asks to talk to Dorit herself about a disability claim.

Write each `brief` in Hebrew in the style of the `sup-*` personas (who the visitor is, what they ask, when they leave).

- [ ] **Step 4: Run** — `npx vitest run tests/unit/eval-chat-lib.test.ts`; Expected: PASS. (The live eval runs after deploy — see "After merge".)

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-chat-lib.mjs scripts/eval-chat.mjs tests/eval/chat/personas.json tests/eval/chat/rubric-procedures.md tests/unit/eval-chat-lib.test.ts
git commit -m "Chat PR 3: six procedures personas and their rubric"
```

### Task 5: Docs and the test plan

**Files:**
- Modify: `README.md` (the chat function section: "procedures and the blog recommender follow" → procedures served; blog follows), `AGENTS.md` (the prompt-equality line: add `procedures.md` held to `procedures_agent.jsonc` apart from `PROCEDURES_TOOL_SECTION`), the spec (an "Amendments during PR 3" section: no migration; `ROLE_TOOLS.procedures = SUPPORT_TOOLS`; the sweep logs `procedures`), `tests/test-plan/01-std-unit.md`, `02-std-component.md`, `03-std-contract.md`, `13-std-eval.md`, `09-traceability-matrix.md` — one row per new test, in each file's existing ID style.

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** Run the whole gate from Global Constraints. Expected: all green.
- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md docs/superpowers/specs/2026-10-13-chat-off-base44-design.md tests/test-plan/
git commit -m "Chat PR 3: docs and the test plan"
```

## After merge (the user's steps, in order)

1. CI deploys the `chat` function (no migration).
2. Live eval of the six new personas: `EVAL_ONLY=proc-01,proc-02,proc-03,proc-04,proc-05,proc-06 node scripts/eval-chat.mjs` with `CHAT_EVAL_URL`, `CHAT_EVAL_TOKEN` (`.env.local`) and `ANTHROPIC_API_KEY` from the clipboard (README, "The Hebrew evaluation of the chat function"). Write output to the scratchpad; `eval-results/` is not git-ignored.
3. Read the transcripts; then add `procedures_agent` to `VITE_CHAT_AGENTS` on Vercel (Production + Preview) and redeploy through CI (`gh workflow run ci.yml --ref main -f deploy=true`; a `vercel redeploy` would not pick up a `VITE_` var).
4. Rollback: remove the name and redeploy.
