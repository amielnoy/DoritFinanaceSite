import { describe, expect, it, vi } from "vitest";
import { SupabaseLeadAdminService } from "@/services/supabase/SupabaseLeadAdminService";
import { tableFake } from "../helpers/supabase-table-fake";

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
  it("reads leads newest first, up to 500 by default", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).list();
    expect(calls[0]).toEqual(["from", "leads"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 500]);
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
