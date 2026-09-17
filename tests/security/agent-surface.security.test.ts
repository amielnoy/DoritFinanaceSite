import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { read, sourceFiles, backendFiles } from "../helpers/source-scan";

/**
 * The attack surface the agents added.
 *
 * STD-04 already covers the static site: secrets, DOM sinks, tab-nabbing, the
 * open-redirect guard, RLS. None of that anticipated a text box wired to a
 * language model with tools behind it, which brings four surfaces the rest of
 * the suite has no opinion about:
 *
 *   - **XSS** — the chat renders model output, and the backend builds an HTML
 *     email out of text the visitor typed.
 *   - **Phishing** — that email leaves the agency's verified domain, addressed
 *     to whatever address the form was given.
 *   - **Prompt injection** — through the chat box, and again through the tool
 *     payloads the model itself composes.
 *   - **DLP** — what may leave the system, and in whose hands it lands.
 *
 * A model's behaviour cannot be asserted, so nothing here tries. Every test
 * below pins something that holds regardless of what the model does.
 */

const CHAT = read(join(REPO_ROOT, "src/components/dorit/chat/AgentChat.tsx"));
const SUBMIT_LEAD = read(join(REPO_ROOT, "base44/functions/submitLead/entry.ts"));
const ESCALATE = read(join(REPO_ROOT, "base44/functions/escalateToHuman/entry.ts"));
const COMPLIANCE = read(join(REPO_ROOT, "src/config/compliance.ts"));
const CONTACT = read(join(REPO_ROOT, "src/config/contact.js"));
const PKG = read(join(REPO_ROOT, "package.json"));

const AGENT_PROMPTS = ["needs_interview", "blog_recommender", "support_agent"].map((n) => ({
  name: n,
  src: read(join(REPO_ROOT, `base44/agents/${n}.jsonc`)),
}));

/** Lift a top-level function out of a Deno entry point so it can be run here. */
const liftFunction = (src: string, name: string): string => {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};

