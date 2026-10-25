import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { DEFAULT_CAMPAIGN_MESSAGE, newCampaignCode } from "@/lib/campaigns";

/** Reactivation campaigns, read as source; supabase/tests/campaigns_check.sql proves the behaviour. */
const FILE = "20261111000000_campaigns.sql";
const sql = readFileSync(join(REPO_ROOT, "supabase/migrations", FILE), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = sql.replace(/\s+/g, " ");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

describe("campaigns, schema", () => {
  it("sorts after the WhatsApp migration, and has its version to itself", () => {
    const names = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261110000000_lead_whatsapp.sql"));
    expect(names.filter((n) => n.startsWith(FILE.slice(0, 14)))).toEqual([FILE]);
  });

  it("adds 'reactivation' to the leads' channels, and every copy of the list agrees", () => {
    const db = /add constraint leads_channel_check check \(channel in \(([^)]*)\)\)/.exec(flat)![1];
    for (const path of ["supabase/functions/_shared/attribution.ts", "base44/functions/submitClaim/entry.ts"]) {
      const list = /CHANNEL_TAXONOMY = \[([^\]]*)\]/.exec(read(path))![1].replace(/\s+/g, " ");
      for (const c of list.match(/'[a-z_]+'/g)!) expect(db).toContain(c);
      expect(list).toContain("'reactivation'");
    }
  });

  it("refuses a message without an opt-out line, at the table too", () => {
    expect(flat).toContain("message like '%להסרה%'");
    expect(DEFAULT_CAMPAIGN_MESSAGE).toContain("להסרה");
  });

  it("keeps the code to the shape the screen draws", () => {
    expect(flat).toContain("check (code ~ '^[a-z0-9]{8,32}$')");
    expect(newCampaignCode()).toMatch(/^[a-z0-9]{8,32}$/);
  });

  it("lets every member read, Admin+ write as themselves, and nobody delete", () => {
    expect(flat).toContain("revoke all on public.campaigns from public, anon, authenticated;");
    expect(flat).toContain("grant select, insert, update on public.campaigns to authenticated;");
    expect(flat).not.toMatch(/grant[^;]*delete[^;]*on public\.campaigns to authenticated/);
    expect(flat).toContain("using (public.has_role(agency_id, 'user') or public.is_admin())");
    expect(flat).toContain("with check ((public.has_role(agency_id, 'admin') or public.is_admin()) and created_by is not distinct from auth.uid())");
  });

  it("serves /admin/campaigns as the app, not a 404", () => {
    expect(read("vercel.json")).toContain("/admin/:page(leads|users|blog|masleka|agency|campaigns)");
  });
});
