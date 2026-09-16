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
    expect(agentNames).toEqual(["blog_recommender", "needs_interview"]);
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

  it("keeps the two copies of redact() identical", () => {
    // Base44 functions are isolated entry points with no shared module, so the
    // helper is duplicated. Duplicated is fine; drifted is not.
    const norm = (src: string) => topLevelFn(src, "redact").replace(/\s+/g, " ").trim();
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

  it("keeps appendEventRow identical in both writers", () => {
    const fns = Object.values(writers).map((src) =>
      block(src, "async function appendEventRow(", "\n}"),
    );
    expect(fns[0]).toBe(fns[1]);
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
    for (const [name, src] of Object.entries(writers)) {
      expect(src, `${name} must not throw on a sheet failure`).toMatch(
        /catch \(e\) \{\s*warnings\.push\('sheet_append_failed'\);/,
      );
    }
  });

  it("skips quietly until a spreadsheet is configured", () => {
    // A fresh clone, or a deploy without the sheet, still takes enquiries.
    for (const src of Object.values(writers)) {
      expect(src).toMatch(/if \(!SHEET_ID\) return/);
    }
  });
});
