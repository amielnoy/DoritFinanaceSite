import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

const migration = readFileSync(join(REPO_ROOT, "supabase/migrations/20261016000000_chat_conversations.sql"), "utf8");
const schedule = readFileSync(join(REPO_ROOT, "supabase/migrations/20261016010000_chat_purge_schedule.sql"), "utf8");
const TABLES = ["chat_conversations", "chat_messages", "chat_usage", "chat_budget_alerts"];
/** The SQL without its `--` comments, which say "grant … to anon" in prose. */
const code = (sql: string) => sql.replace(/--.*$/gm, "");
/** Any grant naming insert, update, delete or all (alone or in a list) to authenticated. */
const WRITE_TO_AUTHENTICATED = /\bgrant\s[^;]*\b(insert|update|delete|all)\b[^;]*\bto\s[^;]*\bauthenticated\b/i;
/** Any grant at all to anon. */
const ANY_TO_ANON = /\bgrant\s[^;]*\bto\s[^;]*\banon\b/i;

describe("the chat tables", () => {
  it.each(TABLES)("%s has row-level security on", (table) => {
    expect(migration).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
  });

  it("are closed to anon and to authenticated writes", () => {
    expect(migration).toMatch(/revoke all on public\.chat_conversations, public\.chat_messages, public\.chat_usage, public\.chat_budget_alerts from anon, authenticated;/);
    expect(migration).toMatch(/grant select on public\.chat_conversations, public\.chat_messages, public\.chat_usage to authenticated;/);
    expect(code(migration)).not.toMatch(WRITE_TO_AUTHENTICATED);
    expect(code(migration)).not.toMatch(ANY_TO_ANON);
  });

  it("guard against write grants hidden in a list and against any grant to anon", () => {
    // The guards above, proven on the statements they exist to catch.
    for (const bad of [
      "grant select, insert on public.chat_messages to authenticated;",
      "grant all on public.chat_conversations to authenticated;",
      "grant update (status) on public.chat_conversations to service_role, authenticated;",
    ]) {
      expect(bad).toMatch(WRITE_TO_AUTHENTICATED);
    }
    expect("grant select on public.chat_usage to anon;").toMatch(ANY_TO_ANON);
    expect("grant select on public.chat_usage to authenticated;").not.toMatch(WRITE_TO_AUTHENTICATED);
    expect("grant select, insert, update, delete on public.chat_usage to service_role;").not.toMatch(WRITE_TO_AUTHENTICATED);
    expect(code("-- the default privileges grant every new table to anon\nselect 1;")).not.toMatch(ANY_TO_ANON);
  });

  it("let a member or an admin read their own agency's rows, and nobody else", () => {
    for (const table of ["chat_conversations", "chat_messages", "chat_usage"]) {
      expect(migration).toMatch(new RegExp(`create policy ${table}_read_member_or_admin on public\\.${table}\\s+for select to authenticated using \\(public\\.can_see\\(agency_id\\) or public\\.is_admin\\(\\)\\);`));
    }
    expect(migration).not.toMatch(/create policy chat_budget_alerts/);
    // Exactly those three: a fourth policy would be a door these tests do not describe.
    expect(code(migration).match(/create policy chat_/g)).toHaveLength(3);
  });

  it("delete a transcript with its lead, and messages and usage with their conversation", () => {
    expect(migration).toMatch(/lead_id\s+uuid references public\.leads\(id\) on delete cascade/);
    expect(migration.match(/references public\.chat_conversations\(id\) on delete cascade/g)).toHaveLength(2);
  });

  it("record a hand-off apart from status, so a lead and a hand-off can both be told", () => {
    expect(migration).toMatch(/escalated_at\s+timestamptz,/);
  });

  it("hold a conversation for one turn at a time with a lease, free by default (I3)", () => {
    expect(migration).toMatch(/busy_until\s+timestamptz,/);
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

describe("the support sheet-log sweep (20261018000000)", () => {
  const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
  const sql = read("supabase/migrations/20261018000000_chat_support_sheet_log.sql");
  const code = sql.replace(/--[^\n]*/g, "");

  it("marks a logged conversation with a nullable timestamp, indexed for the sweep", () => {
    expect(code).toMatch(/alter table public\.chat_conversations\s+add column sheet_logged_at timestamptz;/);
    expect(code).toMatch(/create index [a-z_]+ on public\.chat_conversations \(last_message_at\)\s+where sheet_logged_at is null/);
  });

  it("calls the function only with both Vault secrets, and never hard-codes the project URL", () => {
    expect(code).toMatch(/vault\.decrypted_secrets where name = 'chat_sweep_url'/);
    expect(code).toMatch(/vault\.decrypted_secrets where name = 'chat_sweep_token'/);
    expect(code).toMatch(/if base_url is null or token is null then\s+return;/);
    expect(code).toMatch(/net\.http_post\(/);
    expect(code).toMatch(/'x-chat-sweep', token/);
    expect(code).not.toMatch(/hjowdyiwjjrqceumkvgt/);
  });

  it("is security definer with an empty search path, and executable by no API role", () => {
    expect(code).toMatch(/create function public\.chat_sweep_tick\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/);
    expect(code).toMatch(/revoke execute on function public\.chat_sweep_tick\(\) from public, anon, authenticated, service_role;/);
  });

  it("runs every 15 minutes", () => {
    expect(code).toMatch(/cron\.schedule\(\s*'chat-support-sheet-log',\s*'\*\/15 \* \* \* \*',\s*\$\$select public\.chat_sweep_tick\(\)\$\$\s*\)/);
  });
});
