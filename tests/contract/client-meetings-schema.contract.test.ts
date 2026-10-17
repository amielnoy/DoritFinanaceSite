import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * A client's meetings with Dorit, migration 1 (additive), read as source. The
 * behaviour is proved by supabase/tests/client_meetings_check.sql against a
 * local Supabase; this fails in CI the moment the client's view grows a
 * column, a draft summary can leak, or a grant opens.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261103000000_client_meetings.sql";
const code = readFileSync(join(DIR, FILE), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const fn = (name: string) => {
  const start = code.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", start));
};

/** The columns a `returns table (…)` declares, by name. */
const returned = (body: string) => {
  const table = body.slice(body.indexOf("returns table ("), body.indexOf(")\n", body.indexOf("returns table (")));
  return [...table.matchAll(/^\s+(\w+)\s+\w+/gm)].map((m) => m[1]).sort();
};

const CLIENT_COLUMNS = [
  "client_summary", "duration_min", "id", "in_calendar", "kind", "location", "mode", "open_request",
  "scheduled_at", "status", "summary_published_at", "topic",
];

describe("the client meetings migration", () => {
  it("sorts after every migration already applied to production", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261102000000_claim_documents_object_name.sql"));
  });

  it("keeps the one-meeting key: migration 2 drops it, after submit-lead writes by id", () => {
    expect(code).not.toMatch(/drop constraint meetings_lead_id_key/);
  });

  it("shows the client exactly twelve columns, from meetings_for and my_meetings alike", () => {
    expect(returned(fn("meetings_for"))).toEqual(CLIENT_COLUMNS);
    expect(returned(fn("my_meetings"))).toEqual(CLIENT_COLUMNS);
  });

  it("never selects Dorit's notes or the private columns for the client", () => {
    // The select list alone: the join and the filter may name other columns.
    const body = fn("meetings_for");
    const select = body.slice(body.indexOf("select m.id"), body.indexOf("from public.meetings m"));
    for (const hidden of ["notes", "timing", "lead_id", "agency_id", "track", "created_by,"]) {
      expect(select, hidden).not.toMatch(new RegExp(`\\bm\\.${hidden}`));
    }
    // calendar_status only as whether it is in the diary.
    expect(select).toMatch(/coalesce\(m\.calendar_status like 'אירוע נוצר%', false\) or m\.created_by is not null/);
  });

  it("keeps a summary invisible until it is published", () => {
    expect(fn("meetings_for")).toMatch(/case when m\.summary_published_at is not null then m\.client_summary end/);
  });

  it("answers only the signed-in user's verified address, and only for a whole lead", () => {
    expect(fn("my_meetings")).toMatch(/public\.meetings_for\(public\.my_email\(\)\)/);
    expect(fn("meetings_for")).toMatch(/l\.anonymized_at is null/);
    expect(fn("meetings_for")).toMatch(/lower\(trim\(l\.email\)\) = lower\(trim\(p_email\)\)/);
  });

  it("rechecks ownership on a change request, and allows one open request per meeting", () => {
    const req = fn("request_meeting_change");
    expect(req).toMatch(/v_email\s+text := public\.my_email\(\)/);
    expect(req).toMatch(/lower\(trim\(l\.email\)\) = v_email/);
    expect(req).toMatch(/m\.status = 'scheduled'/);
    expect(req).toMatch(/raise exception 'already_open'/);
    expect(code).toMatch(/create unique index meeting_requests_one_open on public\.meeting_requests \(meeting_id\) where status = 'open'/);
  });

  it("lets staff add a meeting only to a lead they can see, in its agency, as themselves", () => {
    expect(code).toMatch(
      /create policy meetings_insert_lead on public\.meetings\s+for insert to authenticated\s+with check \(public\.can_see_lead\(lead_id\)\s+and public\.lead_in_agency\(lead_id, agency_id\)\s+and created_by = auth\.uid\(\)\)/,
    );
  });

  it("gives clients no direct write to requests, and staff only the answer", () => {
    expect(code).not.toMatch(/create policy \w+ on public\.meeting_requests\s+for (insert|all)/);
    expect(code).toMatch(/revoke all on public\.meeting_requests from public, anon, authenticated;/);
    expect(code).toMatch(/grant update \(status, handled_at\) on public\.meeting_requests to authenticated;/);
    expect(code).not.toMatch(/grant (insert|update|all)[^;(]* on public\.meeting_requests to authenticated/);
  });

  it("lets only the service role call meetings_for and the server lookups, and nobody anonymous call anything", () => {
    for (const service of ["meetings_for(text)", "lead_for_email(text, uuid)", "meeting_request_recipients(uuid)"]) {
      const name = service.replace(/[()]/g, "\\$&");
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${name}\\s+to service_role;`));
      expect(code).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\s+to authenticated`));
    }
    for (const grant of code.match(/grant [^;]+;/gi) ?? []) expect(grant, grant).not.toMatch(/\banon\b/);
  });

  it("matches a rebooking client by the exact address, never a pattern", () => {
    const lookup = fn("lead_for_email");
    expect(lookup).toMatch(/lower\(trim\(l\.email\)\) = lower\(trim\(p_email\)\)/);
    expect(lookup).not.toMatch(/\b(i?like|similar to|~)\b/i);
    expect(lookup).toMatch(/l\.agency_id = p_agency_id/);
  });

  it("does not repeat an enquiry for a follow-up meeting", () => {
    const enquiries = fn("enquiries_for");
    expect(enquiries).toMatch(/fm\.kind = 'first'/);
    expect(enquiries).toMatch(/limit 1/);
  });

  it("judges a lead stale by its latest meeting, and clears the new free text with it", () => {
    const retention = fn("anonymize_stale_leads");
    expect(retention).toMatch(/max\(lm\.scheduled_at\)/);
    expect(retention).toMatch(/set timing = null, notes = null, client_summary = null, location = null/);
    expect(retention).toMatch(/update public\.meeting_requests r\s+set note = null/);
  });
});