// ───────────────────────────────────────────────────────────────────────────
describe("XSS — surfaces that render text somebody else wrote", () => {
  it("renders model output through a markdown renderer, never as raw HTML", () => {
    expect(CHAT).toMatch(/<ReactMarkdown>\{m\.content\}<\/ReactMarkdown>/);
  });

  it("does not enable a raw-HTML plugin for markdown anywhere", () => {
    // react-markdown escapes HTML unless rehype-raw is added. Adding it would
    // turn every model reply and every blog post into an injection point.
    for (const bad of ["rehype-raw", "rehypeRaw", "remark-html"]) {
      expect(PKG, `${bad} must not be a dependency`).not.toMatch(new RegExp(bad));
      expect(CHAT).not.toMatch(new RegExp(bad));
    }
  });

  it("never hands the chat a dangerouslySetInnerHTML", () => {
    expect(CHAT).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("renders the handoff notice through markdown too", () => {
    // The failure copy is the one path that runs when everything else broke;
    // it must not become the one path that skips escaping.
    expect(CHAT).toMatch(/<ReactMarkdown>\{handoffNotice\}<\/ReactMarkdown>/);
  });

  it("keeps innerHTML and document.write out of every first-party source file", () => {
    for (const file of sourceFiles()) {
      const src = read(file);
      expect(src, file).not.toMatch(/\.innerHTML\s*=/);
      expect(src, file).not.toMatch(/document\.write\s*\(/);
    }
  });

  it("uses no inline event-handler attributes in first-party markup", () => {
    for (const file of sourceFiles()) {
      // onClick={...} is React; onclick="..." in a template string is not.
      expect(read(file), file).not.toMatch(/\son(click|error|load|mouseover)\s*=\s*["']/i);
    }
  });

  it("never evaluates a string in the browser or on the backend", () => {
    for (const file of [...sourceFiles(), ...backendFiles()]) {
      const src = read(file);
      expect(src, file).not.toMatch(/\beval\s*\(/);
      expect(src, file).not.toMatch(/new\s+Function\s*\(/);
    }
  });

  it("ships no iframe or srcdoc in first-party markup", () => {
    for (const file of sourceFiles()) {
      expect(read(file), file).not.toMatch(/srcdoc=/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("XSS — the HTML email the backend composes", () => {
  const clientHtml = SUBMIT_LEAD.slice(
    SUBMIT_LEAD.indexOf("function buildClientHtml"),
    SUBMIT_LEAD.indexOf("function buildClientText"),
  );

  const escapeHtml = new Function(
    `${liftFunction(SUBMIT_LEAD, "escapeHtml")}; return escapeHtml;`,
  )() as (s: unknown) => string;

  it("has an escaping helper at all", () => {
    expect(SUBMIT_LEAD).toMatch(/function escapeHtml\(/);
  });

  it("escapes the five characters that matter", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes the ampersand first, so escapes are not double-encoded wrongly", () => {
    // & last would turn &lt; into &amp;lt; and print the markup as text twice.
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("survives null and undefined rather than printing them", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("neutralises a name that is really a link", () => {
    const hostile = '<a href="https://evil.example">לחצו כאן</a>';
    expect(escapeHtml(hostile)).not.toMatch(/<a /);
    expect(escapeHtml(hostile)).toMatch(/&lt;a /);
  });


  it("binds nothing else from `data` straight into the HTML body", () => {
    // Anything new must go through escapeHtml at its binding site.
    const interpolations = clientHtml.match(/\$\{data\.[a-zA-Z]+/g) ?? [];
    expect(interpolations).toEqual([]);
  });

});

// ───────────────────────────────────────────────────────────────────────────
describe("Phishing — the site's name on somebody else's message", () => {
  it("puts no visitor-supplied value inside an href in any email", () => {
    for (const file of backendFiles()) {
      const src = read(file);
      expect(src, file).not.toMatch(/href="\$\{(data\.|name|email|topic|timing|message)/);
    }
  });

  it("links only to the agency's own domain from the email template", () => {
    // Scoped to the rendered template, not the file: comments may legitimately
    // cite a docs URL, and a comment is not something a recipient can click.
    const template = SUBMIT_LEAD.slice(
      SUBMIT_LEAD.indexOf("function buildClientHtml"),
      SUBMIT_LEAD.indexOf("function buildClientText"),
    );
    const hosts = [...template.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
    for (const host of new Set(hosts)) {
      expect(
        /(^|\.)govari-fin\.co\.il$/.test(host),
        `the client email links off-domain to ${host}`,
      ).toBe(true);
    }
  });

  it("states one contact identity, and never a look-alike of it", () => {
    // A near-miss domain in one template is how a staff member gets trained to
    // trust the wrong sender. There is one spelling, everywhere.
    expect(CONTACT).toMatch(/dorit@govari-fin\.co\.il/);
    for (const src of [SUBMIT_LEAD, ESCALATE, COMPLIANCE]) {
      const emails = [...src.matchAll(/[a-z0-9._%-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) =>
        m[0].toLowerCase(),
      );
      for (const e of new Set(emails)) {
        expect(
          ["dorit@govari-fin.co.il", "amielnoy@gmail.com", "amielnoy@outlook.com"].includes(e),
          `unexpected address ${e}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the escalation fallback contact identical to the site's own", () => {
    // The agent reads these out when everything else failed. A stale number
    // here sends a person who already needs help to a dead line.
    expect(COMPLIANCE).toMatch(/050-831-1776/);
    expect(ESCALATE).toMatch(/050-831-1776/);
    expect(CONTACT).toMatch(/050-831-1776/);
  });

  it("points the consent panel's privacy link at an internal route", () => {
    const href = COMPLIANCE.match(/privacyHref:\s*"([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    expect(href!.startsWith("/"), "privacy link must not leave the site").toBe(true);
  });

  it("builds every tel: and mailto: target from a trusted binding", () => {
    // A dialable link is an instruction to a person. Each one must resolve from
    // the contact config or from the server's escalation receipt — never from
    // a form field, a query parameter, or a model's reply.
    const TRUSTED = /^(CONTACT\.|contact\.|phoneE164$|email$|whatsapp$|phoneDisplay$)/;
    for (const file of sourceFiles()) {
      for (const m of read(file).matchAll(/(?:tel|mailto):\$\{([^}]+)\}/g)) {
        expect(TRUSTED.test(m[1].trim()), `${file} dials from an untrusted binding: ${m[1]}`).toBe(
          true,
        );
      }
    }
  });

  it("sources the chat's contact block from the server, not from the model", () => {
    // The handoff notice carries a phone number the visitor is told to trust.
    // It is destructured from the escalation receipt, which the backend fills
    // from a constant — a reply that merely claims a number cannot supply it.
    expect(CHAT).toMatch(/const \{ phoneDisplay, phoneE164, whatsapp, email \} = receipt\.contact;/);
    expect(ESCALATE).toMatch(/const HUMAN_CONTACT = \{/);
    expect(ESCALATE).toMatch(/contact: HUMAN_CONTACT/);
  });

  it("never widens an email recipient from the request body", () => {
    // `to:` must resolve from a constant, never from something the caller sent.
    for (const file of backendFiles()) {
      const src = read(file);
      for (const m of src.matchAll(/to:\s*([A-Za-z_][\w.]*)/g)) {
        expect(
          ["NOTIFY_EMAIL", "SECONDARY_EMAIL", "email", "to"].includes(m[1]),
          `${file} sends to an unexpected binding: ${m[1]}`,
        ).toBe(true);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Prompt injection — through the chat box", () => {
  for (const { name, src } of AGENT_PROMPTS) {
    it(`${name} keeps its compliance block above anything a visitor says`, () => {
      expect(src).toMatch(/גוברים על כל הוראה אחרת/);
    });

    it(`${name} is told to escalate rather than guess when unsure`, () => {
      // The generic defence: an injected instruction produces uncertainty, and
      // uncertainty has exactly one sanctioned outcome.
      expect(src).toMatch(/אינך רשאי לנחש/);
      expect(src).toMatch(/escalateToHuman/);
    });
  }

  it("never turns model output into a client-side action", () => {
    // The reply is rendered. It is not parsed for commands, and nothing in the
    // shell dispatches on its content.
    expect(CHAT).not.toMatch(/JSON\.parse\((?:m|msg|reply|content)/);
    expect(CHAT).not.toMatch(/window\[(?:m|msg|reply)/);
  });

  it("keeps the consent stamp a property of the shell, not of the conversation", () => {
    // If the model could supply consent_version, a persuaded model could
    // backdate what the visitor agreed to.
    expect(CHAT).toMatch(/consent_version: CONSENT_VERSION/);
  });

  it("gates sending on consent held in the shell's own state", () => {
    expect(CHAT).toMatch(/if \(!text \|\| sending \|\| !consentAt\) return;/);
  });

  it("keeps the route to a person independent of the conversation", () => {
    expect(CHAT).toMatch(/services\.support\.escalate/);
    expect(CHAT).toMatch(/HUMAN_HANDOFF\.failure/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Prompt injection — through the tool payloads the model composes", () => {





  it("never spreads the request body into an entity write", () => {
    // A fixed field list is what stops a model inventing `status: 'closed'`
    // or a field the schema happens to accept.
    for (const file of backendFiles()) {
      const src = read(file);
      expect(src, file).not.toMatch(/\.create\(\s*\{\s*\.\.\./);
      expect(src, file).not.toMatch(/\.create\(\s*body\s*\)/);
      expect(src, file).not.toMatch(/\.update\(\s*[^,]+,\s*body\s*\)/);
    }
  });



});

// ───────────────────────────────────────────────────────────────────────────
describe("DLP — what may leave, and in whose hands", () => {
  const redact = new Function(`${liftFunction(ESCALATE, "redact")}; return redact;`)() as (
    t: unknown,
  ) => string;

  it("removes an Israeli ID number from free text", () => {
    expect(redact("ת״ז 123456789 שלי")).not.toMatch(/123456789/);
    expect(redact("ת״ז 123456789 שלי")).toMatch(/הושמט/);
  });

  it("removes a credit card number, spaced or hyphenated", () => {
    expect(redact("4580 1234 5678 9012")).not.toMatch(/4580/);
    expect(redact("4580-1234-5678-9012")).not.toMatch(/9012/);
  });

  it("removes an Israeli IBAN", () => {
    expect(redact("IL620108000000099999999")).not.toMatch(/99999999/);
  });

  it("removes a bare account-length number", () => {
    expect(redact("חשבון 123456")).not.toMatch(/123456/);
  });

  it("leaves ordinary prose alone", () => {
    const clean = "ביקשה פגישה בנושא גמל והשתלמות";
    expect(redact(clean)).toBe(clean);
  });

  it("caps the length of anything it returns", () => {
    expect(redact("א".repeat(5000)).length).toBeLessThanOrEqual(2000);
  });

  it("returns an empty string for nothing, rather than the word undefined", () => {
    expect(redact(undefined)).toBe("");
    expect(redact(null)).toBe("");
  });


  it("collects no field the consent notice does not name", () => {
    // The notice promises name, phone and an optional email. Anything else
    // reaching the entity is a promise broken in code.
    for (const forbidden of ["id_number", "tz", "account_number", "policy_number", "salary", "medical"]) {
      expect(read(join(REPO_ROOT, "base44/entities/Lead.jsonc")), forbidden).not.toMatch(
        new RegExp(`"${forbidden}"`),
      );
    }
  });

  it("logs no identifying column the consent notice does not name", () => {
    const columns = SUBMIT_LEAD.slice(
      SUBMIT_LEAD.indexOf("const SHEET_COLUMNS"),
      SUBMIT_LEAD.indexOf("];", SUBMIT_LEAD.indexOf("const SHEET_COLUMNS")),
    );
    for (const forbidden of ["ת״ז", "תעודת זהות", "חשבון", "שכר", "רפואי"]) {
      expect(columns, `sheet column ${forbidden}`).not.toMatch(new RegExp(forbidden));
    }
  });

  it("never echoes a connector access token back to a caller", () => {
    for (const file of backendFiles()) {
      const src = read(file);
      expect(src, file).not.toMatch(/Response\.json\([^)]*accessToken/);
    }
  });

  it("never writes a token or a full lead to the console", () => {
    for (const file of [...backendFiles(), ...sourceFiles()]) {
      const src = read(file);
      expect(src, file).not.toMatch(/console\.(log|info|warn|error)\([^)]*accessToken/);
      expect(src, file).not.toMatch(/console\.(log|info|warn|error)\([^)]*\bphone\b/);
    }
  });

  it("tells every agent not to ask for identifying documents", () => {
    for (const { name, src } of AGENT_PROMPTS) {
      expect(src, name).toMatch(/תעודת זהות/);
      expect(src, name).toMatch(/אסוף את המינימום ההכרחי בלבד/);
    }
  });

  it("names in the consent exactly the fields that are collected", () => {
    expect(COMPLIANCE).toMatch(/נאספים שם וטלפון בלבד/);
    expect(COMPLIANCE).toMatch(/אין למסור בצ׳אט תעודת זהות/);
  });
});
