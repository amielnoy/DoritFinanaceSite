import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadEntity } from "../helpers/entity-schema";
import { read } from "../helpers/source-scan";

/**
 * The compliance contract of the three on-site agents.
 *
 * A prompt is the only thing standing between a visitor and an unlicensed
 * financial recommendation, and it is the easiest artefact in the repo to edit
 * casually — a Builder session, a reworded paragraph, and a mandatory clause is
 * gone with nothing failing. These tests pin the clauses that exist for legal
 * reasons rather than product ones, in all three prompts at once.
 *
 * They deliberately assert on text. That is the point: the wording is what a
 * compliance review approved, so the wording is what must not drift silently.
 */

const AGENTS_DIR = join(REPO_ROOT, "base44/agents");

interface AgentDefinition {
  name: string;
  description: string;
  instructions: string;
  tool_configs?: Array<{
    function_name?: string;
    entity_name?: string;
    allowed_operations?: string[];
  }>;
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

describe("on-site agent definitions", () => {
  it("ships exactly the agents the frontend renders", () => {
    // Two, where there were three. `booking_assistant` was merged into
    // `needs_interview`: booking a first meeting was never a separate errand
    // from being interviewed for one, and the visitor met a second chat that
    // asked for their name again after answering six questions.
    expect(agentNames).toEqual(["blog_recommender", "needs_interview", "support_agent"]);
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

  it("shows the standing disclaimer and the bot disclosure", () => {
    expect(chat).toMatch(/CHAT_DISCLAIMER/);
    expect(chat).toMatch(/BOT_DISCLOSURE/);
  });

  it("stamps every conversation with the consent version it was given under", () => {
    expect(chat).toMatch(/consent_version: CONSENT_VERSION/);
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
describe("who receives a lead, and whether the consent text admits it", () => {
  const submitLead = read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts"));
  const escalate = read(join(REPO_ROOT, "base44/functions/escalateToHuman/entry.ts"));
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
   * Does the outside recipient get the visitor's actual details?
   *
   * Read off the send itself, so the consent wording is checked against what
   * the code does rather than against what someone remembered. Both payload
   * shapes count, and both carry the whole lead: `agentBody` is the plain-text
   * notification, `buildAgentHtml(source, data, …)` the same fields laid out in
   * the site's palette. A send that stopped carrying either — a summary, a bare
   * "you have a new lead", nothing at all — is the only thing that makes this
   * false, and that is exactly when the narrower consent promise becomes the
   * honest one.
   *
   * This pattern has to keep up with the send. If it silently stops matching, the
   * suite does not go red on a leak — it goes red on the consent text, which is
   * the wrong end of the problem. The two assertions below are what catch it.
   */
  const outsideGetsFullLead =
    /for \(const to of NOTIFY_EMAILS\)/.test(submitLead) &&
    (/const opsHtml = buildAgentHtml\(\s*source,\s*data\b/.test(submitLead) ||
      /const opsText = `\$\{agentBody\}/.test(submitLead));

  it("reads the outside recipient's payload off a send that exists", () => {
    // Guards the detector above rather than the code: a renamed builder or a
    // reshaped SendEmail call would quietly turn every check in this block into
    // an assertion about a branch that no longer runs.
    expect(submitLead, "no ops mailbox list found at all").toMatch(/const NOTIFY_EMAILS = \[/);
    expect(submitLead, "nothing sends to the ops mailboxes").toMatch(/for \(const to of NOTIFY_EMAILS\)/);
    expect(
      outsideGetsFullLead,
      "a send to NOTIFY_EMAILS exists but carries neither agentBody nor buildAgentHtml — " +
        "if that is deliberate, narrow the consent text with it; if the call was just " +
        "reshaped, teach outsideGetsFullLead the new shape",
    ).toBe(true);
  });


  it("keeps the consent notice honest about the second recipient", () => {
    if (outsideGetsFullLead) {
      // The visitor's details leave the agency, so the notice may not claim
      // otherwise — and must say who else holds them.
      expect(
        consent,
        'submitLead sends the full lead to NOTIFY_EMAIL, so the consent text may no longer say "אצל דורית בלבד"',
      ).not.toMatch(/אצל דורית בלבד/);
      expect(consent).toMatch(/הצוות שמתפעל את האתר מטעמה/);
    } else {
      // Nothing identifying leaves, so the narrower promise is the honest one.
      expect(consent).toMatch(/אצל דורית בלבד/);
    }
  });

  it("keeps the privacy policy saying the same thing as the consent notice", () => {
    // Two screens, one fact. They drift when only one of them is remembered.
    if (outsideGetsFullLead) {
      expect(privacy).toMatch(/לצוות המתפעל את האתר/);
      expect(privacy).not.toMatch(/מוגבלת בהרשאות לדורית בלבד/);
    } else {
      expect(privacy).toMatch(/מוגבלת בהרשאות לדורית בלבד/);
    }
  });

  it("bumps CONSENT_VERSION past the wording the first notice shipped with", () => {
    // A record is tied to the text its visitor saw. Changing the text without
    // changing the version makes that link a lie.
    expect(consent).not.toMatch(/CONSENT_VERSION = "2026-09-agents-v1"/);
    expect(consent).toMatch(/CONSENT_VERSION = "2026-09-agents-v\d+"/);
  });



  /**
   * One team, spelled the same in three files.
   *
   * `NOTIFY_EMAILS` is the fourth thing Base44's isolated entry points force us
   * to duplicate, alongside `redact`, `escapeHtml` and `SHEET_COLUMNS`. It is
   * the one whose drift is hardest to see: a mailbox added to `submitLead` and
   * not to `escalateToHuman` produces no error anywhere — enquiries arrive, and
   * escalations, the messages that matter most, quietly reach one fewer person.
   */
  it("keeps the operations mailbox list identical in every function that mails", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    const listOf = (src: string, name: string) => {
      const i = src.indexOf("const NOTIFY_EMAILS = [");
      expect(i, `${name} declares no NOTIFY_EMAILS`).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("];", i)).replace(/\s+/g, " ").trim();
    };
    const lists = [
      listOf(submitLead, "submitLead"),
      listOf(escalate, "escalateToHuman"),
      listOf(claim, "submitClaim"),
    ];
    expect(lists[1], "escalateToHuman drifted from submitLead").toBe(lists[0]);
    expect(lists[2], "submitClaim drifted from submitLead").toBe(lists[0]);
    // And it is a list rather than a single address that happens to parse.
    expect(lists[0].match(/"[^"]+@[^"]+"/g) ?? []).not.toHaveLength(0);
  });

  it("keeps the Core-reachable list identical in every function that mails", () => {
    // `CORE_EMAILS` decides which transport a recipient takes. If the three
    // copies disagree, the same address is mailed one way by one function and
    // another way by the next — and the one that cannot deliver fails silently.
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    const listOf = (src: string, name: string) => {
      const i = src.indexOf("const CORE_EMAILS = [");
      expect(i, `${name} declares no CORE_EMAILS`).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("];", i)).replace(/\s+/g, " ").trim();
    };
    const lists = [
      listOf(submitLead, "submitLead"),
      listOf(escalate, "escalateToHuman"),
      listOf(claim, "submitClaim"),
    ];
    expect(lists[1], "escalateToHuman drifted from submitLead").toBe(lists[0]);
    expect(lists[2], "submitClaim drifted from submitLead").toBe(lists[0]);
  });

  it("never routes the agency through a transport that cannot reach her", () => {
    // The whole original defect in one assertion: Core delivers to registered
    // users, the agency is not one, and a copy that silently fails to her looks
    // the same as one that arrived.
    expect(submitLead).toMatch(/const CORE_EMAILS = \[/);
    const list = submitLead.slice(submitLead.indexOf("const CORE_EMAILS = ["));
    const addresses = list.slice(0, list.indexOf("];"));
    expect(addresses, "the agency is on the Core path").not.toContain("dorit@govari-fin.co.il");
  });

  it("gives every mailbox its own delivery attempt", () => {
    // One `try` around the whole loop would let the first bounce swallow the
    // rest of the list. The catch has to be inside the loop, in each function.
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    for (const [name, src] of [["submitLead", submitLead], ["submitClaim", claim]] as const) {
      const i = src.indexOf("for (const to of NOTIFY_EMAILS)");
      expect(i, `${name} does not loop the mailbox list`).toBeGreaterThan(-1);
      const loop = src.slice(i, i + 700);
      expect(loop, `${name} catches outside the loop`).toMatch(/try \{[\s\S]*?catch \(e\) \{/);
    }
  });

  it("keeps the mail layout helpers identical across the functions that render", () => {
    // `escalateToHuman` grew an HTML notification of its own, which meant
    // copying the palette helpers into a third entry point. Base44 gives these
    // files no shared module, so duplicated is the only option — drifted is
    // not, and a drifted `escapeHtml` is a phishing vector rather than a
    // cosmetic difference.
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    const norm = (src: string, name: string) => topLevelFn(src, name).replace(/\s+/g, " ").trim();
    for (const helper of ["escapeHtml", "detailRow", "block", "proseRow"]) {
      if (!escalate.includes(`function ${helper}(`)) continue;
      expect(norm(escalate, helper), `escalateToHuman.${helper} drifted`).toBe(norm(submitLead, helper));
    }
    expect(norm(claim, "escapeHtml"), "submitClaim.escapeHtml drifted").toBe(norm(submitLead, "escapeHtml"));
  });

  it("renders the handover rather than sending a paragraph", () => {
    // The mail Dorit opens on a phone to decide whether to call someone back.
    expect(escalate).toMatch(/function buildEscalationHtml\(/);
    expect(escalate).toMatch(/html: escalationHtml/);
    // And the text still travels with it, not instead of it.
    expect(escalate).toMatch(/text: notification/);
  });

  it("keeps every copy of redact() identical", () => {
    // Base44 functions are isolated entry points with no shared module, so the
    // helper is duplicated. Duplicated is fine; drifted is not.
    //
    // `upsertContact` is the third copy, and the one with the least forgiving
    // input: it redacts a note taken from a WhatsApp message, where people
    // paste an ID number or a policy number without being asked for one.
    const norm = (src: string) => topLevelFn(src, "redact").replace(/\s+/g, " ").trim();
    for (const fn of ["upsertContact", "logSupportChat"]) {
      const src = read(join(REPO_ROOT, `base44/functions/${fn}/entry.ts`));
      expect(norm(src), fn).toBe(norm(submitLead));
    }
    expect(norm(submitLead)).toBe(norm(escalate));
  });

  it("has the interview agent close the booking it used to hand off", () => {
    // The merge has to be real in the prompt, not only in the page: the agent
    // that collects the context is the one that agrees the meeting, and there
    // is no second agent left to send anyone to.
    const interview = loadAgent("needs_interview").instructions;
    expect(interview).toMatch(/תיאום הפגישה/);
    expect(interview).toMatch(/meetingTopic/);
    expect(interview).toMatch(/scheduledAt/);
    expect(interview).toMatch(/createConsultationEvent/);
    expect(interview).toMatch(/אל תפנה את המבקר לצ׳אט אחר/);
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

    it("says in so many words not to write the record directly", () => {
      expect(interview.instructions).toMatch(/אל תיצור רשומת Lead ישירות/);
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
      const fn = read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts"));
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
      const fn = read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts"));
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

    it("does not confirm a save that failed", () => {
      // Silence here is the bad failure: the visitor is told Dorit has their
      // summary, and she does not.
      expect(interview.instructions).toMatch(/אם submitLead נכשלה/);
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
  const submitLead = read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts"));
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

  it("renders both confirmations from the same template", () => {
    expect(norm(submitLead, "buildClientHtml")).toBe(norm(submitClaim, "buildClientHtml"));
  });

  it("escapes with the same helper in both", () => {
    expect(norm(submitLead, "escapeHtml")).toBe(norm(submitClaim, "escapeHtml"));
  });

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
        const allowed = /^\$\{(escapeHtml\(|detailRows|detailsBlock|divider)/;
        for (const binding of bindings) {
          expect(binding, `${fn}: unescaped binding`).toMatch(allowed);
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
    submitLead: read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts")),
    escalateToHuman: read(join(REPO_ROOT, "base44/functions/escalateToHuman/entry.ts")),
  };
  /** The other two writers, each on its own tab of the same spreadsheet. */
  const contacts = read(join(REPO_ROOT, "base44/functions/upsertContact/entry.ts"));
  const supportLog = read(join(REPO_ROOT, "base44/functions/logSupportChat/entry.ts"));

  const block = (src: string, start: string, close: string): string => {
    const i = src.indexOf(start);
    expect(i, `${start} is missing`).toBeGreaterThan(-1);
    return src.slice(i, src.indexOf(close, i) + close.length).replace(/\s+/g, " ").trim();
  };

  it("declares the connector both functions ask for", () => {
    const connector = read(join(REPO_ROOT, "base44/connectors/googlesheets.jsonc"));
    expect(connector).toMatch(/"type":\s*"googlesheets"/);
    expect(connector).toMatch(/auth\/spreadsheets/);
    // The narrower scope on purpose: drive would reach every other file.
    expect(connector).not.toMatch(/auth\/drive/);
    for (const src of Object.values(writers)) {
      expect(src).toMatch(/getConnection\('googlesheets'\)/);
    }
  });

  it("keeps the column order identical in both writers", () => {
    const columns = Object.entries(writers).map(
      ([, src]) => block(src, "const SHEET_COLUMNS = [", "];"),
    );
    expect(columns[0]).toBe(columns[1]);
    // And the row every writer builds has to be that long. Counting quoted
    // headers rather than commas — the list carries a trailing one.
    expect(columns[0].match(/'[^']+'/g) ?? []).toHaveLength(13);
  });

  it("keeps appendEventRow identical in every writer", () => {
    // Four copies now: the two event writers, `upsertContact` and
    // `logSupportChat`, each appending to a different tab of the same
    // spreadsheet. The tab and the columns differ between them — those are the
    // constants above it — but the append itself is one piece of code that
    // happens to exist four times.
    const fns = [...Object.values(writers), contacts, supportLog].map((src) =>
      block(src, "async function appendEventRow(", "\n}"),
    );
    for (const [i, fn] of fns.entries()) expect(fn, `copy ${i}`).toBe(fns[0]);
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
    // The sheet is a view, not the record. Lead.create is the only hard failure.
    // Two shapes of the same rule. The three functions that answer a visitor
    // collect the failure into the `warnings` they already return; the support
    // log has nothing else to report, so it answers `ok: true` and carries the
    // warning with it. What neither may do is let the throw escape.
    for (const [name, src] of Object.entries({ ...writers, upsertContact: contacts })) {
      // The catch body, whatever else it now contains — a log line was added
      // in front of the push, and pinning the two as adjacent would have made
      // this fail on a change that cannot affect the behaviour it guards.
      const catchBody = src.slice(src.indexOf("catch (e) {", src.indexOf("await appendEventRow(base44")));
      const body = catchBody.slice(0, catchBody.indexOf("\n    }"));
      expect(body, `${name} must record a sheet failure`).toMatch(/sheet_append_failed/);
      expect(body, `${name} must not throw on a sheet failure`).not.toMatch(/\bthrow\b|\breturn\b/);
    }
    // Same rule, different shape: it has nothing else to report, so it answers
    // `ok: true` and carries the warning rather than collecting it.
    const supportCatch = supportLog.slice(
      supportLog.indexOf("catch (e) {", supportLog.indexOf("await appendEventRow(base44")),
    );
    expect(supportCatch.slice(0, supportCatch.indexOf("\n    }"))).toMatch(
      /ok: true[\s\S]*sheet_append_failed|sheet_append_failed[\s\S]*ok: true/,
    );
  });

  it("skips quietly until a spreadsheet is configured", () => {
    // A fresh clone, or a deploy without the sheet, still takes enquiries.
    for (const src of Object.values(writers)) {
      expect(src).toMatch(/if \(!SHEET_ID\) return/);
    }
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
  const log = read(join(REPO_ROOT, "base44/functions/logSupportChat/entry.ts"));
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
    expect(log).toMatch(/SHEET_TAB_SUPPORT.*\|\| 'Support'/);
    expect(log).toMatch(/const OUTCOMES = \{/);
    expect(log).toMatch(/OUTCOMES\[outcome\] \|\| 'לא ידוע'/);
  });

  it("redacts the transcript before it is written anywhere", () => {
    expect(log).toMatch(/const safeTranscript = redact\(transcript\)/);
    expect(log).toMatch(/const safeTopic = redact\(topic\)/);
  });

  it("keys the support row on the same normalised number as the contact list", () => {
    // The site chat sends no number, so today this column is always empty.
    // It is pinned anyway: two tabs of one spreadsheet normalised differently
    // cannot be read together, and that would surface on the day a channel
    // that does have a number is switched on — long after this was written.
    const norm = (src: string) => {
      const start = src.indexOf("function normalisePhone(");
      expect(start, "normalisePhone is missing").toBeGreaterThan(-1);
      return src.slice(start, src.indexOf("\n}", start)).replace(/\s+/g, " ").trim();
    };
    expect(norm(log)).toBe(norm(read(join(REPO_ROOT, "base44/functions/upsertContact/entry.ts"))));
  });

  it("gives the agent the tool it is told to call", () => {
    const names = (support.tool_configs ?? []).map((t) => t.function_name ?? t.entity_name);
    expect(names).toContain("logSupportChat");
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
  const submitLead = read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts"));

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
