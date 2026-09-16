import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The mailer, executed.
 *
 * `dorit-mailer` is a Cloudflare Pages Function, so nothing else in this
 * repository runs it: it is outside `tsconfig.json`, it executes on Workers
 * rather than on the CI runner, and the Base44 suites stop at the HTTP call.
 *
 * It is also the one component here that is reachable from the open internet.
 * Everything else needs a Base44 session or a form on the site; this answers a
 * POST from anyone who knows the URL, and sends mail from the agency's verified
 * domain when it does. The token check is the whole of what stands between it
 * and a stranger sending branded mail as Dorit — which is why the first block
 * below is about refusing, not about delivering.
 */

const SOURCE = join(REPO_ROOT, "dorit-mailer/functions/api/send-email.js");

/** Load the Worker module in-process, the way the Base44 harness loads entries. */
async function loadMailer() {
  const { code } = transformSync(readFileSync(SOURCE, "utf8"), { loader: "js", format: "cjs" });
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func -- the point of this harness
  new Function("module", "exports", "fetch", code)(module, module.exports, globalThis.fetch);
  return module.exports as {
    onRequestPost: (ctx: { request: Request; env: Record<string, string> }) => Promise<Response>;
    onRequestOptions: (ctx: { env: Record<string, string> }) => Promise<Response>;
  };
}

const ENV = {
  RESEND_API_KEY: "re_test_key",
  MAIL_FROM: "Dorit <notifications@mail.govari-fin.co.il>",
  MAIL_TO: "dorit@govari-fin.co.il,amielnoy@gmail.com,amielnoy@outlook.com",
  MAILER_TOKEN: "test-only-token",
  ALLOWED_ORIGIN: "https://safe-arch-plan.base44.app",
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://mailer.test/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const AUTH = { Authorization: `Bearer ${ENV.MAILER_TOKEN}` };

const rendered = {
  type: "rendered",
  to: "dorit@govari-fin.co.il",
  subject: "סיכום ראיון היכרות — אורי לוי",
  html: "<p>פרופיל</p>",
  text: "פרופיל",
};

let sent: Array<Record<string, unknown>>;

beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    if (String(url).includes("api.resend.com")) {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: "resend-id" }), text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => "" };
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("dorit-mailer — who is allowed to send", () => {
  it("refuses a rendered message with no token", async () => {
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({ request: post(rendered), env: ENV });
    expect(res.status).toBe(401);
    expect(sent, "mail went out unauthenticated").toHaveLength(0);
  });

  it("refuses a rendered message with the wrong token", async () => {
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({
      request: post(rendered, { Authorization: "Bearer not-the-token" }),
      env: ENV,
    });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("refuses a caller-named recipient without a token, whatever the type", async () => {
    // Not only `rendered`: `to` on any payload would let a stranger point the
    // agency's verified domain at an address of their choosing.
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({
      request: post({ type: "contact", name: "x", phone: "0501234567", to: "victim@example.com" }),
      env: ENV,
    });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("refuses an ordinary contact submission too", async () => {
    // The contact and intake types were for a form posting from a browser, and
    // nothing does — the site talks to Base44 and Base44 talks to this. An
    // unauthenticated way into an endpoint that sends from a verified domain is
    // a surface with no user, so it is closed: there is one way in.
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({
      request: post({ type: "contact", name: "יעל", phone: "0521234567", message: "שלום" }),
      env: ENV,
    });
    expect(res.status).toBe(401);
    expect(sent, "an unauthenticated form submission sent mail").toHaveLength(0);
  });

  it("refuses an intake submission without a token", async () => {
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({
      request: post({ type: "intake", name: "יעל", phone: "0521234567", summary: "סיכום" }),
      env: ENV,
    });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("refuses everything when no token is configured at all", async () => {
    // A deployment that forgot MAILER_TOKEN must fail closed, not open.
    const mailer = await loadMailer();
    const { MAILER_TOKEN, ...noToken } = ENV;
    const res = await mailer.onRequestPost({ request: post(rendered, AUTH), env: noToken });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("accepts a rendered message with the right token", async () => {
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({ request: post(rendered, AUTH), env: ENV });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe("dorit-mailer — what it sends", () => {
  it("sends from the configured identity, not one the caller chose", async () => {
    const mailer = await loadMailer();
    await mailer.onRequestPost({
      request: post({ ...rendered, from: "attacker@example.com" }, AUTH),
      env: ENV,
    });
    expect(sent[0].from).toBe(ENV.MAIL_FROM);
  });

  it("replies to the agency, never to the visitor", async () => {
    // An operations copy forwarded to a client has to reply to Dorit.
    const mailer = await loadMailer();
    await mailer.onRequestPost({
      request: post({ ...rendered, email: "visitor@example.com" }, AUTH),
      env: ENV,
    });
    expect(sent[0].reply_to).toBe("dorit@govari-fin.co.il");
  });

  it("passes the rendered body through untouched", async () => {
    // The Base44 functions own the templates, the escaping and redact(). If
    // this rebuilt the message, that work would be silently discarded.
    const mailer = await loadMailer();
    await mailer.onRequestPost({ request: post(rendered, AUTH), env: ENV });
    expect(sent[0].html).toBe(rendered.html);
    expect(sent[0].subject).toBe(rendered.subject);
  });

  it("fans a form submission out to every configured mailbox", async () => {
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({
      request: post({ type: "contact", name: "יעל", phone: "0521234567", message: "שלום" }, AUTH),
      env: ENV,
    });
    expect(res.status).toBe(200);
    expect(sent.map((s) => (s.to as string[])[0]).sort()).toEqual(
      ["amielnoy@gmail.com", "amielnoy@outlook.com", "dorit@govari-fin.co.il"].sort(),
    );
  });

  it("refuses to run unconfigured rather than sending from nowhere", async () => {
    const mailer = await loadMailer();
    for (const key of ["RESEND_API_KEY", "MAIL_FROM", "MAIL_TO"]) {
      const env = { ...ENV, [key]: "" };
      const res = await mailer.onRequestPost({ request: post(rendered, AUTH), env });
      expect(res.status, `missing ${key}`).toBe(500);
    }
    expect(sent).toHaveLength(0);
  });
});

describe("dorit-mailer — failure", () => {
  it("still reports success when one mailbox is rejected and others go", async () => {
    // One bounced address must not decide whether anyone was told.
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body);
      if (payload.to?.[0] === "amielnoy@outlook.com") {
        return { ok: false, status: 422, json: async () => ({}), text: async () => "rejected" };
      }
      sent.push(payload);
      return { ok: true, status: 200, json: async () => ({ id: "resend-id" }), text: async () => "" };
    });
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({
      request: post({ type: "contact", name: "יעל", phone: "0521234567" }, AUTH),
      env: ENV,
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect((await res.json()).failed).toContain("http_422");
  });

  it("reports failure when no mailbox took it", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false, status: 500, json: async () => ({}), text: async () => "down",
    }));
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({ request: post(rendered, AUTH), env: ENV });
    expect(res.status).toBe(502);
  });

  it("never returns the provider's words, which can carry the key", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false, status: 401, json: async () => ({}),
      text: async () => "invalid api key re_test_key",
    }));
    const mailer = await loadMailer();
    const res = await mailer.onRequestPost({ request: post(rendered, AUTH), env: ENV });
    expect(JSON.stringify(await res.json())).not.toContain("re_test_key");
  });
});
