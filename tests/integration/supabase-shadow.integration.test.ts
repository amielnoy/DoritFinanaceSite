import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseContentAdminService } from "@/services/supabase/SupabaseContentAdminService";

/**
 * The id translation, against a real Postgres.
 *
 * This is the one part of dual-write that cannot be proven with a fake. The
 * shadow is handed the *primary's* id, which exists in `base44_id` and nowhere
 * else; matching the wrong column is not an error in Postgres, it simply
 * affects no rows. The call returns happily, the caller believes the write
 * landed, and the two stores diverge silently — so the assertion that matters
 * is "the right row changed AND the others did not".
 *
 * Needs a local stack (`supabase start`). Skipped rather than failed when one
 * is not running, so CI and a laptop without Docker stay green.
 */
const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const live = Boolean(URL && KEY);

describe.skipIf(!live)("Supabase shadow — translating the primary's ids", () => {
  const db = live ? createClient(URL!, KEY!) : (null as never);
  const shadow = live ? new SupabaseContentAdminService(db, "base44_id") : (null as never);
  const asPrimary = live ? new SupabaseContentAdminService(db, "id") : (null as never);

  const draft = { title: "כותרת", body: "גוף", published: false };
  const cleanup: string[] = [];

  beforeAll(async () => {
    await db.from("blog_posts").delete().like("base44_id", "shadow-test-%");
  });

  afterAll(async () => {
    if (live) await db.from("blog_posts").delete().like("base44_id", "shadow-test-%");
  });

  it("records the primary's id on a mirrored create", async () => {
    await shadow.createArticleMirroring("shadow-test-1", draft);

    const { data } = await db.from("blog_posts").select("id, base44_id").eq("base44_id", "shadow-test-1");
    expect(data).toHaveLength(1);
    cleanup.push(String(data![0].id));
    // The uuid is Postgres's own and bears no resemblance to the Base44 id —
    // which is precisely why the correlation column has to carry it.
    expect(data![0].id).not.toBe("shadow-test-1");
  });

  it("updates the row the primary means, not the one that happens to share an id", async () => {
    await shadow.createArticleMirroring("shadow-test-2", { ...draft, title: "לפני" });
    await shadow.createArticleMirroring("shadow-test-3", { ...draft, title: "לא אני" });

    await shadow.updateArticle("shadow-test-2", { title: "אחרי" });

    const { data } = await db.from("blog_posts").select("base44_id, title").like("base44_id", "shadow-test-%");
    const byId = Object.fromEntries((data ?? []).map((r) => [r.base44_id, r.title]));
    expect(byId["shadow-test-2"]).toBe("אחרי");
    expect(byId["shadow-test-3"]).toBe("לא אני");
  });

  it("deletes by the primary's id", async () => {
    await shadow.removeArticle("shadow-test-3");

    const { data } = await db.from("blog_posts").select("base44_id").eq("base44_id", "shadow-test-3");
    expect(data).toHaveLength(0);
  });

  it("keying on the wrong column fails loudly one way and silently the other", async () => {
    await shadow.createArticleMirroring("shadow-test-4", { ...draft, title: "שלם" });

    // One direction is safe by accident: `id` is a uuid, so handing it a Base44
    // id is a type error (22P02) and Postgres refuses outright.
    await expect(asPrimary.updateArticle("shadow-test-4", { title: "נדרס" })).rejects.toMatchObject({
      code: "22P02",
    });

    // The other direction is the dangerous one, and the reason `keyBy` is a
    // required decision rather than a default. `base44_id` is text, so a uuid is
    // a perfectly valid value that simply matches nothing: no error, no rows
    // changed, and a caller who believes the write landed.
    const uuid = (await db.from("blog_posts").select("id").eq("base44_id", "shadow-test-4").single())
      .data!.id as string;
    await expect(shadow.updateArticle(uuid, { title: "נעלם" })).resolves.toBeUndefined();

    const { data } = await db.from("blog_posts").select("title").eq("base44_id", "shadow-test-4");
    expect(data![0].title).toBe("שלם");
  });
});
