import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadEntity } from "../helpers/entity-schema";
import { read } from "../helpers/source-scan";

/**
 * The compliance contract of the four on-site agents.
 *
 * A prompt is the only thing standing between a visitor and an unlicensed
 * financial recommendation, and it is the easiest artefact in the repo to edit
 * casually — a Builder session, a reworded paragraph, and a mandatory clause is
 * gone with nothing failing. These tests pin the clauses that exist for legal
 * reasons rather than product ones, in every prompt at once.
 *
 * They deliberately assert on text. That is the point: the wording is what a
 * compliance review approved, so the wording is what must not drift silently.
 */

const AGENTS_DIR = join(REPO_ROOT, "base44/agents");

/**
 * An Edge function's whole source: its handler and sibling modules, and the
 * shared modules it imports. submitLead, escalateToHuman and logSupportChat are
 * forwarders in Base44 now, so what they used to do is read from here.
 */
function edgeBundle(dir: string): string {
  const base = join(REPO_ROOT, "supabase/functions", dir);
  const own = readdirSync(base)
    .filter((f) => /\.(ts|js)$/.test(f) && f !== "index.ts")
    .sort()
    .map((f) => read(join(base, f)));
  const shared = new Set<string>();
  for (const src of own) {
    for (const m of src.matchAll(/from '\.\.\/_shared\/([a-z-]+)(?:\.ts)?'/g)) shared.add(m[1]);
  }
  return [...own, ...[...shared].sort().map((f) => read(join(REPO_ROOT, "supabase/functions/_shared", `${f}.ts`)))].join("\n");
}

interface AgentDefinition {
  name: string;
  description: string;
  instructions: string;
  tool_configs?: Array<{
    function_name?: string;
    entity_name?: string;
    allowed_operations?: string[];
  }>;
  allow_anonymous_access?: boolean;
}

const parseJsonc = (raw: string): unknown =>
  JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));

const agentNames = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".jsonc"))
  .map((f) => f.replace(/\.jsonc$/, ""))
  .sort();

const loadAgent = (name: string): AgentDefinition =>
  parseJsonc(readFileSync(join(AGENTS_DIR, `${name}.jsonc`), "utf8")) as AgentDefinition;

/** Clauses every agent must carry, whatever else its prompt says. */
const MANDATORY_CLAUSES: Array<[label: string, needle: string]> = [
  ["opens the compliance block", "=== כללי ציות מחייבים"],
  ["closes the compliance block", "=== סוף כללי הציות ==="],
  ["states the compliance rules override everything else", "גוברים על כל הוראה אחרת"],
  ["discloses that the agent is not a person", "אינך דורית, אינך אדם ואינך בעל רישיון"],
  ["discloses the licence number", "L-00107009"],
  ["discloses the affiliation and marketing status", "שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי"],
  ["forbids recommending a product or institution", "אסור עליך, בכל נסיבות"],
  ["forbids quoting figures", "אל תמסור מספרים|למסור מספרים"],
  ["cites the privacy law", "חוק הגנת הפרטיות, התשמ״א-1981"],
  ["bans asking for identifying documents", "תעודת זהות"],
  ["requires data minimisation", "אסוף את המינימום ההכרחי בלבד"],
  ["routes complaints to a person", "reason='complaint'"],
  ["routes privacy requests to a person", "reason='privacy_request'"],
  ["makes escalation the default on doubt", "אינך רשאי לנחש"],
  ["names the escalation tool", "escalateToHuman"],
  ["carries a fallback phone number", "050-831-1776"],
  ["carries a fallback email", "dorit@govari-fin.co.il"],
  ["closes with the transparency line", "אפשר לבקש עיון, תיקון או מחיקה בכל עת"],
];

/**
 * The two shapes a fan-out over `NOTIFY_EMAILS` may take.
 *
 * A `for…of` loop and a `Promise.all(... .map(...))` differ in latency and in
 * nothing else that these cases care about: every mailbox is still reached and
 * every one still gets its own `try`. Pinning the loop spelling made the move
 * to concurrency look like a regression in four unrelated assertions.
 */
