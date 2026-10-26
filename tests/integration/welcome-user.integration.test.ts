import { describe, expect, it, vi } from "vitest";
import type { FetchCall } from "../helpers/base44-function";
import { invokeEdge, SUPABASE_URL, type EdgeOptions } from "../helpers/edge-function";

/**
 * The welcome mail (supabase/functions/welcome-user): only for an account
 * whose address was confirmed in the last 30 minutes, once per account, never
 * when the limiter cannot answer, and with the first name only.
 */
const NEW = "new-session-token-0123456789";
const OLD = "old-session-token-0123456789";
const NO_DATE = "nodate-session-token-0123456789";
const NO_EMAIL = "noemail-session-token-0123456789";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function fakeSupabase(opts: { limiterDown?: boolean } = {}) {
  const accounts: Record<string, Record<string, unknown>> = {
    [NEW]: { id: "user-new", email: "Rachel.Levi@Example.com", email_confirmed_at: minutesAgo(3), user_metadata: { full_name: "רחל לוי" } },
    [OLD]: { id: "user-old", email: "old@example.com", email_confirmed_at: minutesAgo(31), user_metadata: { full_name: "דן" } },
    [NO_DATE]: { id: "user-nodate", email: "nodate@example.com", email_confirmed_at: null },
    [NO_EMAIL]: { id: "user-noemail", email: "", email_confirmed_at: minutesAgo(1) },
  };
  const counts = new Map<string, number>();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const upstream = (call: FetchCall): Response | undefined => {
    if (!call.url.startsWith(SUPABASE_URL)) return undefined;
    const url = new URL(call.url);
    const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
    if (url.pathname === "/auth/v1/user") {
      return accounts[token] ? json({ aud: "authenticated", ...accounts[token] }) : json({ code: 403, error_code: "bad_jwt" }, 403);
    }
    if (url.pathname === "/rest/v1/rpc/allow_submission") {
      if (opts.limiterDown) return json({ message: "down" }, 503);
      const { p_key, p_max } = call.body as { p_key: string; p_max: number };
      const n = counts.get(p_key) ?? 0;
      if (n >= p_max) return json(false);
      counts.set(p_key, n + 1);
      return json(true);
    }
    return undefined;
  };
  return { upstream, counts };
}

const welcome = (token: string | null, s: ReturnType<typeof fakeSupabase>, extra: EdgeOptions = {}) =>
  invokeEdge("welcome-user", {}, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), upstream: s.upstream, ...extra });

describe("welcome-user — who gets it", () => {
  it("mails a just-confirmed account once, to its address, with the first name only", async () => {
    const s = fakeSupabase();
    const r = await welcome(NEW, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ sent: true });
    expect(r.emails).toHaveLength(1);
    const mail = r.emails[0];
    expect(mail.to).toBe("rachel.levi@example.com");
    expect(mail.subject).toContain("ברוכים הבאים");
    expect(mail.text).toContain("שלום רחל,");
    expect(mail.text).toContain("https://govari-fin.co.il/account");
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain("לוי");
    expect([...s.counts.entries()]).toEqual([["welcome:user-new", 1]]);
  });

  it("sends it once: a second sign-in is answered already_sent and mails nothing", async () => {
    const s = fakeSupabase();
    expect((await welcome(NEW, s)).emails).toHaveLength(1);
    const again = await welcome(NEW, s);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ sent: false, reason: "already_sent" });
    expect(again.emails).toEqual([]);
  });

  it("gives nothing to an account confirmed more than 30 minutes ago, or never, and asks no limiter", async () => {
    const s = fakeSupabase();
    for (const token of [OLD, NO_DATE]) {
      const r = await welcome(token, s);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ sent: false, reason: "not_new" });
      expect(r.emails).toEqual([]);
    }
    expect(s.counts.size).toBe(0);
  });

  it("gives nothing to an account with no address", async () => {
    const r = await welcome(NO_EMAIL, fakeSupabase());
    expect(r.json).toMatchObject({ sent: false, reason: "no_email" });
    expect(r.emails).toEqual([]);
  });

  it("refuses no session and a session Auth refuses, with 401 and no mail", async () => {
    const s = fakeSupabase();
    for (const token of [null, "forged-token-0123456789"]) {
      const r = await welcome(token, s);
      expect(r.status).toBe(401);
      expect(r.emails).toEqual([]);
    }
  });
});

describe("welcome-user — when something fails", () => {
  it("sends nothing when the limiter cannot answer: a missing welcome is better than two", async () => {
    const r = await welcome(NEW, fakeSupabase({ limiterDown: true }));
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ sent: false, reason: "unavailable" });
    expect(r.emails).toEqual([]);
  });

  it("answers 502 when the mailer refuses", async () => {
    const r = await welcome(NEW, fakeSupabase(), { failEmailTo: ["rachel.levi@example.com"] });
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ sent: false, reason: "mail_failed" });
  });

  it("never logs the address or the name, sent or refused", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      expect((await welcome(NEW, fakeSupabase())).emails).toHaveLength(1);
      await welcome(NEW, fakeSupabase(), { failEmailTo: ["rachel.levi@example.com"] });
      const written = spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
      expect(written).toContain("user-new");
      expect(written).not.toMatch(/rachel|רחל|לוי/i);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
