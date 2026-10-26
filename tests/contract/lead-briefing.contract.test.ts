import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { isLeadBriefingOn } from "@/config/lead-briefing";

/** The call briefing (feature 4), read as source; supabase/tests/lead_briefings_check.sql proves the table's behaviour. */
const FILE = "20261112000000_lead_briefings.sql";
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const sql = read(`supabase/migrations/${FILE}`)
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = sql.replace(/\s+/g, " ");
const fnDir = "supabase/functions/lead-briefing";
const functionSource = ["handler.ts", "deps.ts", "briefing.ts"].map((f) => read(`${fnDir}/${f}`)).join("\n");

describe("call briefing, schema", () => {
  it("sorts after the campaigns migration, and has its version to itself", () => {
    const names = readdirSync(join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261111000000_campaigns.sql"));
    expect(names.filter((n) => n.startsWith(FILE.slice(0, 14)))).toEqual([FILE]);
  });

  it("has a SQL check beside it", () => {
    expect(readdirSync(join(REPO_ROOT, "supabase/tests"))).toContain("lead_briefings_check.sql");
  });

  it("lets whoever may see the lead read, and nobody signed in write", () => {
    expect(flat).toContain("for select to authenticated using (public.can_see_lead(lead_id))");
    expect(flat).toContain("revoke all on public.lead_briefings from public, anon, authenticated;");
    expect(flat).toContain("grant select on public.lead_briefings to authenticated;");
    expect(flat).not.toMatch(/for (insert|update|delete|all) to authenticated/);
  });

  it("goes with the lead: deleted with it, and when retention anonymises it", () => {
    expect(flat).toContain("references public.leads(id) on delete cascade");
    expect(flat).toContain("when (new.anonymized_at is not null and old.anonymized_at is null)");
  });

  it("keeps the month's usage for the server alone", () => {
    expect(flat).toContain("revoke execute on function public.lead_briefing_month_usage(uuid, timestamptz) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.lead_briefing_month_usage(uuid, timestamptz) to service_role;");
  });
});

describe("call briefing, function", () => {
  it("checks the session itself, as the other staff functions do", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.lead-briefing\]\s*\nverify_jwt = false/);
    expect(functionSource).toContain("allowLead(session, leadId, rid, log)");
  });

  it("never logs the interview, the briefing or a contact detail", () => {
    const logCalls = functionSource.match(/log\('(?:info|warn|error)',[^;]*;/gs) ?? [];
    expect(logCalls.length).toBeGreaterThan(3);
    for (const call of logCalls) {
      // The fields, not the event's name; an Error's message is a code here (rest.ts, ModelError).
      const fields = call.replace(/^log\('\w+', '[^']*'/, "").replace("(e as Error)?.message", "");
      expect(fields).not.toMatch(/material|briefing[,:} ]|message|name|phone|email|summary|concern|content/);
    }
    expect(functionSource).not.toMatch(/console\./);
  });

  it("sends the model the scrubbed interview alone", () => {
    expect(functionSource).toContain("messages: [{ role: 'user', content: material }]");
    expect(functionSource).toContain("return scrubContacts(lines.join('\\n'), lead)");
  });

  it("reads the key and the budget from the environment, never from code", () => {
    expect(functionSource).toContain("Deno.env.get('ANTHROPIC_API_KEY')");
    expect(functionSource).toContain("Deno.env.get('LEAD_BRIEFING_MONTHLY_BUDGET_USD')");
    expect(functionSource).not.toMatch(/sk-ant-/);
  });
});

describe("call briefing, screen", () => {
  it("is off unless VITE_LEAD_BRIEFING is exactly true", () => {
    expect(isLeadBriefingOn(undefined)).toBe(false);
    expect(isLeadBriefingOn("")).toBe(false);
    expect(isLeadBriefingOn("1")).toBe(false);
    expect(isLeadBriefingOn("true")).toBe(true);
  });

  it("adds the drawer tab only behind the flag", () => {
    expect(read("src/pages/Leads.tsx")).toContain("briefing={LEAD_BRIEFING && openLead ? <LeadBriefing");
  });

  it("shows the privacy policy's line only with the flag", () => {
    expect(read("src/pages/PrivacyPolicy.tsx")).toMatch(/\{LEAD_BRIEFING \? \(\s*<li>\s*כדי להתכונן לשיחה איתך/);
  });

  it("is recorded as an open point for the compliance adviser", () => {
    expect(read("docs/COMPLIANCE.md")).toContain("## 12. נקודה פתוחה: תדריך לפני שיחה");
  });
});
