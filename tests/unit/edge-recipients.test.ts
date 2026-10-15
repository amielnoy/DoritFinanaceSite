import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * supabase/functions/_shared/recipients.ts — who receives an enquiry, for every
 * Edge function (Architecture N-01). The function secret NOTIFY_EMAILS can
 * replace the operations list; the diary is derived from the mail.
 */
async function load(secret?: string) {
  vi.resetModules();
  if (secret === undefined) vi.stubGlobal("Deno", undefined);
  else vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "NOTIFY_EMAILS" ? secret : undefined) } });
  return import("../../supabase/functions/_shared/recipients.ts");
}

afterEach(() => vi.unstubAllGlobals());

describe("who receives an enquiry", () => {
  it("is the operating team and the agent by default, everyone in the diary, the calendar's owner by its event", async () => {
    const r = await load();
    expect(r.NOTIFY_EMAILS).toEqual(["amielnoy@gmail.com", "amielnoy@outlook.com"]);
    expect(r.SECONDARY_EMAIL).toBe("dorit@govari-fin.co.il");
    expect(r.CALENDAR_ATTENDEES).toEqual(["dorit@govari-fin.co.il", "amielnoy@gmail.com", "amielnoy@outlook.com"]);
    expect(r.INVITE_ATTENDEES).toEqual(["dorit@govari-fin.co.il", "amielnoy@outlook.com"]);
    expect(r.INVITE_FALLBACK_GOOGLE).toBe("amielnoy@gmail.com");
  });

  it("takes the operations list from the NOTIFY_EMAILS secret, and the diary follows", async () => {
    const r = await load(" ops@govari-fin.co.il , team@example.com ");
    expect(r.NOTIFY_EMAILS).toEqual(["ops@govari-fin.co.il", "team@example.com"]);
    expect(r.CALENDAR_ATTENDEES).toEqual(["dorit@govari-fin.co.il", "ops@govari-fin.co.il", "team@example.com"]);
    // The calendar's owner is no longer notified, so no fallback invitation goes to them.
    expect(r.INVITE_FALLBACK_GOOGLE).toBeNull();
    expect(r.INVITE_ATTENDEES).toEqual(r.CALENDAR_ATTENDEES);
  });

  it.each(["", " , ", "not-an-address", "a@b.co, broken", "a@b.co;c@d.co"])("ignores a malformed secret (%j) and keeps the default", async (secret) => {
    const r = await load(secret);
    expect(r.NOTIFY_EMAILS).toEqual(["amielnoy@gmail.com", "amielnoy@outlook.com"]);
  });

  it("never invites anyone who does not receive the enquiry", async () => {
    for (const secret of [undefined, "ops@govari-fin.co.il", "amielnoy@gmail.com"]) {
      const r = await load(secret);
      const mailed = [...r.NOTIFY_EMAILS, r.SECONDARY_EMAIL];
      for (const a of [...r.CALENDAR_ATTENDEES, ...r.INVITE_ATTENDEES, ...(r.INVITE_FALLBACK_GOOGLE ? [r.INVITE_FALLBACK_GOOGLE] : [])]) {
        expect(mailed, `${secret}: ${a}`).toContain(a);
      }
    }
  });
});
