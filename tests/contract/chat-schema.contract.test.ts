import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

const migration = readFileSync(join(REPO_ROOT, "supabase/migrations/20261016000000_chat_conversations.sql"), "utf8");
const schedule = readFileSync(join(REPO_ROOT, "supabase/migrations/20261016010000_chat_purge_schedule.sql"), "utf8");
const TABLES = ["chat_conversations", "chat_messages", "chat_usage", "chat_budget_alerts"];

describe("the chat tables", () => {
  it.each(TABLES)("%s has row-level security on", (table) => {
    expect(migration).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
  });

  it("are closed to anon and to authenticated writes", () => {
    expect(migration).toMatch(/revoke all on public\.chat_conversations, public\.chat_messages, public\.chat_usage, public\.chat_budget_alerts from anon, authenticated;/);
    expect(migration).toMatch(/grant select on public\.chat_conversations, public\.chat_messages, public\.chat_usage to authenticated;/);
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/);
  });

  it("let a member or an admin read their own agency's rows, and nobody else", () => {
    for (const table of ["chat_conversations", "chat_messages", "chat_usage"]) {
      expect(migration).toMatch(new RegExp(`create policy ${table}_read_member_or_admin on public\\.${table}\\s+for select to authenticated using \\(public\\.can_see\\(agency_id\\) or public\\.is_admin\\(\\)\\);`));
    }
    expect(migration).not.toMatch(/create policy chat_budget_alerts/);
  });

  it("delete a transcript with its lead, and messages and usage with their conversation", () => {
    expect(migration).toMatch(/lead_id\s+uuid references public\.leads\(id\) on delete cascade/);
    expect(migration.match(/references public\.chat_conversations\(id\) on delete cascade/g)).toHaveLength(2);
  });

  it("keep transcripts twelve months by default", () => {
    expect(migration).toMatch(/delete_after\s+timestamptz not null default \(now\(\) \+ interval '12 months'\)/);
  });

  it("open the usage totals and the purge to the service role only", () => {
    for (const fn of ["chat_month_usage\\(uuid, timestamptz\\)", "purge_chat_conversations\\(\\)"]) {
      expect(migration).toMatch(new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated;`));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${fn} to service_role;`));
    }
  });

  it("schedule the purge nightly, after enabling pg_cron", () => {
    expect(schedule).toMatch(/create extension if not exists pg_cron/);
    expect(schedule).toMatch(/cron\.schedule\(\s*'chat-purge-nightly',\s*'15 1 \* \* \*',\s*\$\$select public\.purge_chat_conversations\(\)\$\$\s*\)/);
  });
});
