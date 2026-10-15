import { describe, expect, it, vi } from "vitest";
import { LEAD_PAGE, SupabaseLeadAdminService } from "@/services/supabase/SupabaseLeadAdminService";
import { tableFake } from "../helpers/supabase-table-fake";
import type { SupabaseLeadTableClient, SupabaseQuery, SupabaseReadResult } from "@/services/supabase/SupabaseTableClient";

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-0000000000aa",
  base44_id: "b44-lead-1",
  name: "דנה",
  phone: "050-0000000",
  email: null,
  source: "consultation",
  topic: "פנסיה",
  timing: null,
  message: null,
  status: "new",
  created_at: "2026-10-10T08:00:00+00:00",
  ...over,
});

describe("SupabaseLeadAdminService.list", () => {
  it("reads leads newest first, a page at a time", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).list();
    expect(calls[0]).toEqual(["from", "leads"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["range", 0, LEAD_PAGE - 1]);
  });

  /**
   * "כל הפניות" and "ייצוא הכל" were the newest 500: past that, older leads left
   * the list, the counts and the export with no word (review 2026-10-15).
   */
  it("reads every lead, page after page, until a short page", async () => {
    const rows = Array.from({ length: LEAD_PAGE * 2 + 500 }, (_, i) => leadRow({ id: `lead-${i}` }));
    const { client, calls } = tableFake({ data: rows, error: null });
    const leads = await new SupabaseLeadAdminService(client).list();
    expect(leads).toHaveLength(LEAD_PAGE * 2 + 500);
    expect(calls.filter((c) => c[0] === "range")).toEqual([
      ["range", 0, LEAD_PAGE - 1],
      ["range", LEAD_PAGE, LEAD_PAGE * 2 - 1],
      ["range", LEAD_PAGE * 2, LEAD_PAGE * 3 - 1],
    ]);
  });

  it("asks for the port's columns only, not the whole row", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).list();
    const select = calls.find((c) => c[0] === "select")!;
    expect(select[1]).not.toBe("*");
    expect(String(select[1]).split(",")).toEqual(
      expect.arrayContaining(["id", "name", "phone", "status", "created_at"]),
    );
  });

  it("returns leads under their Supabase id, which the writes act on", async () => {
    const { client } = tableFake({ data: [leadRow()], error: null });
    const [lead] = await new SupabaseLeadAdminService(client).list();
    expect(lead).toMatchObject({
      id: "6f1c0e3a-0000-4000-8000-0000000000aa",
      name: "דנה",
      status: "new",
      created_date: "2026-10-10T08:00:00+00:00",
    });
    expect(lead).not.toHaveProperty("email");
  });

  it("lists a lead that never had a Base44 id the same way", async () => {
    const { client } = tableFake({ data: [leadRow({ base44_id: null })], error: null });
    const leads = await new SupabaseLeadAdminService(client).list();
    expect(leads.map((l) => l.id)).toEqual(["6f1c0e3a-0000-4000-8000-0000000000aa"]);
  });

  it("throws on a failed read rather than showing an empty inbox", async () => {
    const { client } = tableFake({ data: null, error: { message: "permission denied for table leads", code: "42501" } });
    await expect(new SupabaseLeadAdminService(client).list()).rejects.toThrow(/leads read failed/);
  });
});

describe("SupabaseLeadAdminService writes", () => {
  const changed = { data: [{ id: "6f1c0e3a-0000-4000-8000-0000000000aa" }], error: null };

  it("sets a status on the row with that Supabase id, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, changed);
    await new SupabaseLeadAdminService(client).setStatus("6f1c0e3a-0000-4000-8000-0000000000aa", "contacted");
    expect(calls).toEqual([
      ["from", "leads"],
      ["update", { status: "contacted" }],
      ["eq", "id", "6f1c0e3a-0000-4000-8000-0000000000aa"],
      ["select", "id"],
    ]);
  });

  it("deletes the row with that Supabase id, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, changed);
    await new SupabaseLeadAdminService(client).remove("6f1c0e3a-0000-4000-8000-0000000000aa");
    expect(calls).toEqual([
      ["from", "leads"],
      ["delete"],
      ["eq", "id", "6f1c0e3a-0000-4000-8000-0000000000aa"],
      ["select", "id"],
    ]);
  });

  it("throws on a refused write, naming the action", async () => {
    const { client } = tableFake(
      { data: [], error: null },
      { data: null, error: { message: "permission denied", code: "42501" } },
    );
    await expect(new SupabaseLeadAdminService(client).setStatus("x", "closed")).rejects.toThrow(
      /leads status failed: permission denied/,
    );
  });

  it("throws when nothing changed — a write the access rules refuse returns no error", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: [], error: null });
    await expect(new SupabaseLeadAdminService(client).remove("x")).rejects.toThrow(
      "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת",
    );
    await expect(new SupabaseLeadAdminService(client).setStatus("x", "closed")).rejects.toThrow("הפעולה לא בוצעה");
  });
});

