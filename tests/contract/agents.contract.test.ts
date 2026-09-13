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
  it("ships exactly the three agents the frontend renders", () => {
    expect(agentNames).toEqual(["blog_recommender", "booking_assistant", "needs_interview"]);
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

  /** Does the outside recipient get the visitor's actual details? */
  const outsideGetsFullLead = /to: NOTIFY_EMAIL,[\s\S]{0,240}?body: `\$\{agentBody\}/.test(submitLead);

  it("sends to both inboxes, and names them", () => {
    expect(submitLead).toMatch(/const NOTIFY_EMAIL = "amielnoy@gmail\.com"/);
    expect(submitLead).toMatch(/const SECONDARY_EMAIL = "dorit@govari-fin\.co\.il"/);
    expect(submitLead).toMatch(/to: SECONDARY_EMAIL,\s*\n\s*subject,\s*\n\s*body: agentBody,/);
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

  it("tells the operations copy apart with a status appendix", () => {
    const footer = topLevelFn(submitLead, "buildOpsFooter");
    expect(footer).toMatch(/מצב תפעולי/);
    expect(footer).toMatch(/יומן/);
    expect(footer).toMatch(/תקלות/);
  });

  it("redacts the conversation summary before it is sent anywhere", () => {
    expect(submitLead).toMatch(/const safeSummary = redact\(summary\)/);
    expect(submitLead).toMatch(/summary: safeSummary/);
  });

  it("keeps the two copies of redact() identical", () => {
    // Base44 functions are isolated entry points with no shared module, so the
    // helper is duplicated. Duplicated is fine; drifted is not.
    const norm = (src: string) => topLevelFn(src, "redact").replace(/\s+/g, " ").trim();
    expect(norm(submitLead)).toBe(norm(escalate));
  });

  it("has the booking agent compose a summary and hand it to submitLead", () => {
    const booking = loadAgent("booking_assistant").instructions;
    expect(booking).toMatch(/summary/);
    expect(booking).toMatch(/תקציר/);
    // And the same data-minimisation rule the rest of the layer runs on.
    expect(booking).toMatch(/אל תכלול ת"ז, מספרי חשבון או פוליסה/);
  });
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
    expect(columns[0].match(/'[^']+'/g) ?? []).toHaveLength(12);
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