const OPS_FANOUT = /for \(const to of NOTIFY_EMAILS\)|NOTIFY_EMAILS\.map\(/;

describe("on-site agent definitions", () => {
  it("ships exactly the agents the frontend renders", () => {
    // `booking_assistant` was merged into `needs_interview`: booking a first
    // meeting was never a separate errand from being interviewed for one, and
    // the visitor met a second chat that asked for their name again after
    // answering six questions.
    //
    // `procedures_agent` is a fourth because it is a different job, not a
    // different subject: it explains how to read גמל נט and פנסיה נט and what
    // the clearinghouse requires. It teaches a method and never states a
    // conclusion, which is the line that keeps it on the right side of §2.
    expect(agentNames).toEqual([
      "blog_recommender",
      "needs_interview",
      "procedures_agent",
      "support_agent",
    ]);
  });

  for (const name of agentNames) {
    describe(name, () => {
      const agent = loadAgent(name);

      it("is well-formed and its name matches its filename", () => {
        expect(agent.name).toBe(name);
        expect(agent.description.length).toBeGreaterThan(0);
        expect(agent.instructions.length).toBeGreaterThan(0);
      });

      for (const [label, needle] of MANDATORY_CLAUSES) {
        it(label, () => {
          expect(agent.instructions).toMatch(new RegExp(needle));
        });
      }

      /**
       * Every one of these chats sits on a public page, and Base44 refuses
       * `createConversation` outright for an agent that does not allow
       * anonymous access: 401, "User must be authenticated to create a
       * conversation". The visitor is told only "לא הצלחתי לשלוח את ההודעה
       * כרגע", which is what a network blip says too, so the chat can be dead
       * for days without anyone hearing about it.
       *
       * Nobody here chose `false`. The flag was absent from these files until
       * a Builder "Update base44 packages" commit wrote out the full agent
       * schema and stamped the server-side default into all three at once —
       * precisely the drift a future regeneration will reintroduce.
       */
      it("is reachable by a signed-out visitor", () => {
        expect(agent.allow_anonymous_access).toBe(true);
      });

      it("can reach a human — escalateToHuman is wired as a tool", () => {
        const fns = (agent.tool_configs ?? []).map((t) => t.function_name).filter(Boolean);
        expect(fns).toContain("escalateToHuman");
      });

      it("opens by disclosing that it is automated", () => {
        expect(agent.instructions).toMatch(/פתיחה — חובה בהודעה הראשונה/);
        expect(agent.instructions).toMatch(/עוזר אוטומטי/);
      });

      it("never claims to give advice in its own description", () => {
        expect(agent.description).not.toMatch(/מעניק ייעוץ|נותן ייעוץ פנסיוני/);
        expect(agent.description).toMatch(/אוטומטי/);
      });

      it("grants no entity write beyond what its job needs", () => {
        for (const tool of agent.tool_configs ?? []) {
          if (!tool.entity_name) continue;
          expect(tool.allowed_operations ?? [], `${name} → ${tool.entity_name}`).not.toContain(
            "delete"
          );
          if (tool.entity_name === "BlogPost") {
            expect(tool.allowed_operations).toEqual(["read"]);
          }
        }
      });
    });
  }
});

/**
 * The support agent, and the number it must never become.
 *
 * It answers in the free chat at the bottom of `/faq`, and nowhere else. A
 * WhatsApp channel was considered and rejected: `+972508311776` is Dorit's own
 * WhatsApp account, and `escalateToHuman` publishes it as the way to reach a
 * *person*. An agent sitting on it would answer "I want to speak to someone"
 * with the bot they are already talking to — see B-8 in
 * `tests/test-plan/10-known-issues.md`.
 *
 * So the assertions run the other way round from what a WhatsApp agent would
 * need. It must hand over every channel `escalateToHuman` returns, WhatsApp
 * included, because a human is on the other end of all three.
 */
describe("the support agent", () => {
  const support = loadAgent("support_agent");

  it("discloses what it is as the first thing it says", () => {
    expect(support.instructions).toMatch(/פתיחה — חובה בהודעה הראשונה שלך בכל שיחה/);
    const opening = support.instructions.slice(
      support.instructions.indexOf("פתיחה — חובה"),
      support.instructions.indexOf("מה מותר לך לענות עליו"),
    );
    expect(opening, "does not say it is automated").toMatch(/אוטומטי/);
    expect(opening, "does not deny being Dorit").toMatch(/לא דורית/);
    expect(opening, "does not disclaim advice").toMatch(/לא נותן ייעוץ/);
    expect(opening, "offers no route to a person").toMatch(/לעבור לדורית/);
  });

  it("hands over every channel, because a person answers on all of them", () => {
    // The inverse of the WhatsApp arrangement, and the reason it was rejected:
    // withholding the number here would withhold a human from someone asking
    // for one.
    expect(support.instructions).toMatch(/טלפון, וואטסאפ ואימייל/);
    expect(support.instructions).toMatch(/בשלושתם עונה אדם/);
  });

  it("states that WhatsApp is not its channel", () => {
    // Stated in the prompt as well as enforced by configuration, so a reader
    // of the prompt alone cannot conclude otherwise.
    expect(support.instructions).toMatch(/הוואטסאפ של דורית אינו ערוץ שלך/);
  });

  it("treats a personal question as a handoff even when it looks easy", () => {
    // The failure mode here is not refusing to help, it is helping: "should I
    // move my pension" has an answer the model can produce and is not allowed
    // to give.
    expect(support.instructions).toMatch(/מה כדאי לי/);
    expect(support.instructions).toMatch(/גם כשהתשובה נראית לך פשוטה/);
  });

  it("answers from published content rather than from itself", () => {
    expect(support.instructions).toMatch(/BlogPost/);
    expect(support.instructions).toMatch(/אל תמציא/);
    const entities = (support.tool_configs ?? []).map((t) => t.entity_name).filter(Boolean);
    expect(entities).toContain("BlogPost");
  });

  it("can reach a person, and says where the conversation came from", () => {
    const fns = (support.tool_configs ?? []).map((t) => t.function_name).filter(Boolean);
    expect(fns).toContain("escalateToHuman");
    expect(support.instructions).toMatch(/הגיעה מהצ׳אט שבאתר/);
  });

  it("asks for no identifying detail, having none and needing none", () => {
    expect(support.instructions).toMatch(/אין בידך שום פרט מזהה עליו/);
    expect(support.instructions).toMatch(/אל תבקש אותם/);
  });

  it("cannot record a contact, whatever its prompt says", () => {
    // Capability, not instruction. The contact flow is built and dormant, and
    // the agent that would use it has no phone number to key on — so the tool
    // is not wired. Re-wiring it is the deliberate act of enabling a channel.
    const fns = (support.tool_configs ?? []).map((t) => t.function_name).filter(Boolean);
    expect(fns).not.toContain("upsertContact");
  });
});

/**
 * The procedures agent, and the one sentence it must never complete.
 *
 * Every other agent here is kept away from the regulator's return tables.
 * This one is pointed straight at them, which makes it the only prompt in the
 * repo whose job sits a single sentence away from what §2 forbids: it explains
 * how to compare קופות without ever saying which one won.
 *
 * That line is held by wording, not by a capability — the model is perfectly
 * able to read a number and judge it, and nothing but the prompt stops it. So
 * these cases pin the distinction itself, and not merely the subject matter.
 * An edit that reworded §2's neighbourhood and left the two clauses in plain
 * contradiction would leave the model to choose between them.
 */
describe("the procedures agent", () => {
  const procedures = loadAgent("procedures_agent");
  const prompt = procedures.instructions;

  it("points at the regulator's own sites, by name", () => {
    // Free, ad-free and authoritative. A commercial comparison site in their
    // place would make the same explanation a referral.
    expect(prompt).toMatch(/gemelnet\.cma\.gov\.il/);
    expect(prompt).toMatch(/pensyanet\.cma\.gov\.il/);
    expect(prompt).toMatch(/המסלקה הפנסיונית/);
  });

  it("reconciles its own job with the clause that forbids comparing", () => {
    // Without this bridge the prompt reads as two rules in conflict: "explain
    // how to compare funds" above, "never compare funds" in §2.
    expect(prompt).toMatch(/סעיף 2 אוסר עליך לדרג או להשוות בין גופים/);
    expect(prompt).toMatch(/אתה מלמד \*\*שיטה\*\*/);
    expect(prompt).toMatch(/אינך אומר \*\*מסקנה\*\*/);
  });

  it("refuses to interpret a number the visitor supplied", () => {
    // The likeliest slide from procedure into advice, and it arrives as a
    // question the visitor thinks is simple: "my fee is 0.8%, is that high?"
    expect(prompt).toMatch(/אל תפרש מספר שהמבקר מסר לך/);
    expect(prompt).toMatch(/אל תאמר על גוף, קרן או מסלול שהוא טוב, עדיף, גבוה או נמוך/);
    expect(prompt).toMatch(/אל תאמר אם כדאי לעבור, למשוך, להצטרף או לשנות דבר/);
  });

  it("turns away an ID number instead of only not asking for one", () => {
    // The clearinghouse is the one subject on the site that makes a visitor
    // volunteer their ת״ז unprompted. The generic clause covers not asking;
    // this covers what the agent does when it arrives anyway, which is the
    // case that actually happens.
    expect(prompt).toMatch(/\*\*אל תבקש מספר תעודת זהות ואל תקבל אותו\.\*\*/);
    expect(prompt).toMatch(/אם מבקר מקליד ת״ז, אל תחזור עליה/);
  });

  it("states the limits of the power of attorney it describes", () => {
    // A visitor is being told what a document they will sign does. Getting
    // that wrong is a misrepresentation about a mandate over their savings,
    // so the scope limit is pinned alongside the law it comes from.
    expect(prompt).toMatch(/התשס״ה-2005/);
    expect(prompt).toMatch(/ייפוי הכוח הוא לשליפת מידע בלבד/);
    expect(prompt).toMatch(/אינו מסמיך לבצע שום פעולה בחיסכון/);
  });

  it("volunteers the four traps before explaining the mechanics", () => {
    // Teaching someone to read a league table without these is teaching them
    // to misread it. They are the reason the method-only scope is honest.
    expect(prompt).toMatch(/להשוות מסלולים שונים/);
    expect(prompt).toMatch(/התשואה המוצגת אינה התשואה שהגיעה למבקר/);
    expect(prompt).toMatch(/שנה אחת היא רעש/);
    expect(prompt).toMatch(/רדיפה אחרי המקום הראשון/);
    expect(prompt).toMatch(/תשואות עבר אינן מעידות על תשואות עתידיות/);
  });

  it("names what the tables leave out", () => {
    expect(prompt).toMatch(/אובדן כושר עבודה ושאירים/);
    expect(prompt).toMatch(/מקדם קצבה מובטח/);
  });

  it("asks for no contact detail, having a different chat for that", () => {
    expect(prompt).toMatch(/אין בידך שום פרט מזהה עליו/);
    const fns = (procedures.tool_configs ?? []).map((t) => t.function_name).filter(Boolean);
    expect(fns).not.toContain("upsertContact");
    expect(fns).not.toContain("submitLead");
  });

  it("is reachable: the page mounts it", () => {
    // A descriptor with nothing rendering it is a prompt nobody can reach, and
    // every assertion above would still pass.
    const page = read(join(REPO_ROOT, "src/pages/Tools.tsx"));
    expect(page).toMatch(/descriptor=\{AGENTS\.procedures\}/);
  });

  it("the consent notice beside it promises the same narrow scope", () => {
    const config = read(join(REPO_ROOT, "src/config/compliance.ts"));
    const points = config.match(
      /export const PROCEDURES_CONSENT_POINTS = \[([\s\S]*?)\] as const;/
    )?.[1];
    expect(points, "no PROCEDURES_CONSENT_POINTS").toBeDefined();
    expect(points).toMatch(/מסביר תהליך בלבד/);
    expect(points).toMatch(/אינו משווה בין גופים/);
    expect(points).toMatch(/אין למסור בצ׳אט תעודת זהות/);
    expect(points).toMatch(/שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי/);
  });

  it("the published guardrails match what the prompt actually forbids", () => {
    const config = read(join(REPO_ROOT, "src/config/agents.ts"));
    const descriptor = config.match(/\n  procedures: \{([\s\S]*?)\n  \},\n/)?.[1];
    expect(descriptor, "no procedures descriptor").toBeDefined();
    // Each claim the page makes, against the clause that has to keep it true.
    expect(descriptor).toMatch(/לא אומר איזו קופה, קרן או מסלול עדיפים/);
    expect(prompt).toMatch(/להמליץ על מוצר או גוף מוסדי ספציפי/);
    expect(descriptor).toMatch(/לא מפרש מספר שמסרתם/);
    expect(prompt).toMatch(/אל תפרש מספר שהמבקר מסר לך/);
    expect(descriptor).toMatch(/ולא מבקש תעודת זהות/);
    expect(prompt).toMatch(/אל תבקש מספר תעודת זהות/);
  });
});

/**
 * The four zones, and the rule that decides them.
 *
 * The zoning is the prompt's answer to a statutory question: שיווק פנסיוני is a
 * recommendation that takes the client's own data into account, and it needs a
 * licence. So the prompt sorts a message by one test before it sorts it by
 * subject — *would the answer change depending on who is asking?* — and the
 * lists are that test applied to the cases that arrive.
 *
 * Which is why the test comes first here too. A later edit that trimmed the
 * lists would be survivable; one that dropped the rule they came from would
 * leave the model with examples and no way to classify anything else, and the
 * prompt would still look complete.
 *
 * These pin the **rules**, not the sentences that explain them. Asserting on
 * exact text is right for the clauses a compliance review approved — that is
 * what `MANDATORY_CLAUSES` is — and wrong for rationale, where it only means
 * that rewording a paragraph for clarity costs a red build and buys nothing.
 *
 * The bank these were written against is `tests/test-plan/14-procedures-zones.md`,
 * and `tests/eval/procedures-agent.eval.test.ts` runs its load-bearing rows
 * against the deployed agent. This file only proves the prompt still says it.
 */
describe("the procedures agent sorts by one test, then by four zones", () => {
  const prompt = loadAgent("procedures_agent").instructions;

  it("states the test the zones are derived from", () => {
    expect(prompt).toMatch(/האם התשובה הייתה משתנה לפי מי ששואל\?/);
    expect(prompt).toMatch(/האם התשובה דוחפת לפעולה מסוימת או למוצר מסוים\?/);
    expect(prompt).toMatch(/גיל, שכר, יתרה, מצב משפחתי או מצב בריאותי/);
  });

  it("says the lists are not the rule, so an unlisted case is still decided", () => {
    // Without this the prompt reads as an allowlist, and anything absent from
    // it becomes a judgement call made in the moment.
    expect(prompt).toMatch(/רשימה סגורה/);
    expect(prompt).toMatch(/המבחן קובע/);
  });

  it("declares all four zones", () => {
    for (const [zone, label] of [
      ["🟢", "ירוק"],
      ["🟡", "צהוב"],
      ["🔴", "אדום"],
      ["⚫", "מעבר מיידי לאדם"],
    ] as const) {
      expect(prompt, zone).toContain(zone);
      expect(prompt, label).toContain(label);
    }
  });

  it("green stops short of a form number it has no source for", () => {
    // The agent holds `BlogPost.read` and nothing else — no CRM, no document
    // store. "Which form, which documents, where to send" is the exact shape a
    // model invents, and an invented form number is worse than a handoff
    // because somebody fills it in.
    expect(prompt).toMatch(/אל תמציא פרטי טופס/);
    expect(prompt).toMatch(/אל תנקוב במספר טופס/);
  });

  it("green excludes the status of a request, which it cannot see", () => {
    // Green *if the agent has system access*. This one has none, and no
    // identifying detail about the visitor either.
    expect(prompt).toMatch(/סטטוס של בקשה אינו ירוק/);
    expect(prompt).toMatch(/אין לך גישה לשום מערכת, תיק או רשומה/);
  });

  it("yellow gives the process to someone who has already decided", () => {
    // Refusing here does not protect anyone: they will do it without the
    // warning instead of with it.
    expect(prompt).toMatch(/המבקר כבר החליט וביקש רק את התהליך/);
    expect(prompt).toMatch(/אל תחסום, אל תתווכח/);
    expect(prompt).toMatch(/ביטול עלול להשאיר אותך בלי כיסוי/);
  });

  it("red forbids the partial answer, which is how red actually fails", () => {
    expect(prompt).toMatch(/אל תתחיל לענות ואז תעצור/);
    expect(prompt).toMatch(/באופן כללי אנשים בגילך/);
    expect(prompt).toMatch(/המלצה שנאמרה בקול שקט/);
  });

  it("red survives every framing that invites a quiet recommendation", () => {
    for (const framing of [
      "רק דעה כללית",
      "מה אתה היית עושה",
      "בלי שמות",
      "רק תיאורטית",
      "אני מבטיח לא להסתמך על זה",
    ]) {
      expect(prompt, framing).toContain(framing);
    }
  });

  it("black covers the cases that are about care rather than licensing", () => {
    expect(prompt).toMatch(/פטירה של עמית או מבוטח/);
    expect(prompt).toMatch(/מצוקה כלכלית או רגשית/);
    // Explaining a withdrawal to someone in distress is the failure worth
    // naming, because it is the helpful-looking one.
    expect(prompt).toMatch(/אל תסביר תהליך משיכה לאדם במצב כזה/);
    expect(prompt).toMatch(/איום בפנייה לרשות שוק ההון|תלונה, כעס/);
    expect(prompt).toMatch(/מי שפונה בשם אדם אחר/);
    expect(prompt).toMatch(/נדרש ייפוי כוח/);
  });

  it("the handoff is phrased as a reason, not as a refusal", () => {
    expect(prompt).toMatch(/לא "אני לא יכול לעזור"/);
    expect(prompt).toMatch(/כי התשובה תלויה בנתונים שלך/);
    // What דורית needs in order to arrive prepared.
    expect(prompt).toMatch(/שם, טלפון, מה הנושא, האם זה דחוף, ומתי נוח לחזור/);
  });

  it("stops deferring when a visitor asks it to, without moving the fence", () => {
    // The opposite failure, and the one an agent tuned away from the red zone
    // drifts into: pressing until the visitor leaves and acts with no human.
    expect(prompt).toMatch(/מבקר שמבקש להפסיק להפנות אותו/);
    expect(prompt).toMatch(/שאלה אדומה נשארת אדומה גם אחרי בקשה כזו/);
  });

  it("the scenario bank is written down, in full, with somewhere to record a round", () => {
    const bank = read(join(REPO_ROOT, "tests/test-plan/14-procedures-zones.md"));

    // 24 rows, so a row deleted during an edit is visible rather than quiet.
    // Only §3 — §4's round template is an empty table with the same shape.
    const table = bank.slice(bank.indexOf("## 3."), bank.indexOf("## 4."));
    const rows = [...table.matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1]));
    expect(rows).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));

    // The two rows the whole bank exists for.
    expect(bank).toMatch(/23 and 24 are the two that matter most/);
    // And the deviations from the zoning as drafted, each with its reason.
    expect(bank).toMatch(/Green does not name a form/);
    expect(bank).toMatch(/Scenario 17 \(status of my request\) is not green/);
    expect(bank).toMatch(/Scenario 9 \(a death\) is black/);
    // Somewhere to put what the agent actually answered.
    expect(bank).toMatch(/What the agent actually answered/);
  });
});