describe("SupabaseLeadAdminService.documentLink", () => {
  const storageOf = (result: { data: { signedUrl: string } | null; error: { message: string } | null }) => {
    const createSignedUrl = vi.fn().mockResolvedValue(result);
    const from = vi.fn(() => ({ upload: vi.fn(), createSignedUrl }));
    return { storage: { storage: { from } }, from, createSignedUrl };
  };
  const ref = "storage:claim-documents/00000000-0000-0000-0000-000000000001/abc-tz.pdf";

  it("signs a stored document for five minutes, by its path in the private bucket", async () => {
    const { client } = tableFake({ data: [], error: null });
    const s = storageOf({ data: { signedUrl: "https://project.supabase.co/signed" }, error: null });
    const link = await new SupabaseLeadAdminService(client, s.storage).documentLink(ref);
    expect(link).toBe("https://project.supabase.co/signed");
    expect(s.from).toHaveBeenCalledWith("claim-documents");
    expect(s.createSignedUrl).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001/abc-tz.pdf", 300);
  });

  it("returns a Base44 file URL unchanged, without asking storage", async () => {
    const { client } = tableFake({ data: [], error: null });
    const s = storageOf({ data: null, error: null });
    const url = "https://base44.app/api/files/tz.pdf";
    expect(await new SupabaseLeadAdminService(client, s.storage).documentLink(url)).toBe(url);
    expect(s.createSignedUrl).not.toHaveBeenCalled();
  });

  it("says so when storage refuses — not an admin, or the file is gone", async () => {
    const { client } = tableFake({ data: [], error: null });
    const s = storageOf({ data: null, error: { message: "Object not found" } });
    await expect(new SupabaseLeadAdminService(client, s.storage).documentLink(ref)).rejects.toThrow("לא ניתן לפתוח");
  });

  it("refuses a stored document when it has no storage client", async () => {
    const { client } = tableFake({ data: [], error: null });
    await expect(new SupabaseLeadAdminService(client).documentLink(ref)).rejects.toThrow();
  });
});

/** A client whose answer depends on the table — the transcript reads two. Any write is a test failure. */
function byTable(answers: Record<string, SupabaseReadResult>) {
  const calls: unknown[][] = [];
  const query = (table: string): SupabaseQuery => {
    // `not … is null` and `limit` are applied to the canned rows, as PostgREST would; eq/order are only recorded.
    let rows = answers[table].data;
    const q: SupabaseQuery = {
      eq: (c, v) => (calls.push([table, "eq", c, v]), q),
      or: () => q,
      not: (c, op, v) => {
        calls.push([table, "not", c, op, v]);
        if (rows && op === "is" && v === null) rows = rows.filter((row) => (row as Record<string, unknown>)[c] != null);
        return q;
      },
      order: (c, o) => (calls.push([table, "order", c, o]), q),
      limit: (n) => {
        calls.push([table, "limit", n]);
        if (rows) rows = rows.slice(0, n);
        return q;
      },
      then: (f, r) => Promise.resolve({ ...answers[table], data: rows }).then(f, r),
    };
    return q;
  };
  const refuse = (table: string, verb: string) => () => {
    calls.push([table, verb]);
    throw new Error(`${verb} on ${table}`);
  };
  const client = {
    from: (table: string) => ({ select: () => query(table), update: refuse(table, "update"), delete: refuse(table, "delete") }),
  } as unknown as SupabaseLeadTableClient;
  return { client, calls };
}

