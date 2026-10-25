import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { DEFAULT_LEAD_WHATSAPP_TEMPLATE } from "@/lib/lead-whatsapp";

/** One-click WhatsApp, read as source; supabase/tests/lead_whatsapp_check.sql proves the behaviour. */
const FILE = "20261110000000_lead_whatsapp.sql";
const sql = readFileSync(join(REPO_ROOT, "supabase/migrations", FILE), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = sql.replace(/\s+/g, " ");

describe("lead WhatsApp, schema", () => {
  it("sorts after the pipeline migration, and has its version to itself", () => {
    const names = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261109000000_lead_pipeline.sql"));
    expect(names.filter((n) => n.startsWith(FILE.slice(0, 14)))).toEqual([FILE]);
  });

  it("starts every agency with the message the screen falls back to", () => {
    expect(flat).toContain(`default '${DEFAULT_LEAD_WHATSAPP_TEMPLATE}'`);
    expect(DEFAULT_LEAD_WHATSAPP_TEMPLATE).toMatch(/\{name\}.*\{agent\}.*\{topic\}/);
  });

  it("bounds the template: never blank, at most 500 characters", () => {
    expect(flat).toContain("check (char_length(btrim(lead_whatsapp_template)) between 1 and 500)");
  });

  it("logs only the fact of a message — no number, no text", () => {
    expect(flat).toContain("insert into public.lead_events (lead_id, actor_id, kind) values (p_lead_id, auth.uid(), 'whatsapp');");
    expect(flat).toContain("if not public.can_see_lead(p_lead_id)");
  });

  it("lets only signed-in people log a message", () => {
    expect(flat).toContain("revoke execute on function public.log_lead_whatsapp(uuid) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.log_lead_whatsapp(uuid) to authenticated;");
  });
});
