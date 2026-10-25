import { describe, expect, it, vi } from "vitest";
import { SupabaseOnboardingService, type OnboardingClient } from "@/services/supabase/SupabaseOnboardingService";
import { OnboardingConflictError } from "@/services/ports";

type Answer = { data: unknown; error: { message: string; details?: string | null; code?: string } | null };

/** A chainable fake: each `from(table)` query answers from `answers[table]` in order, and records what it was asked. */
function fake(answers: Record<string, Answer[]>, rpc: Answer = { data: null, error: null }) {
  const calls: unknown[][] = [];
  const uploads: string[] = [];
  const removed: string[][] = [];
  const query = (table: string): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) {
      q[m] = (...args: unknown[]) => (calls.push([table, m, ...args]), q);
    }
    q.then = (resolve: (a: Answer) => unknown) => resolve(answers[table]?.shift() ?? { data: [], error: null });
    return q;
  };
  const client = {
    from: (table: string) => ({
      select: (c: string) => (calls.push([table, "select", c]), query(table)),
      update: (v: unknown) => (calls.push([table, "update", v]), query(table)),
      insert: (v: unknown) => (calls.push([table, "insert", v]), query(table)),
      delete: () => (calls.push([table, "delete"]), query(table)),
    }),
    rpc: vi.fn(async () => rpc),
    storage: {
      from: () => ({
        upload: vi.fn(async (path: string) => (uploads.push(path), { error: path.endsWith("-1080.webp") && answers.__failUpload ? { message: "boom" } : null })),
        remove: vi.fn(async (paths: string[]) => (removed.push(paths), { error: null })),
      }),
    },
  } as unknown as OnboardingClient;
  return { client, calls, uploads, removed };
}

describe("SupabaseOnboardingService", () => {
  it("saves a step only over the version it opened, and calls a moved row a conflict", async () => {
    const { client, calls } = fake({
      agency_profiles: [{ data: [], error: null }, { data: [{ updated_at: "T1" }], error: null }],
    });
    await expect(new SupabaseOnboardingService(client).saveProfile("ag", { email: "a@b.co" }, "T0")).rejects.toBeInstanceOf(OnboardingConflictError);
    expect(calls).toContainEqual(["agency_profiles", "eq", "updated_at", "T0"]);
  });

  it("calls an unchanged row with nothing saved a refusal, not a conflict", async () => {
    const { client } = fake({ agency_profiles: [{ data: [], error: null }, { data: [{ updated_at: "T0" }], error: null }] });
    await expect(new SupabaseOnboardingService(client).saveProfile("ag", { email: "a@b.co" }, "T0")).rejects.toThrow("אין לך הרשאה");
  });

  it("creates the licensee in its agency when there is none yet", async () => {
    const { client, calls } = fake({ agents: [{ data: [{ id: "new-agent" }], error: null }] });
    expect(await new SupabaseOnboardingService(client).saveAgent("ag", null, { full_name: "רחל" }, null)).toEqual({ id: "new-agent" });
    expect(calls).toContainEqual(["agents", "insert", { full_name: "רחל", agency_id: "ag" }]);
  });

  it("uploads every size before pointing at the photo, then removes the old set", async () => {
    const { client, calls, uploads, removed } = fake({ agents: [{ data: [{ id: "g" }], error: null }] });
    const blob = new Blob(["x"]);
    const path = await new SupabaseOnboardingService(client).uploadPortrait("ag", "g", { 480: blob, 768: blob, 1080: blob }, "ag/g/portrait-old-768.webp");
    expect(uploads.map((u) => u.replace(/portrait-[a-z0-9]+-/, "portrait-X-"))).toEqual(["ag/g/portrait-X-480.webp", "ag/g/portrait-X-768.webp", "ag/g/portrait-X-1080.webp"]);
    expect(path.photoPath).toMatch(/^ag\/g\/portrait-[a-z0-9]+-768\.webp$/);
    expect(calls).toContainEqual(["agents", "update", { photo_path: path.photoPath }]);
    expect(removed).toEqual([["ag/g/portrait-old-480.webp", "ag/g/portrait-old-768.webp", "ag/g/portrait-old-1080.webp"]]);
  });

  it("points at nothing when an upload fails halfway, and cleans up what arrived", async () => {
    const answers: Record<string, Answer[]> & { __failUpload?: boolean } = { agents: [] };
    (answers as Record<string, unknown>).__failUpload = true;
    const { client, calls, removed } = fake(answers);
    const blob = new Blob(["x"]);
    await expect(new SupabaseOnboardingService(client).uploadPortrait("ag", "g", { 480: blob, 768: blob, 1080: blob }, null)).rejects.toThrow("העלאת התמונה נכשלה");
    expect(calls.some((c) => c[0] === "agents" && c[1] === "update")).toBe(false);
    expect(removed[0]).toHaveLength(2);
  });

  it("reads the keys an incomplete or gated refusal names", async () => {
    const incomplete = fake({}, { data: null, error: { message: "incomplete", details: "agents.full_name,agency_profiles.email" } });
    expect(await new SupabaseOnboardingService(incomplete.client).submit("ag")).toEqual({
      ok: false, missing: ["agents.full_name", "agency_profiles.email"], gates: [], message: "חסרים פרטים לפני שליחה לאישור.",
    });
    const gated = fake({}, { data: null, error: { message: "gates_closed", details: "agents.licence_verified_at" } });
    expect((await new SupabaseOnboardingService(gated.client).activate("ag"))).toMatchObject({ ok: false, gates: ["agents.licence_verified_at"] });
    expect(await new SupabaseOnboardingService(fake({}).client).activate("ag")).toEqual({ ok: true });
  });
});