describe("SupabaseLeadAdminService.transcript", () => {
  it("reads the lead's latest conversation, oldest message first, without the tool rows", async () => {
    const { client, calls } = byTable({
      chat_conversations: { data: [{ id: "c1" }], error: null },
      chat_messages: {
        data: [
          { role: "user", content: "שלום", created_at: "2026-10-13T09:00:00Z" },
          { role: "tool", content: "submitLead: ok", created_at: "2026-10-13T09:01:00Z" },
          { role: "assistant", content: "נשמר", created_at: "2026-10-13T09:01:00Z" },
        ],
        error: null,
      },
    });
    expect(await new SupabaseLeadAdminService(client).transcript("lead-1")).toEqual([
      { role: "user", content: "שלום", at: "2026-10-13T09:00:00Z" },
      { role: "assistant", content: "נשמר", at: "2026-10-13T09:01:00Z" },
    ]);
    expect(calls).toContainEqual(["chat_conversations", "eq", "lead_id", "lead-1"]);
    expect(calls).toContainEqual(["chat_messages", "eq", "conversation_id", "c1"]);
    expect(calls).toContainEqual(["chat_messages", "order", "id", { ascending: true }]);
  });

  it("is empty for a lead with no conversation", async () => {
    const { client } = byTable({ chat_conversations: { data: [], error: null }, chat_messages: { data: [], error: null } });
    expect(await new SupabaseLeadAdminService(client).transcript("lead-2")).toEqual([]);
  });

  it("throws on a refused read rather than showing an empty transcript", async () => {
    const { client } = byTable({ chat_conversations: { data: null, error: { message: "permission denied" } }, chat_messages: { data: [], error: null } });
    await expect(new SupabaseLeadAdminService(client).transcript("lead-3")).rejects.toThrow(/chat_conversations read failed/);
  });

  it("never writes: reading a transcript or the link list touches no update or delete", async () => {
    const { client, calls } = byTable({
      chat_conversations: { data: [{ id: "c1", lead_id: "lead-1" }], error: null },
      chat_messages: { data: [{ role: "user", content: "x", created_at: "t" }], error: null },
    });
    const s = new SupabaseLeadAdminService(client);
    await s.transcript("lead-1");
    await s.transcriptLeadIds();
    expect(calls.filter((c) => c[1] === "update" || c[1] === "delete")).toEqual([]);
  });

  it("returns message text untouched, markup and all, for the screen to show as text", async () => {
    const hostile = '<img src=x onerror=alert(1)> **bold** [a](javascript:alert(1))';
    const { client } = byTable({
      chat_conversations: { data: [{ id: "c1" }], error: null },
      chat_messages: { data: [{ role: "user", content: hostile, created_at: "t" }], error: null },
    });
    expect((await new SupabaseLeadAdminService(client).transcript("l"))[0].content).toBe(hostile);
  });
});

describe("SupabaseLeadAdminService.transcriptLeadIds", () => {
  it("lists each lead that has a conversation once, skipping conversations without a lead", async () => {
    const { client } = byTable({
      chat_conversations: { data: [{ lead_id: "a" }, { lead_id: null }, { lead_id: "b" }, { lead_id: "a" }], error: null },
      chat_messages: { data: [], error: null },
    });
    expect(await new SupabaseLeadAdminService(client).transcriptLeadIds()).toEqual(["a", "b"]);
  });

  it("finds an older linked conversation behind a thousand newer ones without a lead", async () => {
    const unlinked = Array.from({ length: 1000 }, () => ({ lead_id: null }));
    const { client, calls } = byTable({ chat_conversations: { data: [...unlinked, { lead_id: "older" }], error: null }, chat_messages: { data: [], error: null } });
    expect(await new SupabaseLeadAdminService(client).transcriptLeadIds()).toEqual(["older"]);
    expect(calls).toContainEqual(["chat_conversations", "not", "lead_id", "is", null]);
  });

  it("throws on a refused read", async () => {
    const { client } = byTable({ chat_conversations: { data: null, error: { message: "denied" } }, chat_messages: { data: [], error: null } });
    await expect(new SupabaseLeadAdminService(client).transcriptLeadIds()).rejects.toThrow(/chat_conversations read failed/);
  });
});

describe("SupabaseLeadAdminService.countNew", () => {
  it("counts the leads still new, reading their ids alone", async () => {
    const { client, calls } = byTable({ leads: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null } });
    expect(await new SupabaseLeadAdminService(client).countNew()).toBe(3);
    expect(calls).toContainEqual(["leads", "eq", "status", "new"]);
    expect(calls).toContainEqual(["leads", "limit", 1000]);
  });

  it("throws on a refused read rather than counting none", async () => {
    const { client } = byTable({ leads: { data: null, error: { message: "denied" } } });
    await expect(new SupabaseLeadAdminService(client).countNew()).rejects.toThrow(/leads read failed/);
  });
});