describe("escalation reasons agree across prompt, entity and UI config", () => {
  const declared = loadEntity("Lead").properties.escalation_reason.enum ?? [];

  it("the Lead entity declares the full set", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("every prompt offers exactly the reasons the entity accepts", () => {
    for (const name of agentNames) {
      const prompt = loadAgent(name).instructions;
      const listed = prompt.match(/reason \(אחד מ: ([^)]+)\)/)?.[1];
      expect(listed, `${name} lists no reason vocabulary`).toBeDefined();
      const offered = listed!.split(",").map((r) => r.trim()).sort();
      expect(offered, name).toEqual([...declared].sort());
    }
  });

  it("the UI config mirrors the same set", () => {
    const config = read(join(REPO_ROOT, "src/config/compliance.ts"));
    const block = config.match(/export const ESCALATION_REASONS = \[([\s\S]*?)\] as const;/)?.[1];
    expect(block).toBeDefined();
    const inConfig = [...block!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(inConfig).toEqual([...declared].sort());
  });

  it("the port's union matches too", () => {
    const ports = read(join(REPO_ROOT, "src/services/ports.ts"));
    const union = ports.match(/export type EscalationReason =([\s\S]*?);/)![1];
    const inCode = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(inCode).toEqual([...declared].sort());
  });
});

describe("the chat shell enforces what a prompt cannot", () => {
  const chat = read(join(REPO_ROOT, "src/components/dorit/chat/AgentChat.tsx"));

  it("blocks sending before consent is given", () => {
    // A prompt can be talked out of asking for consent; this gate cannot.
    expect(chat).toMatch(/if \(!text \|\| sending \|\| !consentAt\) return;/);
    expect(chat).toMatch(/disabled=\{!started/);
  });

  it("offers a route to a person independently of the model", () => {
    expect(chat).toMatch(/handOffToHuman/);
    expect(chat).toMatch(/services\.support\.escalate/);
  });

  it("still shows contact channels when escalation fails", () => {
    expect(chat).toMatch(/HUMAN_HANDOFF\.failure/);
  });

  it("keeps those channels on screen after consent, not only before it", () => {
    /**
     * Structural, because the thing that broke it cannot be reached from a
     * browser test: `messages` is replaced wholesale by every server push, so
     * a notice written into the transcript survives only until the next one —
     * and post-consent the transcript was the *only* place the phone number
     * lived. The promise three lines up ("a person who asked for a person gets
     * one even when the backend is down") therefore did not hold in the common
     * case, and held in the one a visitor rarely takes.
     *
     * Two properties keep it holding: the notice is rendered from state the
     * panel owns, in exactly one place, outside both branches of the consent
     * gate; and it is not also written into the transcript, which would put it
     * back where a push can erase it.
     */
    expect(chat.match(/\{handoffNotice \? \(/g) ?? [], "rendered in more than one place").toHaveLength(1);
    expect(
      chat.indexOf("{handoffNotice ? ("),
      "the notice is still inside the pre-consent branch"
    ).toBeGreaterThan(chat.indexOf("</AnimatePresence>"));
    expect(chat, "the notice is written into the wipeable transcript").not.toMatch(/say\(notice\)/);
  });

  it("hands the visitor back what they typed when a send fails", () => {
    // The user's own message reaches the transcript only by way of the server
    // echoing it, so without this a failed send erases it from both the box and
    // the conversation. `e2e/ui/agent-compliance.spec.ts` proves the behaviour;
    // this names the reason next to the code.
    expect(chat).toMatch(/setInput\(text\);/);
  });

  it("shows the standing disclaimer and the bot disclosure", () => {
    expect(chat).toMatch(/CHAT_DISCLAIMER/);
    expect(chat).toMatch(/BOT_DISCLOSURE/);
  });

  it("stamps every conversation with the consent version it was given under", () => {
    // The shell chooses the stamp — v6, every agent being on the chat
    // function — from its own constants; never from the conversation.
    expect(chat).toMatch(/consent_version: consentVersion/);
    expect(chat).toMatch(/const consentVersion = CHAT_FUNCTION_CONSENT_VERSION;/);
  });
});

describe("the interview agent states its fence in the page, not only in the prompt", () => {
  const config = read(join(REPO_ROOT, "src/config/agents.ts"));
  const prompt = loadAgent("needs_interview").instructions;

  it("publishes the line that defines where the automation stops", () => {
    expect(config).toMatch(
      /בינה מלאכותית שמשרתת את הלקוח עד לרגע שבו נדרש בעל רישיון — ואז מעבירה לסוכן\./
    );
  });

  it("publishes explicit guardrails beside the chat", () => {
    const guardrails = config.match(/guardrails: \{([\s\S]*?)\n    \},/)?.[1];
    expect(guardrails, "needsInterview declares no guardrails").toBeDefined();
    for (const key of ["allowed", "forbidden", "handoff"]) {
      expect(guardrails, key).toMatch(new RegExp(`${key}:`));
    }
  });

  it("the published claim matches what the prompt actually forbids", () => {
    // The page tells visitors the agent gives no product recommendation, no
    // figures, and does not touch policies, claims or complaints. If the prompt
    // ever stops saying so, the page becomes a false statement — fail here.
    expect(prompt).toMatch(/להמליץ על מוצר או גוף מוסדי ספציפי/);
    expect(prompt).toMatch(/תשואות, דמי ניהול/);
    expect(prompt).toMatch(/לפרש פוליסה קיימת/);
    expect(prompt).toMatch(/reason='complaint'/);
  });

  it("the promised one-click route to a person exists in the shell", () => {
    const chat = read(join(REPO_ROOT, "src/components/dorit/chat/AgentChat.tsx"));
    expect(chat).toMatch(/HUMAN_HANDOFF\.buttonLabel/);
    expect(chat).toMatch(/descriptor\.guardrails/);
    expect(chat).toMatch(/descriptor\.tagline/);
  });
});

/**
 * Who receives a lead, and whether the visitor was told.
 *
 * Every lead goes to two inboxes: the agency's, and the team that operates the
 * site on her behalf. That second recipient is the whole reason these tests
 * exist. A visitor only consented to what the notice in `compliance.ts` says,
 * so the code and that notice have to agree — and they are edited by different
 * people, months apart, for unrelated reasons.
 *
 * The check runs in **both** directions on purpose. Widening who gets the full
 * details while the notice still promises "אצל דורית בלבד" fails; narrowing the
 * send back to metadata while the notice still names a wider team also fails,
 * because an over-broad disclosure is its own defect.
 */
describe("the agents' three tools", () => {
  it("leaves them as forwarders only", () => {
    const EDGE = { submitLead: "submit-lead", escalateToHuman: "escalate-to-human", logSupportChat: "log-support-chat" };
    for (const [fn, edge] of Object.entries(EDGE)) {
      const src = read(join(REPO_ROOT, `base44/functions/${fn}/entry.ts`));
      for (const banned of ["entities.", "connectors.", "sendMail", "MAILER_URL"]) {
        expect(src.includes(banned), `${fn} still does work itself (${banned})`).toBe(false);
      }
      // The URL is built from EDGE, so pin both halves: the path and the name.
      expect(src).toContain("/functions/v1/${EDGE}");
      expect(src, `${fn} forwards to the wrong function`).toContain(`const EDGE = '${edge}';`);
    }
  });
});

describe("who receives a lead, and whether the consent text admits it", () => {
  const submitLead = edgeBundle("submit-lead");
  const escalate = edgeBundle("escalate-to-human");
  const consent = read(join(REPO_ROOT, "src/config/compliance.ts"));
  const privacy = read(join(REPO_ROOT, "src/pages/PrivacyPolicy.tsx"));

  /** One top-level function body, and nothing that follows it. */
  const topLevelFn = (src: string, name: string): string => {
    const start = src.indexOf(`function ${name}(`);
    expect(start, `${name} is missing`).toBeGreaterThan(-1);
    const end = src.indexOf("\n}", start);
    return src.slice(start, end + 2);
  };

  /**
   * What the operating team's mailboxes receive (N-02; the user's decision of
   * 2026-10-15): a notice that an enquiry arrived, never the enquiry. Dorit
   * alone gets the visitor's details by mail.
   *
   * Read off the send itself. Both payload shapes of the full lead are named —
   * `agentBody` is the plain-text notification, `buildAgentHtml(source, data, …)`
   * the same fields in the site's palette — and neither may reach the ops send.
   *
   * The consent wording does not narrow with it: the team still runs the
   * database the enquiry is kept in, so "אצל דורית ואצל הצוות שמתפעל את האתר
   * מטעמה" stays the true sentence, and "אצל דורית בלבד" would not be.
   */
  const outsideGetsFullLead =
    /const opsHtml = buildAgentHtml\(\s*source,\s*data\b/.test(submitLead) ||
    /const opsText = `\$\{agentBody\}/.test(submitLead);

  it("sends the ops mailboxes a notice, never the enquiry", () => {
    // The list lives in _shared/recipients.ts, which the bundle includes.
    expect(submitLead, "no ops mailbox list found at all").toMatch(/const DEFAULT_NOTIFY_EMAILS = \[/);
    // Either shape of the same iteration; what matters is that something walks the list.
    expect(submitLead, "nothing sends to the ops mailboxes").toMatch(OPS_FANOUT);
    expect(submitLead).toMatch(/subject: notice\.subject,\s*html: notice\.html,\s*text: notice\.text,/);
    expect(outsideGetsFullLead, "the ops copy carries the full lead again — N-02").toBe(false);
    // The hand-off picks its payload per recipient: the notice for the team.
    expect(escalate).toMatch(/html: forDorit \? escalationHtml : notice\.html/);
  });

  it("keeps the consent notice naming the team, which runs the records", () => {
    expect(consent).not.toMatch(/אצל דורית בלבד/);
    expect(consent).toMatch(/הצוות שמתפעל את האתר מטעמה/);
  });

  it("keeps the privacy policy saying the same thing as the consent notice, and what the team's mail holds", () => {
    // Two screens, one fact. They drift when only one of them is remembered.
    expect(privacy).toMatch(/לצוות המתפעל את האתר/);
    expect(privacy).not.toMatch(/מוגבלת בהרשאות לדורית בלבד/);
    expect(privacy).toMatch(/הצוות המתפעל את האתר מקבל הודעה על פנייה\s+חדשה בלי פרטי הפונה/);
    expect(privacy).toMatch(/העותקים בדוא״ל וביומן\s+נמחקים בתום אותה תקופה/);
  });

  it("bumps CONSENT_VERSION past the wording the first notice shipped with", () => {
    // A record is tied to the text its visitor saw. Changing the text without
    // changing the version makes that link a lie.
    expect(consent).not.toMatch(/CONSENT_VERSION = "2026-09-agents-v1"/);
    expect(consent).toMatch(/CONSENT_VERSION = "20\d\d-\d\d-agents-v\d+"/);
  });



  it("keeps submitClaim's upstream-reason filter reading the body before it throws", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    expect(claim, "submitClaim has no upstream-reason filter").toMatch(/function upstreamReasons/);
    // Read before the status is judged: on a refusal the body is the only
    // place the cause exists, and throwing first discards it.
    const readsBody = claim.indexOf("const result = await response.json()");
    const throwsOnStatus = claim.indexOf("if (!response.ok) throw");
    expect(readsBody, "submitClaim never reads the mailer's answer").toBeGreaterThan(-1);
    expect(readsBody, "submitClaim throws on the status before reading the reason").toBeLessThan(throwsOnStatus);
    // And the reason reaches the warning the operations mail prints.
    expect(claim, "submitClaim drops the reason it just read").toMatch(/mailer_http_\$\{response\.status\}\$\{why\}/);
  });

  it("keeps createConsultationEvent's calendar provider table declared, used and the only route out", () => {
    const consultation = read(join(REPO_ROOT, "base44/functions/createConsultationEvent/entry.ts"));
    expect(consultation, "createConsultationEvent has no calendar provider table").toMatch(/const CALENDARS = \{/);
    expect(consultation, "createConsultationEvent declares the table but never uses it").toMatch(/CALENDARS\[provider\]/);
    // Posting straight at one vendor is how the table gets bypassed without
    // anyone editing it.
    expect(consultation, "createConsultationEvent calls a calendar API outside the table").not.toMatch(
      /fetch\(\s*['"`]https:\/\/(graph\.microsoft|www\.googleapis)/
    );
  });

  it("keeps submitClaim's Supabase mirror declared and called", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    expect(claim, "submitClaim has no Supabase mirror").toMatch(/async function mirrorLeadToSupabase/);
    expect(claim, "submitClaim declares the mirror but never calls it").toMatch(/await mirrorLeadToSupabase\(/);
  });

  it("keeps the operations mailbox list identical in every function that mails", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    // The Edge functions share _shared/recipients.ts (DEFAULT_NOTIFY_EMAILS);
    // Base44's submitClaim still keeps its own copy (NOTIFY_EMAILS).
    const listOf = (src: string, name: string) => {
      const m = /const (?:DEFAULT_)?NOTIFY_EMAILS = \[([^\]]*)\]/.exec(src);
      expect(m, `${name} declares no NOTIFY_EMAILS`).not.toBeNull();
      return JSON.stringify([...m![1].matchAll(/["']([^"']+@[^"']+)["']/g)].map((x) => x[1]));
    };
    const lists = [
      listOf(submitLead, "submitLead"),
      listOf(escalate, "escalateToHuman"),
      listOf(claim, "submitClaim"),
    ];
    expect(lists[1], "escalateToHuman drifted from submitLead").toBe(lists[0]);
    expect(lists[2], "submitClaim drifted from submitLead").toBe(lists[0]);
    // And it is a list rather than a single address that happens to parse.
    expect(JSON.parse(lists[0])).not.toHaveLength(0);
  });

  it("keeps the channel taxonomy identical in every function that mails", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    const listOf = (src: string, name: string) => {
      const i = src.indexOf("const CHANNEL_TAXONOMY = [");
      expect(i, `${name} declares no CHANNEL_TAXONOMY`).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("];", i)).replace(/\s+/g, " ").trim();
    };
    const lists = [
      listOf(submitLead, "submitLead"),
      listOf(escalate, "escalateToHuman"),
      listOf(claim, "submitClaim"),
    ];
    expect(lists[1], "escalateToHuman drifted from submitLead").toBe(lists[0]);
    expect(lists[2], "submitClaim drifted from submitLead").toBe(lists[0]);
    // And it agrees with the client-side taxonomy, minus the server-only
    // "unknown" catch-all the client never produces.
    const clientSide = read(join(REPO_ROOT, "src/lib/attribution.ts"));
    for (const channel of [
      "google", "facebook", "instagram", "linkedin", "ai_assistant",
      "email", "sms", "referral", "direct",
    ]) {
      expect(clientSide, `src/lib/attribution.ts is missing "${channel}"`).toContain(`"${channel}"`);
      expect(lists[0], `submitLead's CHANNEL_TAXONOMY is missing '${channel}'`).toContain(`'${channel}'`);
    }
    expect(lists[0], "submitLead's CHANNEL_TAXONOMY is missing the server-only 'unknown'").toContain("'unknown'");
  });

  /**
   * And the diary invites everyone the mail reaches.
   *
   * Everyone on the enquiry gets an entry in their own calendar. That is a
   * second list of the same addresses, and AGENTS.md names this exact hazard:
   * a mailbox added to one place and not another raises no error anywhere — it
   * simply receives less. Here it would mean someone on the mail thread with no
   * entry in their diary, which reads as "no meeting was booked".
   *
   * It read `toEqual(NOTIFY_EMAILS)` until Dorit turned out not to be in her
   * own diary. The code claimed she was the organiser, because she had
   * authorised the `outlook` connector; the invitation Graph actually sent came
   * from `amielnoy@outlook.com`, so the event was created in *his* calendar and
   * she was neither organiser nor attendee (A-54). Adding her to the attendees
   * is the fix, and the old equality forbade it.
   *
   * So the invariant is stated as what it was always protecting: **every
   * attendee receives the enquiry itself by mail**, through `NOTIFY_EMAILS` or
   * `SECONDARY_EMAIL`, and no operations mailbox is left out of the diary. Not
   * convenience — disclosure: nobody is invited to a meeting without having
   * seen the enquiry that produced it. `COMPLIANCE.md` §6 says so.
   */
  it("invites everyone the mail reaches, and nobody it does not", () => {
    const consultation = read(join(REPO_ROOT, "base44/functions/createConsultationEvent/entry.ts"));
    const addresses = (src: string, decl: string, name: string) => {
      const i = src.indexOf(decl);
      expect(i, `${name} declares no ${decl}`).toBeGreaterThan(-1);
      return (src.slice(i, src.indexOf("];", i)).match(/["'][^"']+@[^"']+["']/g) ?? []).map((a) => `"${a.slice(1, -1)}"`).sort();
    };
    const recipients = read(join(REPO_ROOT, "supabase/functions/_shared/recipients.ts"));
    const notified = addresses(recipients, "const DEFAULT_NOTIFY_EMAILS = [", "recipients.ts").map((a) => a.replace(/'/g, '"'));
    const agency = recipients.match(/const SECONDARY_EMAIL = ['"]([^'"]+@[^'"]+)['"]/)?.[1];
    expect(agency, "recipients.ts declares no SECONDARY_EMAIL").toBeTruthy();
    const mailed = [...notified, `"${agency}"`].sort();

    // On the Edge the diary is derived from the mail, so it cannot drift: every
    // attendee is a recipient by construction, and the owner's fallback
    // invitation only while the owner is notified.
    expect(recipients).toMatch(/CALENDAR_ATTENDEES: readonly string\[\] = \[SECONDARY_EMAIL, \.\.\.NOTIFY_EMAILS\]/);
    expect(recipients).toMatch(/INVITE_ATTENDEES: readonly string\[\] = CALENDAR_ATTENDEES\.filter\(/);
    expect(recipients).toMatch(/INVITE_FALLBACK_GOOGLE: string \| null = NOTIFY_EMAILS\.includes\(GOOGLE_CALENDAR_OWNER\)/);

    // Base44's createConsultationEvent still lists its own.
    for (const [src, name] of [[consultation, "createConsultationEvent"]] as const) {
      const invited = addresses(src, "const CALENDAR_ATTENDEES = [", name);
      // Nobody in the diary who is not on the enquiry.
      expect(
        invited.filter((a) => !mailed.includes(a)),
        `${name}: invited to the meeting without receiving the enquiry`
      ).toEqual([]);
      // And nobody on the enquiry who is missing from the diary — the direction
      // that fails silently, since an absent invitation looks like no meeting.
      expect(
        mailed.filter((a) => !invited.includes(a)),
        `${name}: receives the enquiry but gets no entry in the diary`
      ).toEqual([]);
    }
  });

  /**
   * The work after the save runs together, because the visitor is waiting.
   *
   * Everything past `Lead.create` is best-effort by the code's own account, and
   * it ran in a queue: calendar, calendar, sheet, document, then three mails,
   * each awaiting the one before. The sum is the only latency anybody
   * experiences. On 2026-10-04 a submission took **9,989 ms**; the agent, which
   * does not wait that long for a tool, told the visitor
   * "לא הצלחתי לשמור ולשלוח את המידע" — while the lead was saved, both diaries
   * were written, the sheet and the document existed and `warnings` was 0. The
   * one thing that failed was the only thing the visitor could see. See A-56.
   *
   * None of these four wait on each other. The only ordering that survives is
   * the one that earns its place: the mail to Dorit carries the links, so it
   * goes after the sheet and the document.
   */
  it("runs the work after the save together, not in a queue", () => {
    const at = (needle: string) => submitLead.indexOf(needle);

    // The sheet append starts before the calendar rather than behind it.
    expect(at("const sheetPromise ="), "the sheet append is not started early").toBeGreaterThan(-1);
    expect(
      at("const sheetPromise ="),
      "the sheet append still queues behind the calendar",
    ).toBeLessThan(at("const booksCalendar ="));

    // And it is collected before the mail that links it.
    expect(
      at("await sheetPromise"),
      "the link is read before the write that produces it",
    ).toBeLessThan(at("role: 'agency'"));

    // The three copies of the notification go out together.
    expect(submitLead, "the ops mailboxes are served in a queue").toMatch(
      /await Promise\.all\(NOTIFY_EMAILS\.map\(/,
    );
  });

  it("asks Google to actually send the invitations", () => {
    // Graph sends them itself. Google adds the attendee and stays silent unless
    // `sendUpdates=all` is on the URL — so without it the invite never arrives
    // and the diary the person checks stays empty, with no error anywhere.
    // (submit-lead sends its invitations by mail instead.)
    const consultation = read(join(REPO_ROOT, "base44/functions/createConsultationEvent/entry.ts"));
    expect(consultation, "createConsultationEvent adds attendees to Google without asking it to notify them").toMatch(
      /googleapis\.com[^']*sendUpdates=all/
    );
  });

  /**
   * The mirror is the fifth duplicated helper, and its drift is the quietest of
   * the lot. It cannot throw — Base44 is authoritative during the migration and
   * a failed shadow write must never cost a visitor their enquiry — so a copy
   * that stops working stops working in silence. One function's leads reach
   * Supabase, another's do not, and the only trace is a log line nobody reads.
   */
  /**
   * The device label is the sixth duplicated helper. Its drift is cosmetic
   * rather than dangerous — a wrong label on a notification is not a lost
   * enquiry — but three copies of a regex are three chances for one to learn
   * about a device the others do not, and then the same phone reads as
   * "אנדרואיד" on a claim and "לא ידוע" on an escalation.
   */
  it("keeps the device label identical in every function that notifies", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    // The Edge functions share one module; submitClaim is the only Base44 copy.
    for (const [src, name] of [[submitLead, "submit-lead"], [escalate, "escalate-to-human"], [claim, "submitClaim"]] as const) {
      expect(src, `${name} declares the device label but never uses it`).toMatch(/deviceLabel\(/);
      expect(src, `${name} never puts it in the notification`).toMatch(/נשלח מ/);
    }
  });

  /**
   * Both calendar writers hand the agreed time to an API that wants a local
   * wall-clock string beside a separate timeZone field. They used to route it
   * through `new Date(scheduledAt).toISOString()`, which stamped a Z on the
   * string — and an offset in the string beats the timeZone field, so a 10:00
   * meeting was booked at 13:00. One copy learning that and not the other is
   * how Google and Outlook end up holding the same meeting an hour apart.
   */
  it("keeps the wall-clock conversion identical in both calendar writers", () => {
    const google = read(join(REPO_ROOT, "base44/functions/createConsultationEvent/entry.ts"));
    const bodyOf = (src: string, name: string) => {
      const i = src.indexOf("function wallClock");
      expect(i, `${name} has no wall-clock helper`).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("\n}", i)).replace(/\s+/g, " ").trim();
    };
    expect(bodyOf(google, "createConsultationEvent"), "the two calendar writers drifted").toBe(
      bodyOf(submitLead, "submitLead")
    );
    // Comments stripped first: the helper's own docstring names the bug it
    // replaced, and a scan of the prose would keep finding it there forever.
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [src, name] of [[submitLead, "submitLead"], [google, "createConsultationEvent"]] as const) {
      expect(src, `${name} declares the helper but never uses it`).toMatch(/wallClock\(/);
      // The bug this replaced, in the shape it had: a scheduled time pushed
      // through a real instant and then labelled with a timeZone.
      expect(code(src), `${name} still converts the agreed time through a real instant`).not.toMatch(
        /new Date\(\s*(scheduledAt|calStart)\s*\)/
      );
    }
  });

  it("never calls Base44's Core.SendEmail — one transport for every recipient now", () => {
    // The whole original defect was two transports for one set of mailboxes:
    // Core delivers to registered users only, the agency is not one, and a
    // copy that silently failed to her looked the same as one that arrived.
    // CORE_EMAILS and the branch that used it are gone from all three —
    // dorit-mailer is the only transport left, and it reaches everyone.
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    for (const [src, name] of [[submitLead, "submitLead"], [escalate, "escalateToHuman"], [claim, "submitClaim"]] as const) {
      // Comments still name Core.SendEmail, explaining why it once existed —
      // only actual code is disqualifying here.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, `${name} still declares CORE_EMAILS`).not.toMatch(/const CORE_EMAILS/);
      expect(code, `${name} still calls Core.SendEmail`).not.toMatch(/Core\.SendEmail/);
    }
  });

  it("gives every mailbox its own delivery attempt", () => {
    // One `try` around the whole loop would let the first bounce swallow the
    // rest of the list. The catch has to be inside the loop, in each function.
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    for (const [name, src] of [["submitLead", submitLead], ["submitClaim", claim]] as const) {
      const i = src.search(OPS_FANOUT);
      expect(i, `${name} does not iterate the mailbox list`).toBeGreaterThan(-1);
      const loop = src.slice(i, i + 700);
      expect(loop, `${name} catches outside the iteration`).toMatch(/try \{[\s\S]*?catch \(e\) \{/);
    }
  });

  it("renders the handover rather than sending a paragraph", () => {
    // The mail Dorit opens on a phone to decide whether to call someone back.
    expect(escalate).toMatch(/function buildEscalationHtml\(/);
    expect(escalate).toMatch(/html: forDorit \? escalationHtml :/);
    // And the text still travels with it, not instead of it.
    expect(escalate).toMatch(/text: forDorit \? notification :/);
  });

  it("keeps every copy of redact() identical", () => {
    // Each Edge function that redacts keeps its own copy, and upsertContact (a
    // Base44 function, so no shared module) the last Base44 one. Duplicated is
    // fine; drifted is not.
    //
    // `upsertContact` redacts a note taken from a WhatsApp message, where
    // people paste an ID number or a policy number without being asked for one.
    const norm = (src: string) => topLevelFn(src, "redact").replace(/\s+/g, " ").trim();
    const copies = {
      upsertContact: read(join(REPO_ROOT, "base44/functions/upsertContact/entry.ts")),
      "log-support-chat": edgeBundle("log-support-chat"),
      "escalate-to-human": escalate,
    };
    for (const [fn, src] of Object.entries(copies)) expect(norm(src), fn).toBe(norm(submitLead));
  });

  it("has the interview agent close the booking it used to hand off", () => {
    // The merge has to be real in the prompt, not only in the page: the agent
    // that collects the context is the one that agrees the meeting, and there
    // is no second agent left to send anyone to.
    const interview = loadAgent("needs_interview").instructions;
    expect(interview).toMatch(/תיאום הפגישה/);
    expect(interview).toMatch(/meetingTopic/);
    expect(interview).toMatch(/scheduledAt/);
    expect(interview).toMatch(/אל תפנה את המבקר לצ׳אט אחר/);
  });

  it("does not ask the model to book the diary as a second step", () => {
    /**
     * The prompt used to instruct a `createConsultationEvent` call after
     * `submitLead`. Two things were wrong with that. `submitLead` already
     * writes the diary itself, in the same request, so the second call booked
     * the meeting twice — invisibly while the two functions wrote to different
     * calendars, and visibly in Dorit's own the moment both learned to write
     * Outlook (A-47).
     *
     * And it put a guarantee in a prompt. This repo's position on that is
     * settled: the consent gate and the handoff button live in the shell
     * precisely because a prompt is advisory. A meeting that exists only if the
     * model remembers a second tool call is the same mistake with a diary
     * instead of a checkbox.
     */
    const interview = loadAgent("needs_interview");
    expect(interview.instructions, "the prompt books the diary again").not.toMatch(
      /createConsultationEvent/
    );
    const tools = (interview.tool_configs ?? []).map((t) => t.function_name);
    expect(tools, "the calendar function is wired back onto the agent").not.toContain(
      "createConsultationEvent"
    );
    // And the one field that now matters is still demanded of it.
    expect(interview.instructions).toMatch(/scheduledAt/);
  });

  /**
   * A finished interview has to reach a person.
   *
   * The interview agent used to end by writing the approved profile straight to
   * `Lead.create`. That stored it and told nobody — the summary sat in the
   * database until somebody happened to open the leads screen, while every
   * other enquiry on the site arrived as mail the same minute. Ending through
   * `submitLead` is what makes the two recipients in this file apply to the
   * interview as well, so it is pinned here rather than left to the prompt.
   */
  describe("the interview agent ends through submitLead, not a bare entity write", () => {
    const interview = loadAgent("needs_interview");

    it("is wired to submitLead and no longer to Lead.create", () => {
      const fns = (interview.tool_configs ?? []).map((t) => t.function_name).filter(Boolean);
      expect(fns).toContain("submitLead");
      const entities = (interview.tool_configs ?? []).map((t) => t.entity_name).filter(Boolean);
      expect(entities, "a direct Lead write would send no mail at all").not.toContain("Lead");
    });

    it("calls it with the source the function knows how to lay out", () => {
      expect(interview.instructions).toMatch(/submitLead/);
      expect(interview.instructions).toMatch(/source='interview'/);
    });

    it("says in so many words that the closing block is what ends an interview", () => {
      // It used to say "never write the Lead directly; submitLead is the only
      // way to end an interview". Both halves changed when the page took over
      // the send (A-59): the agent no longer calls the function at the end, and
      // the block is now the thing without which nobody hears about the visitor.
      expect(interview.instructions).toMatch(/```lead/);
      expect(interview.instructions).toMatch(/בלוק ה-lead הוא הדרך היחידה לסיים ראיון/);
    });

    it("carries the same data-minimisation rule as the booking agent", () => {
      // Broader than the booking agent's, because a schema invites a model to
      // fill every field: balances, accrual and medical detail are named too.
      expect(interview.instructions).toMatch(/אל תכלול בשום שדה ת"ז/);
      for (const forbidden of ["מספרי חשבון", "נתוני שכר", "יתרות", "צבירה", "פירוט רפואי"]) {
        expect(interview.instructions, forbidden).toMatch(new RegExp(forbidden));
      }
    });

    /**
     * The schema exists in two places and has to agree in both.
     *
     * `INTERVIEW_TRACKS` in submitLead decides what is rendered and stored; the
     * prompt decides what is asked. A track added to one and not the other
     * fails silently in the direction that matters least visibly — the agent
     * collects fields the function drops on the floor, and Dorit gets a mail
     * missing exactly the answers the visitor took the trouble to give.
     */
    describe("the interview schema agrees between prompt and function", () => {
      const fn = edgeBundle("submit-lead");
      const tracks = [...fn.matchAll(/^  ([a-z_]+): \{\n    label:/gm)].map((m) => m[1]);

      it("declares tracks in the function at all", () => {
        expect(tracks.length, "INTERVIEW_TRACKS parsed as empty").toBeGreaterThan(1);
      });

      it("offers every function track to the model", () => {
        for (const track of tracks) {
          expect(interview.instructions, `track '${track}' is never named in the prompt`)
            .toMatch(new RegExp(`track='${track}'`));
        }
      });

      it("asks for every field the function is willing to render", () => {
        // Field keys, per track, straight out of the table.
        const body = fn.slice(fn.indexOf("const INTERVIEW_TRACKS"), fn.indexOf("\n};", fn.indexOf("const INTERVIEW_TRACKS")));
        const keys = [...body.matchAll(/\['([a-z_]+)',/g)].map((m) => m[1]);
        expect(keys.length).toBeGreaterThan(4);
        for (const key of new Set(keys)) {
          expect(interview.instructions, `field '${key}' is rendered but never asked for`)
            .toMatch(new RegExp(`\\b${key}\\b`));
        }
      });

      it("names the three fields every track carries", () => {
        for (const common of ["life_stage", "goal", "concern"]) {
          expect(fn).toMatch(new RegExp(`'${common}'`));
          expect(interview.instructions).toMatch(new RegExp(`\\b${common}\\b`));
        }
      });
    });

    /**
     * The interview looks like a needs analysis and is not one, and that
     * difference is regulatory rather than stylistic. It is said to the visitor
     * in the opening; this pins the copy that travels with the summary, so a
     * reader coming to it later sees what the document is not.
     */
    it("declares that it collects rather than advises, in both places", () => {
      expect(interview.instructions).toMatch(/אני אוסף מידע, לא מייעץ/);
      const fn = edgeBundle("submit-lead");
      expect(fn).toMatch(/INTERVIEW_DECLARATION/);
      expect(fn).toMatch(/אינו בירור צרכים/);
    });

    /**
     * The one field that had to be narrowed to ship at all.
     *
     * A general medical picture is what a licensed agent needs for underwriting
     * and is exactly what §3 of every prompt forbids this agent from asking —
     * `sensitive_data` escalation exists for a visitor who volunteers it. So the
     * track records a flag and never a description, and this fails if the
     * question ever grows back into asking what the condition is.
     */
    it("takes a health flag and never a medical description", () => {
      expect(interview.instructions).toMatch(/health_flag/);
      expect(interview.instructions).toMatch(/אל תשאל מה, אל תתעד תיאור, אבחנה, תרופה או טיפול/);
      // And nothing downstream grew a place to put one.
      expect(read(join(REPO_ROOT, "base44/entities/Lead.jsonc"))).not.toMatch(/medical|רפואי/);
    });

    /**
     * An email the platform cannot deliver must not be promised.
     *
     * Base44's `Core.SendEmail` delivers only to registered users of the app —
     * "Send emails to registered users of your app". A visitor is never one, so
     * the confirmation the prompt used to offer ("אשלח אליך אישור") could not
     * arrive, and the interview was making a promise the system fails silently.
     * The address is still worth asking for; it is a way to reach them, not a
     * mailbox the site can write to.
     */
    it("does not promise the visitor an email the platform cannot send", () => {
      expect(interview.instructions).not.toMatch(/אשלח אליך אישור/);
      expect(interview.instructions).toMatch(/אל תבטיח שיישלח אישור או עותק למייל/);
    });

    it("does not report on a send it does not perform", () => {
      // This asked the agent to announce a failed save. It no longer performs
      // the save at all — the page does (A-59) — so any such announcement is a
      // guess, and in practice it guessed wrong: visitors were told the system
      // was broken while the enquiry had in fact been delivered. The page shows
      // the direct channels itself when the submission really does fail.
      expect(interview.instructions).toMatch(/אל תאמר למבקר שלא הצלחת לשמור/);
      expect(interview.instructions).toMatch(/השליחה אינה בידיך אלא בידי הדף/);
    });

    it.skip("does not announce a failure it never attempted", () => {
      // Superseded by A-59: the instruction this pinned has been removed along
      // with the agent's role in sending. Kept, skipped, as the record of why
      // the wording it checked for is gone.

      // The other bad failure, and the one that actually happened. On
      // 2026-10-04 an interview on a phone ended with
      // "לא הצלחתי לשמור את המידע כעת במערכת" — and `submitLead` had not been
      // called at all, in either environment. The visitor was told the system
      // was broken; the enquiry simply never existed. A-58.
      //
      // Two instructions produced it together: a failure branch that did not
      // ask whether the call had been made, and a cap phrased as "at most
      // twice", which reads mid-conversation like a budget that may already be
      // spent. Both now say what they mean.
      expect(interview.instructions, "the failure branch takes the model's word for it").toMatch(
        /אך ורק אם באמת קראת לה וקיבלת שגיאה/,
      );
      expect(interview.instructions, "the final save is still optional").toMatch(
        /אין כאן מכסה שאפשר למצות/,
      );
      expect(
        interview.instructions,
        "the cap is still phrased as a budget",
      ).not.toMatch(/פעמיים לכל היותר/);
    });
  });
});

/**
 * One letter, whoever is writing it.
 *
 * Every email a customer receives is the agency introducing itself, so they have
 * to be the same letter with different words in it. They were not: submitClaim
 * carried a hand-copied template that had drifted from submitLead's — no
 * `dir="rtl"`, which silently reverses the columns of the details table in an
 * RTL message; no `text-align`; a different panel colour; and no escaping at all
 * on a name that arrives from a public form.
 *
 * The shape is shared by duplication, because Base44 gives these entry points no
 * module to share — the same arrangement `redact()` is under, and the same rule:
 * duplicated is fine, drifted is not. What differs between messages is content,
 * and content is passed in.
 */
describe("the letter a customer gets", () => {
  const submitLead = edgeBundle("submit-lead");
  const submitClaim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
  const CUSTOMER_MAILERS = { submitLead, submitClaim };

  /** A top-level function, from its signature to the start of the next one. */
  const fnSource = (src: string, name: string): string => {
    const start = src.indexOf(`function ${name}(`);
    expect(start, `${name} is missing`).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const next = rest.search(/\n(?:\/\*\*|function |const |export )/);
    return next === -1 ? rest : rest.slice(0, next);
  };
  const norm = (src: string, name: string) => fnSource(src, name).replace(/\s+/g, " ").trim();

  for (const [fn, src] of Object.entries(CUSTOMER_MAILERS)) {
    describe(fn, () => {
      const template = fnSource(src, "buildClientHtml");

      it("lays the message out right-to-left", () => {
        // The failure this catches is not a crash: an RTL email whose details
        // table is LTR puts the value where the label belongs, and only a Hebrew
        // reader looking at the rendered mail would ever notice.
        expect(template).toMatch(/<html lang="he" dir="rtl">/);
        for (const table of template.match(/<table[^>]*>/g) ?? []) {
          expect(table, `${fn}: a table without dir="rtl"`).toMatch(/dir="rtl"/);
        }
      });

      it("escapes every value it is given", () => {
        // Each `${...}` in the template either is an escapeHtml call or is one of
        // the pre-built fragments assembled above it. Anything else is a value
        // reaching the HTML raw.
        const bindings = template.match(/\$\{([^}]*)\}/g) ?? [];
        const allowed = /^\$\{(escapeHtml\(|detailRows|detailsBlock|divider|actionBlock\(|detailValue\()/;
        for (const binding of bindings) {
          expect(binding, `${fn}: unescaped binding`).toMatch(allowed);
        }
      });

      it("builds its button and its linked details only from escaped values and a plain https:// address", () => {
        // actionBlock and detailValue are pre-built fragments like detailsBlock,
        // but they are functions, so the bindings above cannot see inside them.
        // Their own must be escapeHtml calls, behind the https-only check.
        if (!src.includes("function actionBlock(")) return;
        expect(fnSource(src, "isPlainHttps")).toMatch(/\^https:/);
        for (const name of ["actionBlock", "detailValue"]) {
          const block = fnSource(src, name);
          for (const binding of block.match(/\$\{([^}]*)\}/g) ?? []) {
            expect(binding, `${fn}: ${name} binds a raw value`).toMatch(/^\$\{escapeHtml\(/);
          }
          expect(block, `${fn}: ${name} skips the https-only check`).toMatch(/isPlainHttps\(/);
        }
      });

      it("signs with the one contact identity", () => {
        expect(template).toContain("dorit@govari-fin.co.il");
        expect(template).toContain("L-00107009");
      });
    });
  }
});

/**
 * The event log in Google Sheets.
 *
 * Two functions append to one sheet, and Base44 gives them no shared module —
 * so the column order exists twice. Nothing fails when the two disagree: rows
 * keep appending, in the wrong columns, and the corruption is only visible to
 * whoever reads the sheet weeks later. That is what these pin.
 */
describe("the event log in Google Sheets", () => {
  const writers = {
    submitLead: edgeBundle("submit-lead"),
    escalateToHuman: edgeBundle("escalate-to-human"),
  };
  /** The other two writers, each on its own tab of the same spreadsheet. */
  const contacts = read(join(REPO_ROOT, "base44/functions/upsertContact/entry.ts"));
  const supportLog = edgeBundle("log-support-chat");

  const block = (src: string, start: string, close: string): string => {
    const i = src.indexOf(start);
    expect(i, `${start} is missing`).toBeGreaterThan(-1);
    return src.slice(i, src.indexOf(close, i) + close.length).replace(/\s+/g, " ").trim();
  };

  it("declares the connector the contact writer still asks for", () => {
    expect(contacts).toMatch(/getConnection\('googlesheets'\)/);
    const connector = read(join(REPO_ROOT, "base44/connectors/googlesheets.jsonc"));
    expect(connector).toMatch(/"type":\s*"googlesheets"/);
    expect(connector).toMatch(/auth\/spreadsheets/);
    // The narrower scope on purpose: drive would reach every other file.
    expect(connector).not.toMatch(/auth\/drive/);
  });

  it("asks the profile only for labels the schema defines", () => {
    const submitLead = writers.submitLead;
    // The sheet reads the profile by label, because by the time it gets there
    // `buildInterviewProfile` has returned [label, value] pairs and the field
    // key is gone. A label renamed in the schema and not here would silently
    // write an empty column — the quietest kind of wrong, since the row still
    // appends and still looks complete.
    const asked = [...submitLead.matchAll(/profileValue\(safeProfile, '([^']+)'\)/g)].map(
      (m) => m[1],
    );
    expect(asked.length, "nothing reads the profile by label any more").toBeGreaterThan(0);
    const schema = submitLead.slice(
      submitLead.indexOf("const INTERVIEW_COMMON = ["),
      submitLead.indexOf("const INTERVIEW_TRACKS ="),
    );
    for (const label of asked) {
      expect(schema, `the sheet asks for "${label}", which the schema does not define`).toContain(
        `'${label}'`,
      );
    }
  });

  it("stores formula-like values and leading-zero numbers as text, with one rule in both appenders", () => {
    // USER_ENTERED runs a cell starting = + - @ (or a tab or CR) as a formula.
    // The Base44 copy is a hand duplicate of _shared/sheets.ts's sheetCell.
    const rule = "return /^[=+\\-@\\t\\r]/.test(s) || /^0\\d+$/.test(s) ? `'${s}` : s;";
    expect(read(join(REPO_ROOT, "supabase/functions/_shared/sheets.ts"))).toContain(rule);
    expect(contacts).toContain(rule);
    expect(read(join(REPO_ROOT, "supabase/functions/_shared/sheets.ts"))).toContain("row.map(sheetCell)");
  });

  it("keeps the column order identical in both writers", () => {
    const columns = Object.entries(writers).map(
      ([, src]) => block(src, "const SHEET_COLUMNS = [", "];"),
    );
    expect(columns[0]).toBe(columns[1]);
    // Counting quoted headers rather than commas — the list carries a trailing
    // one. Nineteen since the interview's own fields earned columns: the four
    // asked in every interview, the agreed slot, and the completeness count.
    //
    // That a *row* is this long is checked where it can be: the integration
    // suite reads the body actually posted to Sheets and compares its length
    // against this list. A source scan cannot count array elements past the
    // first comment containing a comma.
    expect(columns[0].match(/'[^']+'/g) ?? []).toHaveLength(19);
  });

  it("labels every customer event with a type", () => {
    // The column exists so the sheet can be filtered by what happened.
    expect(writers.submitLead).toMatch(/'consultation_request'/);
    expect(writers.submitLead).toMatch(/'detailed_enquiry'/);
    expect(writers.submitLead).toMatch(/'quick_contact'/);
    expect(writers.submitLead).toMatch(/'interview_summary'/);
    expect(writers.escalateToHuman).toMatch(/'conversation_escalation'/);
  });

  it("never lets a failed append cost the enquiry", () => {
    // The sheet is a view, not the record. The lead write is the only hard failure.
    // The two functions that answer a visitor collect the failure into the
    // `warnings` they already return; the support log has nothing else to report,
    // so it answers `ok: true` and carries the warning with it. What neither may
    // do is let the throw escape.
    for (const [name, src] of Object.entries({ ...writers })) {
      // The catch body, whatever else it now contains — a log line sits in
      // front of the push, and pinning the two as adjacent would fail on a
      // change that cannot affect the behaviour this guards.
      const catchBody = src.slice(src.indexOf("catch (e) {", src.indexOf("await appendSheetRow(")));
      const body = catchBody.slice(0, catchBody.indexOf("\n    }"));
      expect(body, `${name} must record a sheet failure`).toMatch(/sheet_append_failed/);
      expect(body, `${name} must not throw on a sheet failure`).not.toMatch(/\bthrow\b/);
      // Returning the sentinel status is the ordinary shape once the append runs
      // as a promise beside the calendar; what must never appear is a return
      // that ends the request and skips the notifications.
      expect(body, `${name} must not end the request on a sheet failure`).not.toMatch(
        /return\s*;|return\s+Response/,
      );
    }
    const supportCatch = supportLog.slice(
      supportLog.indexOf("catch (e) {", supportLog.indexOf("await appendSheetRow(")),
    );
    expect(supportCatch.slice(0, supportCatch.indexOf("\n    }"))).toMatch(
      /ok: true[\s\S]*sheet_append_failed|sheet_append_failed[\s\S]*ok: true/,
    );
  });

  it("skips quietly until a spreadsheet is configured", () => {
    // A fresh clone, or a deploy without the sheet, still takes enquiries: the
    // one shared appender answers 'לא מוגדר' instead of throwing.
    const appender = read(join(REPO_ROOT, "supabase/functions/_shared/sheets.ts"));
    expect(appender).toMatch(/if \(!sheetId\) return 'לא מוגדר'/);
    for (const src of Object.values(writers)) expect(src).toMatch(/appendSheetRow\(/);
  });
});

/**
 * The contact behind the enquiries.
 *
 * `Lead` is an event: one enquiry, at one moment, with whatever was said in it.
 * `Contact` is the person those enquiries came from, and WhatsApp is why it
 * exists — there, the phone number arrives with the message, before a name and
 * before any consent screen, and the same person can write again next month
 * from the same number with nothing to tie the two together.
 *
 * Two failures are worth pinning. The first is quiet duplication: the number
 * spelled `972…` by the channel and `05…` by the site is one person, and two
 * rows mean Dorit rings someone she has already spoken to as a stranger. The
 * second is the channel's own hazard — a number that was never requested is
 * still personal data, and a person who was never asked has to be told what was
 * kept and be able to have it removed.
 */
describe("the contact record behind the enquiries", () => {
  const contacts = read(join(REPO_ROOT, "base44/functions/upsertContact/entry.ts"));
  const entity = read(join(REPO_ROOT, "base44/entities/Contact.jsonc"));
  const support = loadAgent("support_agent");

  it("keys the record on the phone number and nothing else", () => {
    expect(entity).toMatch(/"required":\s*\[\s*"phone"\s*\]/);
    expect(contacts).toMatch(/Contact\.filter\(\{ phone: key \}\)/);
  });

  it("normalises the number before it becomes a key", () => {
    // Without this the entity has three rows for one person and the filter
    // above matches none of them.
    expect(contacts).toMatch(/function normalisePhone\(/);
    expect(contacts).toMatch(/startsWith\('972'\)/);
  });

  it("asks for nothing the agency has no reason to hold", () => {
    // Minimisation under חוק הגנת הפרטיות: the fields are the ones needed to
    // call someone back. An ID number, a policy number or anything medical has
    // no field to land in, so a prompt change alone cannot start storing them.
    const fields = Object.keys((parseJsonc(entity) as { properties: Record<string, unknown> }).properties);
    expect(fields).toEqual(["phone", "name", "email", "channel", "notes", "last_seen"]);
  });

  it("redacts the free-text note the way every other model-written text is", () => {
    expect(contacts).toMatch(/const safeNotes = redact\(notes\)/);
  });

  it("returns what was stored, so a caller can read it back rather than guess", () => {
    // The confirmation step this exists for: a number kept without being asked
    // for has to be disclosed, correctable and erasable, and an agent that
    // recited the request instead of the record would be confirming nothing.
    expect(contacts).toMatch(/saved: \{ phone: key/);
  });

  it("is wired to no agent, and is dormant until a channel needs it", () => {
    // Built, tested and switched off. `support_agent` is the only agent that
    // would call it, and it answers in the site chat where there is no phone
    // number to key on — so the tool is not on its list. Enabling a channel is
    // then a deliberate act, not a prompt edit.
    for (const name of agentNames) {
      const fns = (loadAgent(name).tool_configs ?? []).map((t) => t.function_name);
      expect(fns, `${name} can write contacts`).not.toContain("upsertContact");
    }
  });

  it("writes new contacts to their own tab, not the event log", () => {
    // Same spreadsheet, different sheet. A row per message would turn the list
    // of people into a second event log, and one of those already exists.
    expect(contacts).toMatch(/SHEET_TAB_CONTACTS.*\|\| 'Contacts'/);
    expect(contacts).toMatch(/if \(created\) \{/);
  });

  it("sends no mail when someone says hello", () => {
    expect(contacts).not.toMatch(/sendMail|SendEmail|MAILER_URL/);
  });

  it("keeps the record admin-only, like the leads it sits beside", () => {
    const rls = (parseJsonc(entity) as { rls: Record<string, unknown> }).rls;
    expect(rls.create).toBe(true);
    for (const op of ["read", "update", "delete"]) {
      expect(rls[op], op).toEqual({ user_condition: { role: "admin" } });
    }
  });
});

/**
 * The support chat on the site, and the record it keeps.
 *
 * A chat that keeps its transcript has to say so before it starts, and the
 * notice the interview shows describes different processing entirely: it
 * promises that a name and a phone number are collected, which here would be a
 * precise description of something that does not happen. So this chat carries
 * its own notice, and these pin it — because the failure is the quiet kind. The
 * wrong notice rendering here would look entirely correct.
 */
describe("the support chat on the site", () => {
  const support = loadAgent("support_agent");
  const log = edgeBundle("log-support-chat");
  const agentsConfig = read(join(REPO_ROOT, "src/config/agents.ts"));
  const compliance = read(join(REPO_ROOT, "src/config/compliance.ts"));
  const faqPage = read(join(REPO_ROOT, "src/pages/FAQPage.tsx"));

  it("collects nothing, having been given nothing to collect", () => {
    expect(support.instructions).toMatch(/אין בידך שום פרט מזהה עליו/);
    expect(support.instructions).toMatch(/מופנה לראיון ההיכרות/);
  });

  it("is mounted where the answered questions run out", () => {
    expect(agentsConfig).toMatch(/agent: "support_agent"/);
    expect(agentsConfig).toMatch(/sectionId: "support-chat"/);
    expect(faqPage).toMatch(/<AgentChat descriptor=\{AGENTS\.support\} \/>/);
  });

  it("shows a notice written for this chat rather than for the interview", () => {
    // The interview's notice promises that a name and a phone number are
    // collected. Shown here it would be a precise description of processing
    // that does not happen — and consent to that is not consent to this.
    expect(agentsConfig).toMatch(/consentPoints: SUPPORT_CONSENT_POINTS/);
    expect(compliance).toMatch(/export const SUPPORT_CONSENT_POINTS/);
    const points = compliance.slice(compliance.indexOf("SUPPORT_CONSENT_POINTS"));
    expect(points).toContain("תוכן השיחה נשמר אצל דורית");
    // The licence and the affiliation are interpolated from LICENCE, the same
    // source the interview's notice reads — that is the point of sharing it.
    expect(points).toContain("${LICENCE.entity} בעלת רישיון סוכן מ${LICENCE.regulator}");
    expect(points).not.toContain("נאספים שם וטלפון בלבד");
  });

  it("keeps the fence published beside the free chat too", () => {
    const descriptor = agentsConfig.slice(agentsConfig.indexOf('agent: "support_agent"'));
    expect(descriptor.slice(0, descriptor.indexOf("},\n  blogRecommender"))).toMatch(/guardrails/);
  });

  it("logs the conversation once, at the end, and says nothing about it", () => {
    expect(support.instructions).toMatch(/רישום השיחה — פעם אחת, בסופה/);
    expect(support.instructions).toMatch(/logSupportChat/);
    expect(support.instructions).toMatch(/קריאה אחת לשיחה/);
    expect(support.instructions).toMatch(/אל תדווח עליו/);
  });

  it("leans on the notice for disclosure rather than repeating it", () => {
    // Silence about the logging is fine here precisely because the visitor
    // accepted a notice before typing — which is why the notice has to say it,
    // and why the case above fails if it stops.
    expect(support.instructions).toMatch(/כבר נאמרה למבקר בהודעת ההסכמה/);
  });

  it("writes the support log to its own tab, with a fixed set of outcomes", () => {
    expect(log).toMatch(/SHEET_TAB_SUPPORT'\) \|\| 'Support'/);
    expect(log).toMatch(/const OUTCOMES: Record<string, string> = \{/);
    expect(log).toMatch(/OUTCOMES\[outcome\] \|\| 'לא ידוע'/);
  });

  it("redacts the transcript before it is written anywhere", () => {
    expect(log).toMatch(/const safeTranscript: string = redact\(transcript\)/);
    expect(log).toMatch(/const safeTopic: string = redact\(topic\)/);
  });

  it("keys the support row on the same normalised number as the contact list", () => {
    // The site chat sends no number, so today this column is always empty.
    // It is pinned anyway: two tabs of one spreadsheet normalised differently
    // cannot be read together, and that would surface on the day a channel
    // that does have a number is switched on — long after this was written.
    // The Edge copy is TypeScript, so the two are compared by what they return.
    const compile = (src: string, ts: boolean) => {
      const start = src.indexOf("function normalisePhone(");
      expect(start, "normalisePhone is missing").toBeGreaterThan(-1);
      const fn = src.slice(start, src.indexOf("\n}", start) + 2);
      const js = ts ? transformSync(fn, { loader: "ts" }).code : fn;
      return new Function(`${js}; return normalisePhone;`)() as (raw: unknown) => string;
    };
    const edge = compile(log, true);
    const base44 = compile(read(join(REPO_ROOT, "base44/functions/upsertContact/entry.ts")), false);
    for (const raw of ["0501234567", "+972 50-123-4567", "972501234567", "501234567", "", null, undefined, "abc"]) {
      expect(edge(raw), String(raw)).toBe(base44(raw));
    }
  });

  it("gives the agent the tool it is told to call", () => {
    const names = (support.tool_configs ?? []).map((t) => t.function_name ?? t.entity_name);
    expect(names).toContain("logSupportChat");
  });
});

/**
 * The reading recommender's notice — the one-line version Dorit's compliance
 * adviser approved on 2026-10-10 (COMPLIANCE.md §9). Same failure as the
 * support chat's: it used to show the interview's notice, which promises a name
 * and a phone are collected for a meeting. The wording is the adviser's; these
 * pin it, so an edit cannot drift from what was approved without failing here.
 */
describe("the reading recommender's notice", () => {
  const agentsConfig = read(join(REPO_ROOT, "src/config/agents.ts"));
  const compliance = read(join(REPO_ROOT, "src/config/compliance.ts"));
  const points = compliance.match(
    /export const BLOG_RECOMMENDER_CONSENT_POINTS = \[([\s\S]*?)\] as const;/
  )?.[1];

  it("is its own, not the interview's", () => {
    const descriptor = agentsConfig.slice(agentsConfig.indexOf('agent: "blog_recommender"'));
    expect(descriptor).toMatch(/consentPoints: BLOG_RECOMMENDER_CONSENT_POINTS/);
    expect(points, "no BLOG_RECOMMENDER_CONSENT_POINTS").toBeDefined();
    expect(points).not.toContain("נאספים שם וטלפון בלבד");
  });

  it("carries the approved line, word for word", () => {
    expect(points).toContain('"עוזר אוטומטי של דורית, לא ייעוץ. אין לכתוב תעודת זהות או מספרי פוליסה."');
  });

  it("keeps the licence and the affiliation beside it", () => {
    expect(points).toContain("${LICENCE.entity} בעלת רישיון סוכן מ${LICENCE.regulator}");
    expect(points).toMatch(/שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי/);
  });

  it("came with a new consent version, so a stamp resolves to one wording", () => {
    expect(compliance).toMatch(/CONSENT_VERSION = "2026-10-agents-v5"/);
  });
});

/**
 * The pension clearing house, offered without an identity number.
 *
 * A full pension picture pulled before the meeting is the single largest
 * improvement available to a first meeting, and the agency asked for it. The
 * obvious implementation — have the agent ask for a ת״ז — does not work and is
 * not safe: the clearing house answers a licence holder only against the
 * client's signed authorisation (חוק הפיקוח על שירותים פיננסיים (ייעוץ, שיווק
 * ומערכת סליקה פנסיונית), התשס״ה-2005), so an identity number typed into a chat
 * advances nothing while placing a national ID in the lead, three mailboxes and
 * a spreadsheet — after the visitor accepted a notice telling them not to
 * provide one.
 *
 * So the interview collects intent, and the signature is gathered by Dorit in a
 * channel meant for it. These pin that shape against a future edit that decides
 * asking would be simpler.
 */
describe("the clearing-house offer", () => {
  const interview = loadAgent("needs_interview");
  const submitLead = edgeBundle("submit-lead");

  it("offers the pull and names what it actually requires", () => {
    expect(interview.instructions).toMatch(/מסלקה/);
    expect(interview.instructions).toMatch(/ייפוי כוח חתום/);
  });

  it("forbids asking for an identity number, for this or anything else", () => {
    expect(interview.instructions).toMatch(/אסור לך לבקש תעודת זהות, גם לא לצורך הזה/);
    // And still forbids recording one that arrives unasked.
    expect(interview.instructions).toMatch(/אל תרשום אותה לשום שדה/);
  });

  it("keeps the field a flag rather than a place to put a number", () => {
    expect(submitLead).toMatch(/\['clearinghouse', 'שליפת נתוני מסלקה — מעוניין\/ת'\]/);
    // `INTERVIEW_COMMON`, so every track carries it: someone who came about
    // life cover still has a pension.
    const common = submitLead.slice(
      submitLead.indexOf("const INTERVIEW_COMMON = ["),
      submitLead.indexOf("];", submitLead.indexOf("const INTERVIEW_COMMON = [")),
    );
    expect(common).toContain("clearinghouse");
  });

  it("promises nothing about what the pull will show", () => {
    // §2 bars figures and opinions on whether an action is worthwhile; an
    // agent that said "this usually saves people money" would breach it while
    // sounding helpful.
    expect(interview.instructions).toMatch(/אל תבטיח מה השליפה תגלה/);
    expect(interview.instructions).toMatch(/אל תתאר אותה כ'ייעוץ'/);
  });

  it("leaves the ban on identity documents intact everywhere else", () => {
    // The whole point of the arrangement: this feature was added without
    // loosening the clause that made it necessary to think about.
    for (const name of agentNames) {
      expect(loadAgent(name).instructions, name).toMatch(/אל תבקש לעולם: תעודת זהות/);
    }
  });
});

/**
 * Warmth, and the line it must not cross.
 *
 * People come to this interview to talk about money, retirement, who depends on
 * them and occasionally what happens when they are gone. Many arrive
 * embarrassed — that they never checked, never understood what they signed,
 * kept putting it off — and an agent that reads as a form being filled in is
 * the failure mode this guidance exists to prevent.
 *
 * But warmth has a boundary here that it does not have elsewhere, and it is a
 * regulatory one rather than a stylistic one. The agent may reassure about the
 * *feeling* and never about the *situation*: "that sounds stressful, and it is
 * good that you started looking" is kind; "nothing to worry about", "that
 * sounds fine", "you are probably owed a refund" are opinions on a person's
 * financial position, which §2 forbids as squarely as quoting a number. The
 * cases below pin both halves, because an instruction to be more empathetic is
 * exactly the kind of edit that quietly deletes the second one.
 */
describe("how the interview speaks to people", () => {
  const interview = loadAgent("needs_interview");

  it("answers the person before it moves to the next field", () => {
    expect(interview.instructions).toMatch(/ענה לאדם לפני שאתה ממשיך לשדה/);
    expect(interview.instructions).toMatch(/פיטורים, גירושין, מחלה/);
  });

  it("treats not knowing as normal rather than as a failed test", () => {
    // Most people do not know their management fees. Someone made to feel
    // stupid about that stops answering honestly, and the interview is worth
    // less than it was.
    expect(interview.instructions).toMatch(/נרמל את מה שהוא לא יודע/);
    expect(interview.instructions).toMatch(/לעולם אל תיתן לו להרגיש שנכשל במבחן/);
  });

  it("slows down where the questions actually frighten people", () => {
    expect(interview.instructions).toMatch(/היה עדין במיוחד בשלוש נקודות/);
  });

  it("separates comforting the feeling from reassuring about the situation", () => {
    // The whole point. Empathy is licensed; opinion is not.
    expect(interview.instructions).toMatch(/חום אינו הבטחה/);
    expect(interview.instructions).toMatch(/מותר לך להרגיע לגבי \*\*הרגש\*\*/);
    expect(interview.instructions).toMatch(/אסור לך להרגיע לגבי \*\*המצב\*\*/);
    // Named, so the model has instances rather than a principle to interpret.
    for (const forbidden of ["אין מה לדאוג", "זה נשמע בסדר", "בטח מגיע לך החזר"]) {
      expect(interview.instructions, forbidden).toContain(forbidden);
    }
  });

  it("does not let warmth become a way of extracting more", () => {
    expect(interview.instructions).toMatch(/אל תשתמש באמפתיה כדי לשכנע/);
  });

  it("still forbids the opinions warmth is most tempted to offer", () => {
    // "That sounds high" about a fee is the likeliest breach of all, because it
    // feels like sympathy rather than advice.
    expect(interview.instructions).toMatch(/'זה נשמע גבוה' על דמי ניהול הוא חוות דעת/);
  });
});

/**
 * The financial practice, as the `<head>` describes it.
 *
 * The visible components were disciplined about this — Hero carries a comment
 * explaining that none of its copy says ייעוץ, because the licence is a סוכן
 * licence with a זיקה to institutions and "ייעוץ פנסיוני" names a regulated
 * activity she does not hold a licence for. The `<head>` was not: the title,
 * every description, the keywords and the JSON-LD organisation name all
 * advertised ייעוץ, and the structured data is what an AI assistant quotes.
 */
describe("what the head claims the practice is", () => {
  const html = read(join(REPO_ROOT, "index.html"));
  const llms = read(join(REPO_ROOT, "public/llms.txt"));

  it("never advertises a licensed activity she does not hold", () => {
    // `llms.txt` may cite the law by name; the head has no such reason.
    expect(html).not.toMatch(/ייעוץ/);
  });

  it("still carries the financial terms people search for", () => {
    for (const term of ["פנסיה", "גמל", "השתלמות", "מיסוי", "קיבוע זכויות", "תיקון 190", "דמי ניהול"]) {
      expect(html, term).toContain(term);
    }
  });

  it("names the organisation as the entity that holds the licence", () => {
    expect(html).toContain("דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח");
  });

  it("describes the same five pillars the site displays", () => {
    // `llms.txt` is the only surface a non-JS crawler reads in full, and it
    // used to list a set of pillars the page had stopped showing.
    // The pillars' words live in the resource file since English and French
    // (src/i18n/locales/he/home.json); the component says which ones exist.
    const matrix =
      read(join(REPO_ROOT, "src/components/dorit/sections/ServiceMatrix.tsx")) +
      read(join(REPO_ROOT, "src/i18n/locales/he/home.json"));
    for (const pillar of [
      "פנסיה, גמל והשתלמות",
      "מיסוי וקיבוע זכויות",
      "דמי ניהול ועלויות",
      "ביטוחי חיים ובריאות",
      "סנגור תביעות",
    ]) {
      expect(matrix, `the page lost the ${pillar} pillar`).toContain(pillar);
      expect(llms, `llms.txt does not list ${pillar}`).toContain(pillar);
    }
  });

  it("promises no outcome in the copy that sells the service", () => {
    // §2 binds the marketing copy exactly as it binds the agents.
    const matrix = read(join(REPO_ROOT, "src/components/dorit/sections/ServiceMatrix.tsx"));
    const hero = read(join(REPO_ROOT, "src/components/dorit/sections/Hero.tsx"));
    // The home page's words, in every language (src/i18n/locales/<lang>/home.json).
    const homeHe = read(join(REPO_ROOT, "src/i18n/locales/he/home.json"));
    for (const [name, src] of Object.entries({ matrix, hero, html, homeHe })) {
      expect(src, `${name} promises a return`).not.toMatch(/נחסוך לך|תחסכו|מובטח|רווח מובטח/);
    }
    const homeEn = read(join(REPO_ROOT, "src/i18n/locales/en/home.json"));
    const homeFr = read(join(REPO_ROOT, "src/i18n/locales/fr/home.json"));
    // "garanties" is French for insurance cover, and the disclaimer says results
    // are "not guaranteed": the patterns name a promised return, not the word.
    expect(homeEn, "home.json (en) promises a return").not.toMatch(/we(?:'ll| will) save you|you(?:'ll| will) save|guaranteed (?:return|saving|profit)/i);
    expect(homeFr, "home.json (fr) promises a return").not.toMatch(/vous fera économiser|vous économiserez|(?:rendement|gain|économie)s? garanti/i);
  });
});
/**
 * The whole agent configuration except the prose.
 *
 * The prompts are pinned clause by clause above, because a reworded paragraph
 * is the drift everyone expects. This pins everything that is *not* a prompt,
 * because the drift that actually took the site down came from the other
 * direction: `7bce20c` — a Builder "Update base44 packages" commit — wrote out
 * the full agent schema and stamped eighteen previously-absent server defaults
 * into all three files at once. Two of the eighteen carried behaviour.
 * `allow_anonymous_access: false` returned 401 on every conversation and killed
 * every chat on the site for ten days (A-42). `memory_config` decided whether
 * three agents that anonymous strangers share retain what they are told. The
 * review that merged it could not have caught either: the diff was seventy
 * lines of `\uXXXX`-escaped Hebrew with the flags buried in it.
 *
 * So the test reads that diff for you. Any key the platform adds, or any value
 * a regeneration changes, fails here and names itself, and the only way to go
 * green is for a person to open this file and type the new value on purpose.
 *
 * `toEqual` against a literal, deliberately — never `toMatchSnapshot` or
 * `toMatchInlineSnapshot`. `vitest -u` rewrites a snapshot mechanically, with
 * nobody reading the delta, which reproduces the exact failure this exists to
 * prevent, one layer up.
 */
const NON_PROMPT_SURFACE = {
  context_files: [],
  app_user_connector_configs: [],
  selected_skill_names: [],
  selected_workspace_skill_ids: [],
  // Worth a decision of its own one day: the model behind a compliance-critical
  // prompt can change without a commit. Pinned here so at least the *setting*
  // cannot change without one.
  model: "automatic",
  whatsapp_greeting: null,
  telegram_greeting: null,
  line_greeting: null,
  // Off, deliberately. `scope: "both"` includes a bucket shared across all end
  // users, and every one of these chats is reached by anonymous visitors who
  // are indistinguishable from one another — so "remember across conversations"
  // and "remember across strangers" are the same setting here. The prompts are
  // built around collecting the minimum and forgetting it; agent memory is
  // platform-side, upstream of every guardrail this repo owns, and a
  // `privacy_request` handoff cannot reach it. The scope is left as-is rather
  // than tidied: with `enabled: false` it selects nothing, and changing two
  // fields would make a future diff harder to read than changing one.
  memory_config: {
    enabled: false,
    scope: "both",
    include_other_conversation_context: false,
    instructions: null,
  },
  voice_config: { voice_id: null },
  emails_settings: null,
  // The flag whose silent flip to `false` returned 401 on every conversation.
  // Also asserted on its own above, where the failure message can say what it
  // costs a visitor; here it is one field among the eighteen.
  allow_anonymous_access: true,
} as const;

/** Capability, per agent. The one place a new tool cannot arrive unnoticed. */
const TOOL_CONFIGS: Record<string, unknown[]> = {
  blog_recommender: [
    { entity_name: "BlogPost", allowed_operations: ["read"] },
    { function_name: "escalateToHuman" },
  ],
  // No calendar function: `submitLead` writes the diary itself, server-side, in
  // the request that saved the lead. See "does not ask the model to book the
  // diary as a second step".
  needs_interview: [
    { function_name: "submitLead" },
    { function_name: "escalateToHuman" },
  ],
  support_agent: [
    { entity_name: "BlogPost", allowed_operations: ["read"] },
    { function_name: "logSupportChat" },
    { function_name: "escalateToHuman" },
  ],
  // Same capability as the support agent, and deliberately no more. It answers
  // from published content and the regulator's own sites; it writes nothing,
  // books nothing, and collects nothing — a visitor who wants to be called back
  // is sent to the interview, which is built to ask for that.
  procedures_agent: [
    { entity_name: "BlogPost", allowed_operations: ["read"] },
    { function_name: "logSupportChat" },
    { function_name: "escalateToHuman" },
  ],
};

/** Everything in the file that is configuration rather than prose. */
const nonPromptSurface = (name: string): Record<string, unknown> => {
  const raw = parseJsonc(
    readFileSync(join(AGENTS_DIR, `${name}.jsonc`), "utf8")
  ) as Record<string, unknown>;
  delete raw.instructions;
  delete raw.description;
  raw.tool_configs = (raw.tool_configs as Array<Record<string, unknown>>).map((tool) => {
    const copy = { ...tool };
    // A tool description is prose too, and is pinned by the compliance block.
    delete copy.description;
    return copy;
  });
  return raw;
};

describe("the configuration nobody typed by hand", () => {
  for (const name of agentNames) {
    it(`${name} carries exactly the settings someone chose`, () => {
      expect(nonPromptSurface(name)).toEqual({
        ...NON_PROMPT_SURFACE,
        tool_configs: TOOL_CONFIGS[name],
        name,
      });
    });
  }
});

/**
 * The public entry points' guards, duplicated because Base44 functions share
 * no module. A drifted copy is a hole in exactly one door: a looser isEmail or
 * greetingName in one function makes that one the relay again.
 */
describe("the guards on the no-sign-in functions", () => {
  const submitLead = edgeBundle("submit-lead");
  const submitClaim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
  const edgeClaim = read(join(REPO_ROOT, "supabase/functions/submit-claim/handler.ts"));
  const claimForm = read(join(REPO_ROOT, "src/components/dorit/forms/ClaimForm.tsx"));

  const topLevelFn = (src: string, name: string): string => {
    const start = src.indexOf(`function ${name}(`);
    expect(start, `${name} is missing`).toBeGreaterThan(-1);
    const end = src.indexOf("\n}", start);
    return src.slice(start, end + 2).replace(/\s+/g, " ").trim();
  };

  it("checks the address and the daily limit before every visitor confirmation", () => {
    for (const [name, src] of [["submitLead", submitLead], ["submitClaim", submitClaim], ["submit-claim", edgeClaim], ["submit-lead", read(join(REPO_ROOT, "supabase/functions/submit-lead/handler.ts"))]]) {
      // The send's own property line, not the log lines that mention the role.
      const at = src.search(/role: 'visitor',\s*\n/);
      expect(at, `${name} sends no visitor confirmation`).toBeGreaterThan(-1);
      const before = src.slice(Math.max(0, at - 2500), at);
      expect(before, `${name} mails an unchecked address`).toMatch(/!isEmail\(email\)/);
      expect(before, `${name} mails without the per-address limit`).toMatch(/confirm-to:/);
    }
  });

  it("offers the same claim types the confirmations recognise", () => {
    const list = (src: string) => {
      const m = src.match(/CLAIM_TYPES(?::[^=]*)? = \[([\s\S]*?)\]/);
      expect(m, "CLAIM_TYPES is missing").not.toBeNull();
      return [...m![1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    };
    expect(list(submitClaim)).toEqual(list(claimForm));
    expect(list(edgeClaim)).toEqual(list(claimForm));
  });
});

describe("a claim document stored in Supabase", () => {
  it("is marked the same way by the browser that uploads it and the function that signs it", async () => {
    const { CLAIM_DOCUMENT_REF_PREFIX } = await import("@/services/supabase/SupabaseUploadService");
    const handler = read(join(REPO_ROOT, "supabase/functions/submit-claim/handler.ts"));
    const m = handler.match(/STORAGE_REF_PREFIX = '([^']+)'/);
    expect(m?.[1]).toBe(CLAIM_DOCUMENT_REF_PREFIX);
    // The leads screen's details cell turns the ref into a "מסמך" button.
    const details = read(join(REPO_ROOT, "src/components/dorit/admin/LeadDetails.tsx"));
    expect(details).toContain("storage:claim-documents\\/");
  });
});
