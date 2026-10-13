# Connectors off Base44 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `submitLead`, `escalateToHuman` and `logSupportChat` to Supabase Edge Functions that reach Google Calendar and Sheets through a service account, send meeting invitations as `.ics` mail, and write Supabase only — then turn the Base44 versions into forwarders for the chat agents.

**Architecture:** Three Edge Functions (`submit-lead`, `escalate-to-human`, `log-support-chat`) on the `submit-claim` pattern: `handler.ts` + `index.ts`, shared modules in `supabase/functions/_shared/`, run in-process by the esbuild test harness. New shared modules: `google.ts` (service-account token), `calendar.ts`, `sheets.ts`, `ics.ts`. `submitLead`'s message builders move verbatim into `submit-lead/lead.js`. The browser switches with `VITE_LEAD_FUNCTIONS`; the agents switch in a second PR.

**Tech Stack:** Deno Edge Functions (TypeScript + one verbatim JS module), Web Crypto RS256, Google Calendar v3 and Sheets v4 REST, PostgREST, Cloudflare Pages Function (`dorit-mailer`) + Resend, Vitest, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md`

## Global Constraints

- Every request to a Google or Supabase API carries `signal: AbortSignal.timeout(10000)` (the limiter and token exchange: as in their code below).
- Every logged `err:` is `String(e?.message ?? e).slice(0, 200)` inline — `tests/contract/logging.contract.test.ts` reads it.
- No Edge Function or shared module mentions `googledocs`, `outlook`, `graph.microsoft.com` or `connectors.`.
- Secrets are read with `Deno.env.get` and never logged or returned; `ready` reports booleans only.
- Calendar scope `https://www.googleapis.com/auth/calendar.events`; Sheets scope `https://www.googleapis.com/auth/spreadsheets`. No other scopes.
- Event reminders: popup 60 minutes, email 720 minutes; time zone `Asia/Jerusalem`; no `attendees`.
- `.ics`: `METHOD:REQUEST`, UTC times, CRLF line ends, lines folded at 75 octets, RFC 5545 text escaping, at most 20 kB.
- `CALENDAR_ATTENDEES` stays `["dorit@govari-fin.co.il", "amielnoy@gmail.com", "amielnoy@outlook.com"]`.
- Supabase is the only store: no Edge Function writes Base44.
- Browser default stays Base44: `VITE_LEAD_FUNCTIONS` unset or anything but `supabase` means Base44.
- Commits end with the two attribution lines this repo uses (`Co-Authored-By: …`, `Claude-Session: …`).

## Review Focus

1. **A Google failure mid-request** — token endpoint down, calendar `403` (calendar not shared yet), sheet `404` (wrong `SHEET_ID`): the lead must still be saved and mailed, with one warning each and no invite sent. Pinned in Task 7 (`submit-lead — when Google is not there`).
2. **The first switch-over day** — an interview whose partial save went through Base44 and whose completion reaches Edge: the open-interview lookup must find the Base44-mirrored row (it has `base44_id`, status `partial`) and update it, not create a second. Pinned in Task 7 (`completes an interview whose partial save came through Base44`).
3. **Hebrew in an invitation** — a summary with commas, semicolons and newlines, and a description longer than 75 bytes: Outlook must parse it, so no line may split a UTF-8 sequence. Pinned in Task 3.
4. **A booking for a Supabase-only lead in the personal area** — must show, through `lead_id`. Pinned in Task 1 (SQL check).
5. **The agent's tool call through the forwarder** — the agent reads the JSON answer; a forwarder must return the Edge body and status unchanged, including a `400` with Hebrew text, and must not turn an Edge `500` into a Base44 crash page. Pinned in Task 13.

---

### Task 1: `meetings.lead_id`, and the personal area joins on it

**Files:**
- Create: `supabase/migrations/20261013000000_meetings_lead_id.sql`
- Modify: `supabase/tests/account_check.sql` (append one block)

**Interfaces:**
- Produces: `public.meetings.lead_id uuid not null unique references public.leads(id) on delete cascade`; trigger `meetings_fill_lead_id`; `public.enquiries_for(text)` joining on `m.lead_id = l.id`. Task 4's `upsertRow('meetings', row, 'lead_id')` relies on the unique constraint.

- [ ] **Step 1: Write the migration**

```sql
-- A booking keyed by the lead's Supabase id, not its Base44 id.
--
-- meetings.lead_base44_id (not null, FK to leads.base44_id) was the only key,
-- and enquiries_for joined on it. A lead written only to Supabase — every lead
-- once submit-lead serves the site — has no base44_id, so it could not get a
-- booking row, and the personal area could not show one. See
-- docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md.

alter table public.meetings
  add column lead_id uuid references public.leads(id) on delete cascade;

update public.meetings m
   set lead_id = l.id
  from public.leads l
 where l.base44_id = m.lead_base44_id;

alter table public.meetings alter column lead_id set not null;
alter table public.meetings add constraint meetings_lead_id_key unique (lead_id);
alter table public.meetings alter column lead_base44_id drop not null;

-- Until Base44 stops writing, its mirror upserts by lead_base44_id alone.
-- Fill lead_id from it so that path keeps working; a row with neither is
-- refused by the not-null above.
create function public.meetings_fill_lead_id() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is null and new.lead_base44_id is not null then
    select l.id into new.lead_id from public.leads l where l.base44_id = new.lead_base44_id;
  end if;
  return new;
end;
$$;

create trigger meetings_fill_lead_id
  before insert or update on public.meetings
  for each row execute function public.meetings_fill_lead_id();

create or replace function public.enquiries_for(p_email text)
returns table (
  created_at    timestamptz,
  source        text,
  track         text,
  track_label   text,
  meeting_topic text,
  timing        text,
  scheduled_at  timestamptz,
  summary       text,
  profile       jsonb,
  completed     boolean,
  in_calendar   boolean
)
  language sql security definer stable set search_path = public as $$
  select l.created_at, l.source, l.track, l.track_label, l.meeting_topic, l.timing,
         coalesce(m.scheduled_at, l.scheduled_at),
         l.summary, l.profile,
         l.status is distinct from 'partial',
         coalesce(m.calendar_status like 'אירוע נוצר%', false)
    from public.leads l
    left join public.meetings m on m.lead_id = l.id
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
   order by l.created_at desc
$$;
```

- [ ] **Step 2: Append the check to `supabase/tests/account_check.sql`, before its final `rollback;`**

```sql
-- ── a booking for a lead that exists only in Supabase ──────────────────────
reset role;
insert into public.leads (id, name, phone, email, source, status)
values ('00000000-0000-4000-8000-0000000000c1', 'רק סופבייס', '0500000001', 'only-supabase@example.test', 'interview', 'new');
insert into public.meetings (lead_id, scheduled_at, calendar_status)
values ('00000000-0000-4000-8000-0000000000c1', '2026-11-01 10:00+02', 'אירוע נוצר ✓ (google)');

do $$ begin
  if not exists (
    select 1 from public.enquiries_for('only-supabase@example.test')
     where scheduled_at = '2026-11-01 10:00+02' and in_calendar
  ) then
    raise exception 'a Supabase-only lead''s booking does not reach the personal area';
  end if;
end $$;

-- ── Base44's mirror still writes by lead_base44_id alone ───────────────────
insert into public.leads (id, base44_id, name, phone, email, source, status)
values ('00000000-0000-4000-8000-0000000000c2', 'b44-check-1', 'מבייס44', '0500000002', 'b44@example.test', 'consultation', 'new');
insert into public.meetings (lead_base44_id, topic) values ('b44-check-1', 'פנסיה');

do $$ begin
  if (select lead_id from public.meetings where lead_base44_id = 'b44-check-1')
       is distinct from '00000000-0000-4000-8000-0000000000c2' then
    raise exception 'the trigger did not fill lead_id from lead_base44_id';
  end if;
end $$;
```

- [ ] **Step 3: Run the checks against a local database, rolled back**

Run (with `supabase start` running; `S` = a scratch directory):
```bash
python3 - "$S" <<'EOF'
import sys,re; S=sys.argv[1]
mig=open('supabase/migrations/20261013000000_meetings_lead_id.sql').read()
chk=open('supabase/tests/account_check.sql').read()
chk=re.sub(r'^\\set ON_ERROR_STOP on\n','',chk,flags=re.M); chk=re.sub(r'^(begin|rollback);\n?','',chk,flags=re.M)
open(S+'/c.sql','w').write('\\set ON_ERROR_STOP on\nbegin;\n'+mig+'\n'+chk+"\nreset role;\nselect 'ALL CHECKS PASSED';\nrollback;\n")
EOF
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -X -q -f "$S/c.sql" | tail -3
```
Expected: `ALL CHECKS PASSED`. Then run `$S/c.sql` without the migration text (account_check only) and expect `a Supabase-only lead's booking does not reach the personal area` — proof the check bites.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261013000000_meetings_lead_id.sql supabase/tests/account_check.sql
git commit -m "meetings.lead_id: a booking for a lead that exists only in Supabase"
```

---

### Task 2: `_shared/google.ts` — a service-account token

**Files:**
- Create: `supabase/functions/_shared/google.ts`
- Test: `tests/unit/edge-google.test.ts`

**Interfaces:**
- Produces: `googleConfigured(): boolean`; `googleAccessToken(now?: number): Promise<string>` (throws `google_not_configured`, `google_token_http_<status>`, `google_token_missing`); `GOOGLE_SCOPES: readonly string[]`; `resetGoogleTokenCache(): void` (tests only).

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_SCOPES,
  googleAccessToken,
  googleConfigured,
  resetGoogleTokenCache,
} from "../../supabase/functions/_shared/google";

async function testKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64")}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("googleAccessToken", () => {
  let env: Record<string, string>;
  let calls: { url: string; body: string }[];
  let key: Awaited<ReturnType<typeof testKey>>;

  beforeEach(async () => {
    resetGoogleTokenCache();
    key = await testKey();
    env = {
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "leads@project.iam.gserviceaccount.com",
        private_key: key.pem,
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    };
    vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: 3600 }), { status: 200 });
    }));
  });

  it("is configured only with a key that has an address and a private key", () => {
    expect(googleConfigured()).toBe(true);
    env.GOOGLE_SERVICE_ACCOUNT_JSON = "{}";
    expect(googleConfigured()).toBe(false);
    env.GOOGLE_SERVICE_ACCOUNT_JSON = "not json";
    expect(googleConfigured()).toBe(false);
  });

  it("exchanges a JWT signed with the key, for exactly the two scopes", async () => {
    expect(await googleAccessToken(Date.UTC(2026, 9, 13, 8))).toBe("tok-1");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, p, s] = form.get("assertion")!.split(".");
    expect(JSON.parse(b64urlDecode(h).toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(b64urlDecode(p).toString());
    expect(claims).toMatchObject({
      iss: "leads@project.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      scope: GOOGLE_SCOPES.join(" "),
      iat: Date.UTC(2026, 9, 13, 8) / 1000,
      exp: Date.UTC(2026, 9, 13, 8) / 1000 + 3600,
    });
    expect(GOOGLE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.publicKey,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok, "signature does not verify with the key's public half").toBe(true);
  });

  it("reuses the token within its hour and renews it five minutes before the end", async () => {
    const t0 = Date.UTC(2026, 9, 13, 8);
    expect(await googleAccessToken(t0)).toBe("tok-1");
    expect(await googleAccessToken(t0 + 54 * 60_000)).toBe("tok-1");
    expect(await googleAccessToken(t0 + 56 * 60_000)).toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("names the failure without the endpoint's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_grant","error_description":"secret stuff"}', { status: 400 })));
    await expect(googleAccessToken()).rejects.toThrow(/^google_token_http_400$/);
    env.GOOGLE_SERVICE_ACCOUNT_JSON = "";
    resetGoogleTokenCache();
    await expect(googleAccessToken()).rejects.toThrow("google_not_configured");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/edge-google.test.ts`
Expected: FAIL — cannot resolve `supabase/functions/_shared/google`.

- [ ] **Step 3: Write `supabase/functions/_shared/google.ts`**

```ts
/**
 * An access token for Dorit's calendar and leads sheet, from a Google service
 * account she shares them with.
 *
 * Replaces Base44's connector OAuth, whose refresh tokens lapsed without a
 * sound (docs/base44-exit/00-inventory.md §5). A service account has no
 * refresh token and no consent screen: its key signs a JWT, Google answers
 * with an hour's access token. The key lives only in the function secret
 * GOOGLE_SERVICE_ACCOUNT_JSON. No Google SDK — Web Crypto signs, `fetch`
 * exchanges — so the in-process test harness runs this unchanged.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Renew this long before Google's expiry, so a slow request never carries a dead token. */
const RENEW_MARGIN_MS = 5 * 60_000;

let cached: { token: string; expiresAt: number } | null = null;

/** For tests: forget the cached token. */
export function resetGoogleTokenCache(): void {
  cached = null;
}

function serviceAccount(): ServiceAccount | null {
  try {
    const parsed = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '') as Partial<ServiceAccount>;
    return typeof parsed?.client_email === 'string' && typeof parsed?.private_key === 'string'
      ? (parsed as ServiceAccount)
      : null;
  } catch {
    return null;
  }
}

/** Whether a token could be asked for — a boolean, never the key. */
export function googleConfigured(): boolean {
  return serviceAccount() !== null;
}

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (value: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(value)));

function signingKey(pem: string): Promise<CryptoKey> {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** A bearer token for GOOGLE_SCOPES, cached until five minutes before it expires. */
export async function googleAccessToken(now: number = Date.now()): Promise<string> {
  if (cached && cached.expiresAt - RENEW_MARGIN_MS > now) return cached.token;

  const sa = serviceAccount();
  if (!sa) throw new Error('google_not_configured');
  const aud = sa.token_uri || DEFAULT_TOKEN_URI;
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iss: sa.client_email,
    scope: GOOGLE_SCOPES.join(' '),
    aud,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), new TextEncoder().encode(unsigned)),
  );

  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  // The status only: Google's error text can quote the request back.
  if (!res.ok) throw new Error(`google_token_http_${res.status}`);
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof body?.access_token !== 'string') throw new Error('google_token_missing');
  const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  cached = { token: body.access_token, expiresAt: now + ttl * 1000 };
  return cached.token;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/edge-google.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/google.ts tests/unit/edge-google.test.ts
git commit -m "Edge: a Google service-account token, signed with Web Crypto"
```

---

### Task 3: `_shared/ics.ts` — the meeting invitation

**Files:**
- Create: `supabase/functions/_shared/ics.ts`
- Test: `tests/unit/edge-ics.test.ts`

**Interfaces:**
- Produces: `buildInvitation(invite: Invitation): string`, where
  `interface Invitation { uid: string; start: Date; end: Date; summary: string; description: string; organizer: string; organizerName: string; attendee: string; stamp?: Date }`.
  `MAX_ICS_BYTES = 20_000`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildInvitation, MAX_ICS_BYTES } from "../../supabase/functions/_shared/ics";

const invite = {
  uid: "abc123@google.com",
  start: new Date("2026-10-14T07:00:00Z"),
  end: new Date("2026-10-14T07:30:00Z"),
  summary: "בקשת ייעוץ חדשה — רונית, מזרחי; בדיקה",
  description: "שם: רונית מזרחי\nטלפון: 0536667788\nתחום ייעוץ: פנסיה, גמל והשתלמות; ביטוח בריאות משלים",
  organizer: "govaridorit@gmail.com",
  organizerName: "דורית גוב ארי",
  attendee: "dorit@govari-fin.co.il",
  stamp: new Date("2026-10-13T08:00:00Z"),
};

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("buildInvitation", () => {
  it("is a REQUEST for one event, in UTC, with the Google event's UID", () => {
    const ics = unfold(buildInvitation(invite));
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("\r\nMETHOD:REQUEST\r\n");
    expect(ics).toContain("\r\nUID:abc123@google.com\r\n");
    expect(ics).toContain("\r\nDTSTART:20261014T070000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261014T073000Z\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261013T080000Z\r\n");
    expect(ics).toContain('\r\nORGANIZER;CN="דורית גוב ארי":mailto:govaridorit@gmail.com\r\n');
    expect(ics).toContain("\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:dorit@govari-fin.co.il\r\n");
    expect(ics).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/);
  });

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const ics = unfold(buildInvitation({ ...invite, summary: "א, ב; ג\\ד" }));
    expect(ics).toContain("\r\nSUMMARY:א\\, ב\\; ג\\\\ד\r\n");
    expect(ics).toContain("DESCRIPTION:שם: רונית מזרחי\\nטלפון: 0536667788\\nתחום ייעוץ: פנסיה\\, גמל והשתלמות\\; ביטוח בריאות משלים");
  });

  it("folds every line at 75 octets without splitting a Hebrew character", () => {
    const raw = buildInvitation({ ...invite, description: "דורית ".repeat(80) });
    for (const line of raw.split("\r\n")) {
      const bytes = new TextEncoder().encode(line);
      expect(bytes.length, `line too long: ${line.slice(0, 20)}…`).toBeLessThanOrEqual(75);
      // A split sequence decodes to U+FFFD.
      expect(new TextDecoder().decode(bytes)).not.toContain("\uFFFD");
    }
    expect(unfold(raw)).toContain(`DESCRIPTION:${"דורית ".repeat(80)}`);
  });

  it("refuses an invitation over the size the mailer accepts", () => {
    expect(() => buildInvitation({ ...invite, description: "x".repeat(MAX_ICS_BYTES) })).toThrow("ics_too_large");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/edge-ics.test.ts`
Expected: FAIL — cannot resolve `_shared/ics`.

- [ ] **Step 3: Write `supabase/functions/_shared/ics.ts`**

```ts
/**
 * A meeting invitation (RFC 5545, METHOD:REQUEST) for one booked meeting.
 *
 * Dorit works in her Microsoft 365 Outlook calendar, and a Google service
 * account cannot add attendees on a consumer calendar. So the event goes to
 * her Google calendar without attendees, and this file goes to each address
 * by mail; Outlook offers it as a meeting to accept. The UID is the Google
 * event's iCalUID, so both are one meeting. Times are UTC, which needs no
 * VTIMEZONE block.
 */

export interface Invitation {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  organizer: string;
  organizerName: string;
  attendee: string;
  stamp?: Date;
}

/** The mailer refuses more than this; refusing here names the cause. */
export const MAX_ICS_BYTES = 20_000;

const utc = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const text = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A parameter value, quoted: a display name may hold a comma or a colon. */
const param = (s: string): string => `"${s.replace(/"/g, "'")}"`;

const encoder = new TextEncoder();

/** Fold at 75 octets (RFC 5545 §3.1), never inside a UTF-8 sequence. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // a continuation line spends one octet on its leading space
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildInvitation(i: Invitation): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//govari-fin.co.il//leads//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `DTSTAMP:${utc(i.stamp ?? new Date())}`,
    `DTSTART:${utc(i.start)}`,
    `DTEND:${utc(i.end)}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    `SUMMARY:${text(i.summary)}`,
    `DESCRIPTION:${text(i.description)}`,
    `ORGANIZER;CN=${param(i.organizerName)}:mailto:${i.organizer}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${i.attendee}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const ics = lines.map(fold).join('\r\n') + '\r\n';
  if (encoder.encode(ics).length > MAX_ICS_BYTES) throw new Error('ics_too_large');
  return ics;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/edge-ics.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ics.ts tests/unit/edge-ics.test.ts
git commit -m "Edge: meeting invitations as RFC 5545 REQUESTs, folded by bytes"
```

---

### Task 4: Calendar, sheet and the PostgREST calls the leads need

**Files:**
- Create: `supabase/functions/_shared/calendar.ts`, `supabase/functions/_shared/sheets.ts`
- Modify: `supabase/functions/_shared/rest.ts` (add `selectRows`, `updateRow`, `upsertRow`)
- Test: `tests/unit/edge-google-apis.test.ts`

**Interfaces:**
- Consumes: `googleAccessToken()` (Task 2).
- Produces:
  - `calendarConfigured(): boolean`
  - `createCalendarEvent(e: { summary: string; description: string; startIso: string; endIso: string }): Promise<{ id: string; iCalUID: string; htmlLink: string; start: Date; end: Date }>` — throws `calendar_not_configured`, `calendar_http_<status>`.
  - `appendSheetRow(tab: string, columnCount: number, row: unknown[]): Promise<string>` — `'לא מוגדר'` without `SHEET_ID`; `'נרשם ✓ — https://docs.google.com/spreadsheets/d/<id>/edit'` on success; throws `sheets_http_<status>`.
  - `selectRows(table: string, query: string): Promise<Record<string, unknown>[]>`
  - `updateRow(table: string, id: string, fields: Record<string, unknown>): Promise<void>`
  - `upsertRow(table: string, row: Record<string, unknown>, onConflict: string): Promise<void>`
  All three PostgREST calls throw `select_http_<status>` / `update_http_<status>` / `upsert_http_<status>` with PostgREST's code only, like `insertRow`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendSheetRow } from "../../supabase/functions/_shared/sheets";
import { calendarConfigured, createCalendarEvent } from "../../supabase/functions/_shared/calendar";
import { selectRows, updateRow, upsertRow } from "../../supabase/functions/_shared/rest";
import { resetGoogleTokenCache } from "../../supabase/functions/_shared/google";

vi.mock("../../supabase/functions/_shared/google", async (orig) => ({
  ...(await orig<typeof import("../../supabase/functions/_shared/google")>()),
  googleAccessToken: vi.fn(async () => "test-token"),
}));

let env: Record<string, string>;
let calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[];
let answer: (url: string) => Response;

beforeEach(() => {
  resetGoogleTokenCache();
  env = { GOOGLE_CALENDAR_ID: "govaridorit@gmail.com", SHEET_ID: "sheet-123", SUPABASE_URL: "https://p.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "svc" };
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
  calls = [];
  answer = () => new Response("{}", { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: String(init.method ?? "GET"), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer(url);
  }));
});

describe("createCalendarEvent", () => {
  it("writes to Dorit's calendar by id, with no attendees and today's reminders", async () => {
    answer = () => new Response(JSON.stringify({ id: "ev1", iCalUID: "ev1@google.com", htmlLink: "https://cal/ev1", start: { dateTime: "2026-10-14T10:00:00+03:00" }, end: { dateTime: "2026-10-14T10:30:00+03:00" } }), { status: 200 });
    const ev = await createCalendarEvent({ summary: "s", description: "d", startIso: "2026-10-14T10:00:00", endIso: "2026-10-14T10:30:00" });
    expect(calls[0].url).toBe("https://www.googleapis.com/calendar/v3/calendars/govaridorit%40gmail.com/events");
    expect(calls[0].headers.Authorization).toBe("Bearer test-token");
    expect(calls[0].body).toEqual({
      summary: "s",
      description: "d",
      start: { dateTime: "2026-10-14T10:00:00", timeZone: "Asia/Jerusalem" },
      end: { dateTime: "2026-10-14T10:30:00", timeZone: "Asia/Jerusalem" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }, { method: "email", minutes: 720 }] },
    });
    expect(ev).toMatchObject({ id: "ev1", iCalUID: "ev1@google.com", htmlLink: "https://cal/ev1" });
    expect(ev.start.toISOString()).toBe("2026-10-14T07:00:00.000Z");
  });

  it("names a refusal by status — a calendar that was never shared answers 404", async () => {
    answer = () => new Response('{"error":{"message":"Not Found"}}', { status: 404 });
    await expect(createCalendarEvent({ summary: "s", description: "d", startIso: "2026-10-14T10:00:00", endIso: "2026-10-14T10:30:00" })).rejects.toThrow(/^calendar_http_404$/);
  });

  it("is not configured without a calendar id", () => {
    env.GOOGLE_CALENDAR_ID = "";
    expect(calendarConfigured()).toBe(false);
  });
});

describe("appendSheetRow", () => {
  it("appends as entered, keeps a leading zero, and links the sheet", async () => {
    const status = await appendSheetRow("Events", 19, ["2026-10-14 10:00:00", "0536667788"]);
    expect(calls[0].url).toBe("https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/Events!A%3AS:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS");
    expect(calls[0].body).toEqual({ values: [["2026-10-14 10:00:00", "'0536667788"]] });
    expect(status).toBe("נרשם ✓ — https://docs.google.com/spreadsheets/d/sheet-123/edit");
  });

  it("says it is not configured, without calling Google, when there is no sheet", async () => {
    env.SHEET_ID = "";
    expect(await appendSheetRow("Events", 19, [])).toBe("לא מוגדר");
    expect(calls).toHaveLength(0);
  });
});

describe("PostgREST helpers", () => {
  it("selects with the service key and the query as given", async () => {
    answer = () => new Response(JSON.stringify([{ id: "a" }]), { status: 200 });
    expect(await selectRows("leads", "select=id&phone=eq.050")).toEqual([{ id: "a" }]);
    expect(calls[0]).toMatchObject({ url: "https://p.supabase.test/rest/v1/leads?select=id&phone=eq.050", method: "GET" });
    expect(calls[0].headers).toMatchObject({ apikey: "svc", Authorization: "Bearer svc" });
  });

  it("updates one row by id", async () => {
    await updateRow("leads", "abc", { status: "new" });
    expect(calls[0]).toMatchObject({ url: "https://p.supabase.test/rest/v1/leads?id=eq.abc", method: "PATCH", body: { status: "new" } });
  });

  it("upserts on the named key", async () => {
    await upsertRow("meetings", { lead_id: "abc", topic: "x" }, "lead_id");
    expect(calls[0].url).toBe("https://p.supabase.test/rest/v1/meetings?on_conflict=lead_id");
    expect(calls[0].headers.Prefer).toBe("resolution=merge-duplicates,return=minimal");
  });

  it("reports a refusal by status and code only", async () => {
    answer = () => new Response('{"code":"23505","message":"Failing row contains (secret)"}', { status: 409 });
    await expect(upsertRow("meetings", {}, "lead_id")).rejects.toThrow(/^upsert_http_409:23505$/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/edge-google-apis.test.ts`
Expected: FAIL — `_shared/sheets` and `_shared/calendar` do not exist; `selectRows` is not exported.

- [ ] **Step 3: Write `supabase/functions/_shared/calendar.ts`**

```ts
/**
 * One meeting in Dorit's Google calendar, written by the service account she
 * shared it with. No attendees: a service account cannot invite on a consumer
 * calendar, so invitations go out by mail (ics.ts). Reminders and time zone
 * are base44/functions/submitLead's.
 */
import { googleAccessToken } from './google.ts';

export interface CalendarEventInput {
  summary: string;
  description: string;
  /** Wall-clock in Israel, `YYYY-MM-DDTHH:MM:SS`, as wallClock() returns it. */
  startIso: string;
  endIso: string;
}

export interface CreatedEvent {
  id: string;
  iCalUID: string;
  htmlLink: string;
  start: Date;
  end: Date;
}

export function calendarConfigured(): boolean {
  return Boolean((Deno.env.get('GOOGLE_CALENDAR_ID') || '').trim());
}

export async function createCalendarEvent(e: CalendarEventInput): Promise<CreatedEvent> {
  const calendarId = (Deno.env.get('GOOGLE_CALENDAR_ID') || '').trim();
  if (!calendarId) throw new Error('calendar_not_configured');
  const token = await googleAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: e.summary,
      description: e.description,
      start: { dateTime: e.startIso, timeZone: 'Asia/Jerusalem' },
      end: { dateTime: e.endIso, timeZone: 'Asia/Jerusalem' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 720 },
        ],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`calendar_http_${res.status}`);
  const data = (await res.json()) as {
    id: string;
    iCalUID: string;
    htmlLink: string;
    start: { dateTime: string };
    end: { dateTime: string };
  };
  return {
    id: data.id,
    iCalUID: data.iCalUID,
    htmlLink: data.htmlLink,
    start: new Date(data.start.dateTime),
    end: new Date(data.end.dateTime),
  };
}
```

- [ ] **Step 4: Write `supabase/functions/_shared/sheets.ts`**

```ts
/**
 * One row appended to a tab of the leads sheet, by the service account Dorit
 * gave editor access. The body of base44/functions/submitLead's appendEventRow,
 * with the connector token replaced by googleAccessToken().
 */
import { googleAccessToken } from './google.ts';

/** A1 column letters for the n-th column (1 → A, 27 → AA). */
function columnLetters(n: number): string {
  let s = '';
  for (let k = n; k > 0; ) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = (k - r - 1) / 26;
  }
  return s;
}

export async function appendSheetRow(tab: string, columnCount: number, row: unknown[]): Promise<string> {
  const sheetId = (Deno.env.get('SHEET_ID') || '').trim();
  if (!sheetId) return 'לא מוגדר';
  const token = await googleAccessToken();
  // USER_ENTERED would read '0549988754' as a number and drop the zero.
  const cells = row.map((v) => {
    const s = v == null ? '' : String(v);
    return /^0\d+$/.test(s) ? `'${s}` : s;
  });
  const range = `${tab}!A:${columnLetters(columnCount)}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range).replace(/%21/g, '!')}` +
      ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [cells] }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw new Error(`sheets_http_${res.status}`);
  return `נרשם ✓ — https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}
```

- [ ] **Step 5: Add the three helpers to `supabase/functions/_shared/rest.ts`, after `insertRow`**

```ts
/** PostgREST's code from a refusal body, never its message (it can quote the row). */
async function refusal(res: Response): Promise<string> {
  const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9]{1,10}$/.test(code) ? `:${code}` : '';
}

function target(): { url: string; auth: Record<string, string> } {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const auth = serviceAuth();
  if (!url || !auth) throw new Error('supabase_not_configured');
  return { url, auth };
}

/** Rows matching a PostgREST query string (`select=…&col=eq.…&order=…`). */
export async function selectRows(table: string, query: string): Promise<Record<string, unknown>[]> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: { ...auth },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`select_http_${res.status}${await refusal(res)}`);
  const rows = await res.json();
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** One row, by its `id`. */
export async function updateRow(table: string, id: string, fields: Record<string, unknown>): Promise<void> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`update_http_${res.status}${await refusal(res)}`);
}

/** Insert or merge on a unique key — the booking row is written twice per request. */
export async function upsertRow(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`upsert_http_${res.status}${await refusal(res)}`);
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/edge-google-apis.test.ts tests/integration/submit-claim-edge.integration.test.ts`
Expected: PASS — the new file, and `submit-claim` unchanged.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/calendar.ts supabase/functions/_shared/sheets.ts supabase/functions/_shared/rest.ts tests/unit/edge-google-apis.test.ts
git commit -m "Edge: Dorit's calendar and the leads sheet through the service account; select, update and upsert"
```

---

### Task 5: `dorit-mailer` carries an invitation

**Files:**
- Modify: `dorit-mailer/functions/api/send-email.js` (the `rendered` branch and `deliver`)
- Modify: `supabase/functions/_shared/mail.ts` (`Mail.ics`, posted as `ics`)
- Test: `tests/integration/mailer.integration.test.ts` (add a `describe`)

**Interfaces:**
- Produces: `Mail { …; ics?: string }`; the mailer accepts `ics` (string, ≤ 20,000 chars) on `type: "rendered"` and forwards it to Resend as
  `attachments: [{ filename: "invite.ics", content: <base64 of UTF-8>, content_type: "text/calendar; method=REQUEST" }]`. Over the cap: `400 { ok: false, error: "ics_too_large" }`.

- [ ] **Step 1: Read how the mailer test posts a rendered message and captures the Resend body**

Run: `grep -nE "rendered|RESEND|resendBody|captured" tests/integration/mailer.integration.test.ts | head -20`
Use the same helper for the new cases (it is called `post` below; rename to the file's own).

- [ ] **Step 2: Write the failing tests (append to `tests/integration/mailer.integration.test.ts`)**

```ts
describe("a rendered message with a meeting invitation", () => {
  const ics = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nSUMMARY:ייעוץ\r\nEND:VCALENDAR\r\n";

  it("attaches it to Resend as one text/calendar REQUEST", async () => {
    const r = await post({ type: "rendered", to: "dorit@govari-fin.co.il", subject: "s", text: "t", ics });
    expect(r.status).toBe(200);
    expect(r.resendBody.attachments).toEqual([
      { filename: "invite.ics", content: Buffer.from(ics, "utf8").toString("base64"), content_type: "text/calendar; method=REQUEST" },
    ]);
  });

  it("sends no attachment when there is no invitation", async () => {
    const r = await post({ type: "rendered", to: "dorit@govari-fin.co.il", subject: "s", text: "t" });
    expect(r.resendBody.attachments).toBeUndefined();
  });

  it("refuses an invitation over 20 kB rather than clip it", async () => {
    const r = await post({ type: "rendered", to: "dorit@govari-fin.co.il", subject: "s", text: "t", ics: "x".repeat(20_001) });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, error: "ics_too_large" });
  });

  it("ignores ics on the other message types", async () => {
    const r = await post({ type: "contact", name: "דנה", phone: "0501234567", email: "d@example.com", message: "שלום", ics });
    expect(r.resendBody?.attachments).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run tests/integration/mailer.integration.test.ts -t "meeting invitation"`
Expected: FAIL — `attachments` undefined; no `ics_too_large`.

- [ ] **Step 4: Change `dorit-mailer/functions/api/send-email.js`**

In the `rendered` branch, after `mail = { … }` and before the `missing_content` check:

```js
    // A meeting invitation rides along as an attachment. Refused, not
    // clipped, past its cap: a clipped calendar file is a broken one.
    if (body.ics !== undefined) {
      if (typeof body.ics !== "string" || body.ics.length > MAX_ICS) {
        return json({ ok: false, error: "ics_too_large" }, 400, headers);
      }
      mail.ics = body.ics;
    }
```

Next to `MAX_RENDERED`:

```js
const MAX_ICS = 20_000;

/** Base64 of the UTF-8 bytes — the calendar text is Hebrew. */
function base64Utf8(text) {
  let s = "";
  for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b);
  return btoa(s);
}
```

In `deliver`, in the Resend body, after `text:`:

```js
        attachments: mail.ics
          ? [{ filename: "invite.ics", content: base64Utf8(mail.ics), content_type: "text/calendar; method=REQUEST" }]
          : undefined,
```

- [ ] **Step 5: Pass `ics` through `supabase/functions/_shared/mail.ts`**

In `interface Mail`, add `ics?: string;`. In `sendMail`, destructure `ics` and add it to the posted JSON:

```ts
export async function sendMail(log: Log, { to, subject, html, text, body, rid, role, ics }: Mail): Promise<void> {
```
```ts
      body: JSON.stringify({
        type: 'rendered',
        to,
        subject,
        html,
        text: text ?? body,
        ics,
      }),
```

- [ ] **Step 6: Run the mailer and edge suites**

Run: `npx vitest run tests/integration/mailer.integration.test.ts tests/integration/submit-claim-edge.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dorit-mailer/functions/api/send-email.js supabase/functions/_shared/mail.ts tests/integration/mailer.integration.test.ts
git commit -m "dorit-mailer: a rendered message may carry a meeting invitation"
```

---

### Task 6: The Edge harness answers Google and the lead tables

**Files:**
- Modify: `tests/helpers/edge-function.ts`
- Test: `tests/integration/edge-harness.integration.test.ts` (new, small)

**Interfaces:**
- Produces, on `EdgeOptions`:
  `existingLeads?: Record<string, unknown>[]` (rows `selectRows('leads', …)` answers, filtered by `phone=eq.`, `source=eq.`, `status=eq.`);
  `failGoogle?: "token" | "calendar" | "sheets"` (that call answers `500`);
  `calendarStatus?: number` (calendar answers this status);
  `noGoogle?: boolean` (env without `GOOGLE_SERVICE_ACCOUNT_JSON`).
  On `EdgeInvocation`: `leadUpdates: { id: string; fields: Record<string, unknown> }[]`, `meetings: Record<string, unknown>[]`, `calendarEvents: Record<string, unknown>[]`, `sheetRows: { tab: string; row: unknown[] }[]`, `callsTo(fragment: string): FetchCall[]`.
  Default env gains `GOOGLE_SERVICE_ACCOUNT_JSON` (a key generated once per test file), `GOOGLE_CALENDAR_ID: "govaridorit@gmail.com"`, `SHEET_ID: "sheet-test"`.

- [ ] **Step 1: Write the failing harness test**

```ts
import { describe, expect, it } from "vitest";
import { invokeEdge } from "../helpers/edge-function";

describe("the Edge harness, for the lead functions", () => {
  it("answers Google's token endpoint, the calendar and the sheet, and records them", async () => {
    const r = await invokeEdge("submit-claim", { name: "x", phone: "0500000000" });
    expect(r.status).toBe(200);
    expect(r.sheetRows).toEqual([]);
    expect(r.calendarEvents).toEqual([]);
    expect(r.callsTo("oauth2.googleapis.com")).toEqual([]);
  });
});
```

(It only proves the new fields exist and default empty; Task 7 exercises them.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/integration/edge-harness.integration.test.ts`
Expected: FAIL — `r.sheetRows` is undefined.

- [ ] **Step 3: Extend `tests/helpers/edge-function.ts`**

Add, at module level:

```ts
import { generateKeyPairSync } from "node:crypto";

/** One service-account key per test file: real RS256, signed by google.ts, never sent anywhere. */
const TEST_SA = (() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "leads@test-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    token_uri: "https://oauth2.googleapis.com/token",
  });
})();
```

Extend `EdgeOptions` and `EdgeInvocation` with the fields listed under *Interfaces*. In `invokeEdge`, declare the recorders:

```ts
  const leadUpdates: { id: string; fields: Record<string, unknown> }[] = [];
  const meetings: Record<string, unknown>[] = [];
  const calendarEvents: Record<string, unknown>[] = [];
  const sheetRows: { tab: string; row: unknown[] }[] = [];
  const stored: Record<string, unknown>[] = [...(options.existingLeads ?? [])];
```

Add these branches to `fetchImpl`, before the final `throw`:

```ts
    if (u === "https://oauth2.googleapis.com/token" && method === "POST") {
      if (options.failGoogle === "token") return new Response('{"error":"simulated"}', { status: 500 });
      return new Response(JSON.stringify({ access_token: "google-test-token", expires_in: 3600 }), { status: 200 });
    }
    if (u.startsWith("https://www.googleapis.com/calendar/v3/calendars/") && method === "POST") {
      if (options.failGoogle === "calendar") return new Response("{}", { status: 500 });
      if (options.calendarStatus && options.calendarStatus >= 400) return new Response("{}", { status: options.calendarStatus });
      const n = calendarEvents.push(parsed);
      return new Response(JSON.stringify({
        id: `ev${n}`,
        iCalUID: `ev${n}@google.com`,
        htmlLink: `https://calendar.google.com/event?eid=ev${n}`,
        start: { dateTime: `${parsed.start.dateTime}+03:00` },
        end: { dateTime: `${parsed.end.dateTime}+03:00` },
      }), { status: 200 });
    }
    if (u.startsWith("https://sheets.googleapis.com/v4/spreadsheets/") && method === "POST") {
      if (options.failGoogle === "sheets") return new Response("{}", { status: 500 });
      const tab = decodeURIComponent(u.split("/values/")[1]).split("!")[0];
      sheetRows.push({ tab, row: parsed.values[0] });
      return new Response("{}", { status: 200 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/leads?`) && method === "GET") {
      const q = new URLSearchParams(u.split("?")[1]);
      const eq = (k: string) => q.get(k)?.replace(/^eq\./, "");
      const rows = stored.filter((l) =>
        (!eq("phone") || l.phone === eq("phone")) &&
        (!eq("source") || l.source === eq("source")) &&
        (!eq("status") || l.status === eq("status")));
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (u.startsWith(`${SUPABASE_URL}/rest/v1/leads?id=eq.`) && method === "PATCH") {
      const id = decodeURIComponent(u.split("id=eq.")[1]);
      leadUpdates.push({ id, fields: parsed });
      const row = stored.find((l) => l.id === id);
      if (row) Object.assign(row, parsed);
      return new Response(null, { status: 204 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/meetings?on_conflict=lead_id` && method === "POST") {
      const at = meetings.findIndex((m) => m.lead_id === parsed.lead_id);
      if (at >= 0) Object.assign(meetings[at], parsed); else meetings.push({ ...parsed });
      return new Response(null, { status: 201 });
    }
```

Change the `leads` insert branch to also push into `stored` (so a later select in the same request sees it):

```ts
      leads.push(row);
      stored.push(row);
```

Default env:

```ts
  const env = options.env ?? {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ...(options.noGoogle ? {} : { GOOGLE_SERVICE_ACCOUNT_JSON: TEST_SA }),
    GOOGLE_CALENDAR_ID: "govaridorit@gmail.com",
    SHEET_ID: "sheet-test",
  };
```

Return the new recorders, and:

```ts
    callsTo: (fragment: string) => fetches.filter((f) => f.url.includes(fragment)),
```

- [ ] **Step 4: Run the harness test and the existing Edge suites**

Run: `npx vitest run tests/integration/edge-harness.integration.test.ts tests/integration/submit-claim-edge.integration.test.ts tests/integration/submit-claim.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/edge-function.ts tests/integration/edge-harness.integration.test.ts
git commit -m "Edge harness: Google token, calendar, sheet, and the lead and meeting tables"
```

---

### Task 7: `submit-lead`

**Files:**
- Create: `supabase/functions/submit-lead/lead.js` (verbatim builders), `supabase/functions/submit-lead/handler.ts`, `supabase/functions/submit-lead/index.ts`
- Modify: `supabase/config.toml` (add the function)
- Modify: `tests/integration/submit-lead.integration.test.ts` (both implementations)

**Interfaces:**
- Consumes: Tasks 2–6 (`googleConfigured`, `createCalendarEvent`, `calendarConfigured`, `appendSheetRow`, `buildInvitation`, `selectRows`, `updateRow`, `upsertRow`, `insertRow`, `sendMail` with `ics`), and the existing `_shared` guards, mail, log, attribution, device and CORS modules.
- Produces: `handler(req: Request): Promise<Response>`, answering exactly what Base44 `submitLead` answers: `400 { error, rid, ready }` for missing name/phone (with `ready: { db, mailer, google }`), `400 { error, rid }` for an oversized field, `500 { error, rid }` for a failed write, else `{ ok: true, rid, leadId, warnings }` (`stage: 'partial', notified: false` for a partial interview). `ready` is the only addition.

- [ ] **Step 1: Move the builders verbatim into `supabase/functions/submit-lead/lead.js`**

Copy these top-level declarations from `base44/functions/submitLead/entry.ts`, unchanged, in source order, each prefixed with `export`:
`wallClock`, `tomorrowInIsrael`, `israelInstant`, `CALENDAR_ATTENDEES`, `NOTIFY_EMAILS`, `SECONDARY_EMAIL`, `redact`, `SHEET_TAB`, `SHEET_COLUMNS`, `eventTypeFor`, `buildLinksFooter`, `buildOpsFooter`, `INTERVIEW_COMMON`, `INTERVIEW_TRACKS`, `INTERVIEW_WINDOW_MS`, `normalizeName`, `sameInterviewee`, `interviewCompleteness`, `completenessLine`, `interviewFields`, `profileValue`, `buildInterviewProfile`, `eyebrowFor`, `headingFor`, `buildAgentBody`, `MAIL`, `detailRow`, `block`, `proseRow`, `buildAgentHtml`, `POA_URL`, `plainOr`, `LEAD_FIELD_LIMITS`, `clientMailFor`, `buildClientText`, `subjectFor`.

Then make exactly these edits and no others:
- Add at the top: `import { escapeHtml, buildClientHtml } from '../_shared/html.ts';` (the shared copies are the ones `submit-claim` uses; `agents.contract.test.ts` already holds Base44's `escapeHtml` identical to them).
- `buildOpsFooter`: drop the `doc` line and the Outlook wording from the footer; it reports `calendar`, `sheet`, `invites`. Rename the parameter field `doc` → `invites`.
- `buildLinksFooter`: drop the Docs link line.
- `buildAgentHtml`: its links block drops `links.doc`.

Do not copy: `log`, `sendMail`, `deliveryWarning`, `upstreamReasons`, attribution helpers, `deviceLabel`, `escapeHtml`, `buildClientHtml`, `oversizedField`, `isEmail`, `greetingName`, `sha256Hex`, `withinLimit` (all in `_shared`), `CALENDARS`, `CALENDAR_PROVIDERS`, `SHEET_ID`, `mirrorLeadToSupabase`, `mirrorMeetingToSupabase`, `appendEventRow`, `createConsultationDoc`, `findOpenInterview`, `CONFIRMATIONS_PER_ADDRESS_PER_DAY` (replaced in the handler).

- [ ] **Step 2: Make the integration suite run both implementations**

At the top of `tests/integration/submit-lead.integration.test.ts`, replace direct `invokeFunction("submitLead", …)` calls with a `run` taken from:

```ts
import { invokeEdge } from "../helpers/edge-function";

type RunOptions = { existingLeads?: Record<string, unknown>[]; failEmailTo?: string[] };

const IMPLEMENTATIONS = [
  { label: "Base44 submitLead", edge: false, run: (body: unknown, o: RunOptions = {}) => invokeFunction("submitLead", body, o) },
  { label: "Edge submit-lead", edge: true, run: (body: unknown, o: RunOptions = {}) => invokeEdge("submit-lead", body, o) },
];
```

Wrap every existing top-level `describe` that is about behaviour both must share in `describe.each(IMPLEMENTATIONS)("$label", ({ run }) => { … })`. Leave a `describe` Base44-only when its assertions are about a decision the spec reverses, and say so in a comment naming the decision:
- Outlook / `graph.microsoft.com` / `CALENDAR_PROVIDERS` cases → `// Base44 only: the Edge function writes no Outlook event (spec, "No Outlook connector").`
- `createConsultationDoc` / `googledocs` cases → `// Base44 only: no per-enquiry Doc (spec, "No per-enquiry Google Doc").`
- `connections:` (unconnected connector) cases → `// Base44 only: there is no connector to be unconnected.`
- assertions on `r.leads` being Base44 entity writes plus a mirror → in the shared block, assert on the stored lead only (`r.leads[0]`); both harnesses expose the written row there.

- [ ] **Step 3: Add the Edge-only cases (append)**

```ts
describe("Edge submit-lead — what only it does", () => {
  const consultation = {
    name: "יעל כהן", phone: "0521234567", email: "yael@example.com", source: "consultation",
    topic: "גמל, השתלמות ופנסיה", timing: "בוקר", scheduledAt: "2026-10-20T10:00",
  };

  it("books Dorit's calendar by id, without attendees, and mails each attendee an invitation", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.status).toBe(200);
    expect(r.callsTo("/calendar/v3/calendars/govaridorit%40gmail.com/events")).toHaveLength(1);
    expect(r.calendarEvents[0]).not.toHaveProperty("attendees");
    const invited = r.emails.filter((e) => e.ics).map((e) => e.to).sort();
    expect(invited).toEqual(["amielnoy@gmail.com", "amielnoy@outlook.com", "dorit@govari-fin.co.il"]);
    expect(r.emails.find((e) => e.ics)!.ics).toContain("UID:ev1@google.com");
  });

  it("writes a booking row by the lead's Supabase id", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0]).toMatchObject({ lead_id: r.leads[0].id, source: "consultation" });
    expect(String(r.meetings[0].calendar_status)).toMatch(/^אירוע נוצר ✓/);
  });

  it("appends the Events row through the service account", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.sheetRows).toHaveLength(1);
    expect(r.sheetRows[0].tab).toBe("Events");
    expect(r.sheetRows[0].row[1]).toBe("consultation_request");
  });

  it("asks nothing of Docs, Outlook or Base44", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    for (const host of ["docs.googleapis.com", "graph.microsoft.com", "base44"]) {
      expect(r.callsTo(host), `called ${host}`).toEqual([]);
    }
  });

  it("answers the empty smoke request with what it could do", async () => {
    const r = await invokeEdge("submit-lead", {});
    expect(r.status).toBe(400);
    expect(r.json.ready).toEqual({ db: true, mailer: true, google: true });
    const noGoogle = await invokeEdge("submit-lead", {}, { noGoogle: true });
    expect(noGoogle.json.ready).toMatchObject({ google: false });
  });

  describe("submit-lead — when Google is not there", () => {
    for (const fail of ["token", "calendar", "sheets"] as const) {
      it(`still saves and mails when the ${fail} call fails, with one warning and no invitation`, async () => {
        const r = await invokeEdge("submit-lead", consultation, { failGoogle: fail });
        expect(r.status).toBe(200);
        expect(r.leads).toHaveLength(1);
        expect(r.emails.map((e) => e.to)).toContain("dorit@govari-fin.co.il");
        expect(r.json.warnings.length).toBeGreaterThan(0);
        if (fail !== "sheets") expect(r.emails.filter((e) => e.ics)).toEqual([]);
      });
    }

    it("reports a calendar that was never shared as rejected, not as an error page", async () => {
      const r = await invokeEdge("submit-lead", consultation, { calendarStatus: 404 });
      expect(r.status).toBe(200);
      expect(r.json.warnings).toContain("calendar_google_rejected");
    });
  });

  it("completes an interview whose partial save came through Base44", async () => {
    // The switch-over day: the partial row was mirrored from Base44 (it has a
    // base44_id); the completion reaches Edge. One row, updated.
    const partial = {
      id: "00000000-0000-4000-8000-0000000000aa", base44_id: "b44-partial-1", name: "אורי לוי",
      phone: "0541112233", email: "", source: "interview", status: "partial",
      created_at: new Date().toISOString(),
    };
    const r = await invokeEdge("submit-lead", {
      name: "אורי לוי", phone: "0541112233", source: "interview", stage: "complete", track: "pension",
    }, { existingLeads: [partial] });
    expect(r.leads).toHaveLength(0);
    expect(r.leadUpdates.map((u) => u.id)).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
    expect(r.leadUpdates[0].fields).toMatchObject({ status: "new" });
  });
});
```

Also add `ics?: string` to `EmailCall` in `tests/helpers/base44-function.ts` and record `parsed.ics` in the edge harness's mailer branch: `emails.push({ …, ics: parsed.ics })`.

- [ ] **Step 4: Run the suite and see the Edge half fail**

Run: `npx vitest run tests/integration/submit-lead.integration.test.ts`
Expected: the Base44 half PASSES; every Edge case FAILS with `Could not resolve "…/submit-lead/handler.ts"`.

- [ ] **Step 5: Write `supabase/functions/submit-lead/index.ts`**

```ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

- [ ] **Step 6: Write `supabase/functions/submit-lead/handler.ts`**

Structure — transcribe `export default async function(req)` of `base44/functions/submitLead/entry.ts` into `export async function handler(req: Request): Promise<Response>`, top to bottom, with these replacements and nothing else:

| Base44 | Edge |
|---|---|
| no CORS | `const cors = corsHeaders(req.headers.get('origin'))`; `OPTIONS` → `204`; every `Response.json(…)` gets `{ headers: cors }` (merge into the existing init) |
| `log(level, …)` | `const log = createLog('submit-lead')` at module level; same calls |
| `createClientFromRequest(req)` | removed |
| `await req.json()` | `await req.json().catch(() => null)` |
| missing name/phone `400 { error, rid }` | `400 { error, rid, ready: { db: supabaseConfigured(), mailer: mailerConfigured(), google: googleConfigured() && calendarConfigured() } }` |
| `oversizedField(body, LEAD_FIELD_LIMITS)` | `oversizedField(body ?? {}, LEAD_FIELD_LIMITS)` from `_shared/guard.ts` — **note** the shared `oversizedField` takes its limits as a second parameter; change its signature in `_shared/guard.ts` to `oversizedField(body, limits = FIELD_LIMITS)` and keep the documents check only when `limits === FIELD_LIMITS` |
| `findOpenInterview(base44, phone, name, email)` | `openInterview(phone, name, email)` below |
| `base44.asServiceRole.entities.Lead.update(id, fields)` | `updateRow('leads', id, fields)` |
| `base44.entities.Lead.create(row)` → `lead?.id` | `insertRow('leads', { …row, channel: safeChannel, campaign: safeCampaign })` → `row.id` |
| `mirrorLeadToSupabase(rid, leadId, row)` | removed — the insert/update above already wrote every field the mirror wrote; move the mirror's extra fields (`scheduled_at`, `meeting_topic`, `notes`, `track`, `summary`, `profile`, `track_label`) into the insert and the update |
| `mirrorMeetingToSupabase(rid, leadId, row)` | `upsertRow('meetings', { …row, lead_id: leadId }, 'lead_id')` in a `try`, logging `meeting.write_failed` with `err: String(e?.message ?? e).slice(0, 200)` on failure |
| `withinLimit(rid, key, …)` | `withinLimit(log, rid, key, …)` |
| `sha256Hex` | from `_shared/guard.ts` |
| `sendMail({ … })` | `sendMail(log, { … })` |
| `appendEventRow(base44, row)` | `appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, row)` |
| `createConsultationDoc(…)` and `docPromise` | removed; `doc` is gone from `links`, the skip loop and `opsOps` |
| the `CALENDAR_PROVIDERS` loop | one call, below |

The open-interview lookup, at module level:

```ts
async function openInterview(phone: string, name: unknown, email: unknown): Promise<Record<string, unknown> | null> {
  if (!phone) return null;
  try {
    const since = new Date(Date.now() - INTERVIEW_WINDOW_MS).toISOString();
    const rows = await selectRows(
      'leads',
      `select=id,name,email,timing,consent_version,consent_at,status,created_at` +
        `&phone=eq.${encodeURIComponent(phone)}&source=eq.interview&status=eq.partial` +
        `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`,
    );
    return rows.find((lead) => sameInterviewee(lead, name, email)) ?? null;
  } catch (e) {
    // Best-effort, as Base44's was: a duplicate beats a lost interview.
    log('warn', 'interview.lookup_failed', { err: String((e as Error)?.message ?? e).slice(0, 200) });
    return null;
  }
}
```

The calendar and the invitations, replacing the `CALENDAR_PROVIDERS` loop (`booksCalendar`, `calendar`, `calendarStartedAt` keep their meaning):

```ts
    let invites = booksCalendar ? 'לא נשלחו' : 'לא רלוונטי';
    if (booksCalendar) {
      const calStartIso = wallClock(scheduledAt) ?? `${tomorrowInIsrael()}T09:00:00`;
      const calEndIso = wallClock(calStartIso, 30);
      calendarStartedAt = calStartIso;
      const description = `${agentBody}\n\nלייצר קשר ולתאם מעקב.`;
      try {
        const ev = await createCalendarEvent({ summary: subject, description, startIso: calStartIso, endIso: calEndIso });
        log('info', 'calendar.created', { rid, provider: 'google' });
        calendar = `אירוע נוצר ✓ (google) — ${calStartIso.slice(0, 16).replace('T', ' ')}`;
        const sent = await Promise.all(CALENDAR_ATTENDEES.map(async (attendee: string) => {
          try {
            await sendMail(log, {
              to: attendee,
              subject: `הזמנה: ${subject}`,
              text: `${description}\n\nהאירוע ביומן: ${ev.htmlLink}`,
              ics: buildInvitation({
                uid: ev.iCalUID, start: ev.start, end: ev.end, summary: subject, description,
                organizer: Deno.env.get('GOOGLE_CALENDAR_ID')!.trim(), organizerName: 'דורית גוב ארי', attendee,
              }),
              rid,
              role: 'invite',
            });
            return true;
          } catch (e) {
            log('warn', 'invite.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
            warnings.push(deliveryWarning('invite_failed', e));
            return false;
          }
        }));
        invites = `נשלחו ${sent.filter(Boolean).length}/${CALENDAR_ATTENDEES.length}`;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        const rejected = /^calendar_http_4\d\d$/.test(msg);
        log(rejected ? 'error' : 'warn', rejected ? 'calendar.rejected' : 'calendar.failed', { rid, provider: 'google', err: msg.slice(0, 200) });
        warnings.push(rejected ? 'calendar_google_rejected' : 'calendar_google_failed');
      }
    }
```

`opsOps` becomes `{ source, leadId, topic, calendar, sheet, invites, warnings, channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath }`.

Imports, at the top of `handler.ts`:

```ts
import { channelLine, validCampaign, validChannel, validLandingPath } from '../_shared/attribution.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { deviceLabel } from '../_shared/device.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, mailerConfigured, sendMail } from '../_shared/mail.ts';
import { insertRow, selectRows, supabaseConfigured, updateRow, upsertRow } from '../_shared/rest.ts';
import { isEmail, oversizedField, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { googleConfigured } from '../_shared/google.ts';
import { calendarConfigured, createCalendarEvent } from '../_shared/calendar.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import { buildInvitation } from '../_shared/ics.ts';
import {
  CALENDAR_ATTENDEES, INTERVIEW_WINDOW_MS, LEAD_FIELD_LIMITS, NOTIFY_EMAILS, SECONDARY_EMAIL, SHEET_COLUMNS, SHEET_TAB,
  buildAgentBody, buildAgentHtml, buildClientText, buildInterviewProfile, buildLinksFooter, buildOpsFooter,
  clientMailFor, completenessLine, eventTypeFor, interviewCompleteness, israelInstant, plainOr, profileValue,
  redact, sameInterviewee, subjectFor, tomorrowInIsrael, wallClock,
} from './lead.js';

const log = createLog('submit-lead');
const CONFIRMATIONS_PER_ADDRESS_PER_DAY = 3;
```

- [ ] **Step 7: Register it in `supabase/config.toml`**

```toml
[functions.submit-lead]
verify_jwt = false
```

- [ ] **Step 8: Run the suite until both halves pass**

Run: `npx vitest run tests/integration/submit-lead.integration.test.ts`
Expected: PASS for both labels and the Edge-only block. A shared case that fails only for Edge is a porting bug: fix `handler.ts`/`lead.js`, never the assertion. A shared case that fails only because of a spec decision moves to a Base44-only block with its comment (Step 2).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/submit-lead supabase/functions/_shared/guard.ts supabase/config.toml tests/integration/submit-lead.integration.test.ts tests/helpers/edge-function.ts tests/helpers/base44-function.ts
git commit -m "submit-lead on Supabase Edge: Google through the service account, invitations by mail"
```

---

### Task 8: `escalate-to-human`

**Files:**
- Create: `supabase/functions/escalate-to-human/handler.ts`, `supabase/functions/escalate-to-human/index.ts`, `supabase/functions/escalate-to-human/escalation.js` (verbatim builders)
- Modify: `supabase/config.toml`
- Modify: the integration suite for `escalateToHuman` (find it: `grep -rl '"escalateToHuman"' tests/integration`) to `describe.each` over both

**Interfaces:**
- Produces: `handler(req)`, answering what Base44 `escalateToHuman` answers (`{ ok, rid, leadId, recorded, notified, reason, contact, acknowledgement, warnings }`; on a thrown error `200 { ok: false, rid, contact, acknowledgement }`), plus `ready` on the empty request is **not** added — `escalateToHuman` has no `400` path; the smoke uses `{ reason: "uncertain" }` and asserts `ok: true, recorded: false`.

- [ ] **Step 1: Move the builders verbatim into `escalation.js`**

From `base44/functions/escalateToHuman/entry.ts`, with `export`, unchanged: `NOTIFY_EMAILS`, `SECONDARY_EMAIL`, `HUMAN_CONTACT`, `REASONS`, `URGENT`, `redact`, `SHEET_TAB`, `SHEET_COLUMNS`, `buildNotification`, `MAIL`, `detailRow`, `block`, `proseRow`, `buildEscalationHtml`, and the `validPhone` it uses (find it: `grep -n "function validPhone" base44/functions/escalateToHuman/entry.ts`). Import `escapeHtml` from `../_shared/html.ts` instead of copying it.

- [ ] **Step 2: Make the suite run both** — the same `IMPLEMENTATIONS` shape as Task 7 Step 2, with `invokeFunction("escalateToHuman", …)` and `invokeEdge("escalate-to-human", …)`; Base44-only blocks for `connections:` cases.

- [ ] **Step 3: Add the Edge-only cases**

```ts
describe("Edge escalate-to-human — what only it does", () => {
  const handoff = { reason: "complex_case", summary: "רוצה לדבר עם דורית", name: "דנה", phone: "0501234567", agent: "support_agent" };

  it("writes the hand-off to Supabase and the sheet, and nothing to Base44", async () => {
    const r = await invokeEdge("escalate-to-human", handoff);
    expect(r.json).toMatchObject({ ok: true, recorded: true });
    expect(r.leads[0]).toMatchObject({ source: "escalation", status: "escalated", escalation_reason: "complex_case", handled_by_agent: "support_agent" });
    expect(r.sheetRows[0]).toMatchObject({ tab: "Events" });
    expect(r.sheetRows[0].row[1]).toBe("conversation_escalation");
    expect(r.callsTo("base44")).toEqual([]);
  });

  it("still answers with the contact details when the sheet fails", async () => {
    const r = await invokeEdge("escalate-to-human", handoff, { failGoogle: "sheets" });
    expect(r.json).toMatchObject({ ok: true, notified: true });
    expect(r.json.warnings).toContain("sheet_append_failed");
  });
});
```

- [ ] **Step 4: Run and see the Edge half fail** — `npx vitest run <the escalate suite>`; Expected: Edge cases FAIL, `Could not resolve … escalate-to-human/handler.ts`.

- [ ] **Step 5: Write `index.ts` (`Deno.serve(handler)`) and `handler.ts`** — transcribe Base44's `export default async function(req)` with the Task 7 replacement table, and:
  - `base44.entities.Lead.create({...})` → `insertRow('leads', { …the same fields…, consent_at: consentAt || null, channel: safeChannel, campaign: safeCampaign })`; `leadId = typeof row.id === 'string' ? row.id : null`.
  - `mirrorLeadToSupabase(…)` → removed.
  - `appendEventRow(base44, row)` → `appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, row)`.
  - `const log = createLog('escalate-to-human')`.

- [ ] **Step 6: `supabase/config.toml`** — `[functions.escalate-to-human]` with `verify_jwt = false`.

- [ ] **Step 7: Run until both halves pass** — same rule as Task 7 Step 8.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/escalate-to-human supabase/config.toml tests/integration
git commit -m "escalate-to-human on Supabase Edge"
```

---

### Task 9: `log-support-chat`

**Files:**
- Create: `supabase/functions/log-support-chat/handler.ts`, `supabase/functions/log-support-chat/index.ts`
- Modify: `supabase/config.toml`; the `logSupportChat` integration suite (`grep -rl '"logSupportChat"' tests/integration`) to `describe.each` over both

**Interfaces:**
- Produces: `handler(req)`, answering what Base44 `logSupportChat` answers: `{ ok: true, rid, sheet }`, `400 { error: 'אין מה לרשום', rid }`, `{ ok: true, rid, sheet: 'נכשל', warnings }`, `500 { error, rid }`.

- [ ] **Step 1: Write `handler.ts` — it is short enough to write out:**

```ts
/**
 * A support or procedures chat, logged to the sheet's Support tab. The Edge
 * twin of base44/functions/logSupportChat — same input, same redaction, same
 * row — through the service account instead of a connector.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning } from '../_shared/mail.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import { redact } from './redact.js';

const log = createLog('log-support-chat');
const SHEET_TAB = (Deno.env.get('SHEET_TAB_SUPPORT') || 'Support').trim();
const SHEET_COLUMNS = ['מועד', 'ערוץ', 'טלפון', 'נושא', 'תוצאה', 'הודעות', 'תמלול'];
```

Copy `OUTCOMES`, `CHANNELS` and `normalisePhone` verbatim from `base44/functions/logSupportChat/entry.ts` into `handler.ts`, and `redact` verbatim into `log-support-chat/redact.js` (exported). Then transcribe the Base44 handler with the Task 7 table: the `SHEET_ID` early return becomes `if (!(Deno.env.get('SHEET_ID') || '').trim())`, and `appendEventRow(base44, row)` becomes `appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, row)`. CORS and `OPTIONS` as in Task 7.

- [ ] **Step 2: Suite over both, plus:**

```ts
describe("Edge log-support-chat — what only it does", () => {
  it("appends to the Support tab through the service account", async () => {
    const r = await invokeEdge("log-support-chat", { channel: "site", phone: "0501234567", topic: "שאלה", transcript: "שלום", outcome: "answered", messageCount: 3 });
    expect(r.json).toMatchObject({ ok: true });
    expect(r.sheetRows).toEqual([{ tab: "Support", row: expect.arrayContaining(["site", "'0501234567", "שאלה"]) }]);
  });
});
```

- [ ] **Step 3: Run, see Edge fail; write `index.ts`, `handler.ts`, `redact.js`; `[functions.log-support-chat] verify_jwt = false`; run until both pass.**

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/log-support-chat supabase/config.toml tests/integration
git commit -m "log-support-chat on Supabase Edge"
```

---

### Task 10: Contracts for the new functions

**Files:**
- Modify: `tests/contract/edge-functions.contract.test.ts`
- Modify: `tests/contract/agents.contract.test.ts` (the attendee contract, and `the guards on the no-sign-in functions`)

- [ ] **Step 1: Write the failing contracts (append to `edge-functions.contract.test.ts`)**

```ts
describe("the lead functions on Edge", () => {
  const dir = join(REPO_ROOT, "supabase/functions");
  const sources = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => /\.(ts|js)$/.test(p))
    .map((p) => [p, readFileSync(join(dir, p), "utf8")] as const);

  it("mention no Docs, no Outlook and no Base44 connector", () => {
    for (const [path, src] of sources) {
      for (const banned of ["googledocs", "graph.microsoft.com", "connectors.", "createClientFromRequest"]) {
        expect(src.includes(banned), `${path} mentions ${banned}`).toBe(false);
      }
    }
  });

  it("are each registered without JWT verification, as submit-claim is", () => {
    const toml = readFileSync(join(REPO_ROOT, "supabase/config.toml"), "utf8");
    for (const fn of ["submit-claim", "submit-lead", "escalate-to-human", "log-support-chat"]) {
      expect(toml).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt = false`));
    }
  });

  it("ask Google for exactly two scopes", () => {
    const google = readFileSync(join(dir, "_shared/google.ts"), "utf8");
    const scopes = [...google.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g)].map((m) => m[1]);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
  });
});
```

In `agents.contract.test.ts`, extend the attendee contract (`grep -n "CALENDAR_ATTENDEES" tests/contract/agents.contract.test.ts`) so it also reads `supabase/functions/submit-lead/lead.js` and asserts its `CALENDAR_ATTENDEES` equals Base44's. Extend `checks the address and the daily limit before every visitor confirmation` with `["submit-lead", read(join(REPO_ROOT, "supabase/functions/submit-lead/handler.ts"))]`.

- [ ] **Step 2: Run** — `npx vitest run tests/contract`. Expected: PASS (Tasks 7–9 already satisfy them; a failure is a finding to fix in the function).

- [ ] **Step 3: Commit**

```bash
git add tests/contract
git commit -m "Contracts: the Edge lead functions use no connector, two scopes, one attendee list"
```

---

### Task 11: The browser can switch to the Edge functions

**Files:**
- Create: `src/config/lead-functions.ts`, `src/services/lead-bodies.ts`, `src/services/supabase/SupabaseSupportService.ts`
- Modify: `src/services/base44/Base44LeadService.ts` (use `lead-bodies`), `src/services/supabase/SupabaseLeadService.ts`, `src/services/index.ts` (support wiring)
- Test: `tests/unit/supabase-lead.test.ts` (extend), `tests/unit/supabase-support.test.ts` (new)

**Interfaces:**
- Produces: `LEAD_FUNCTIONS: "base44" | "supabase"`; `leadBody(lead: Lead): Record<string, unknown>`; `interviewBody(summary: InterviewSummary): Record<string, unknown>`; `escalationBody(request: EscalationRequest): Record<string, unknown>`; `SupabaseLeadService` gains a third constructor parameter `useEdge: boolean`; `SupabaseSupportService implements SupportPort` with `constructor(client: SupabaseFunctionsClient, fallback: SupportPort)`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/supabase-lead.test.ts`, add:

```ts
describe("SupabaseLeadService — with the Edge lead functions switched on", () => {
  const lead = { name: "דנה", phone: "0501234567", source: "consultation" as const, topic: "פנסיה" };

  it("sends a lead to submit-lead with the body Base44 would have had", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, rid: "r1" }, error: null });
    const rest = { submitLead: vi.fn(), submitInterview: vi.fn(), requestConsultationEvent: vi.fn(), submitClaim: vi.fn() };
    const svc = new SupabaseLeadService({ functions: { invoke } }, rest, true);
    await svc.submitLead(lead);
    expect(invoke).toHaveBeenCalledWith("submit-lead", { body: leadBody(lead) });
    expect(rest.submitLead).not.toHaveBeenCalled();
  });

  it("sends an interview to submit-lead as a complete stage", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const svc = new SupabaseLeadService({ functions: { invoke } }, {} as never, true);
    await svc.submitInterview({ name: "דנה", phone: "0501234567", track: "pension" });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ source: "interview", stage: "complete", track: "pension" });
  });

  it("stays on Base44 when switched off", async () => {
    const invoke = vi.fn();
    const rest = { submitLead: vi.fn().mockResolvedValue({ ok: true }), submitInterview: vi.fn(), requestConsultationEvent: vi.fn(), submitClaim: vi.fn() };
    await new SupabaseLeadService({ functions: { invoke } }, rest, false).submitLead(lead);
    expect(invoke).not.toHaveBeenCalled();
    expect(rest.submitLead).toHaveBeenCalled();
  });

  it("throws with the function's message and rid when submit-lead refuses", async () => {
    const res = new Response(JSON.stringify({ error: "נדרשים שם וטלפון", rid: "ab12" }), { status: 400 });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "non-2xx", context: res } });
    await expect(new SupabaseLeadService({ functions: { invoke } }, {} as never, true).submitLead(lead))
      .rejects.toThrow("submit-lead failed: נדרשים שם וטלפון (rid ab12)");
  });
});
```

Create `tests/unit/supabase-support.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SupabaseSupportService } from "@/services/supabase/SupabaseSupportService";
import { escalationBody } from "@/services/lead-bodies";

const request = { reason: "complex_case", summary: "רוצה לדבר עם דורית", name: "דנה", phone: "0501234567" };

describe("SupabaseSupportService", () => {
  it("hands off through escalate-to-human with the body Base44 would have had", async () => {
    const receipt = { ok: true, contact: { phoneDisplay: "050" }, acknowledgement: "x", warnings: [] };
    const invoke = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const svc = new SupabaseSupportService({ functions: { invoke } }, { escalate: vi.fn() });
    expect(await svc.escalate(request)).toEqual(receipt);
    expect(invoke).toHaveBeenCalledWith("escalate-to-human", { body: escalationBody(request) });
  });

  it("never rejects: a failure becomes the direct channels, as the Base44 adapter does", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "down" } });
    const out = await new SupabaseSupportService({ functions: { invoke } }, { escalate: vi.fn() }).escalate(request);
    expect(out.ok).toBe(false);
    expect(out.contact).toBeTruthy();
    expect(out.warnings).toContain("escalation_call_failed");
  });
});
```

- [ ] **Step 2: Run them and see them fail** — `npx vitest run tests/unit/supabase-lead.test.ts tests/unit/supabase-support.test.ts`; Expected: FAIL (no `lead-bodies`, no third parameter, no `SupabaseSupportService`).

- [ ] **Step 3: Write `src/config/lead-functions.ts`**

```ts
/**
 * Who answers the site's lead forms, interviews and hand-offs.
 *
 * Opt-in while the Edge functions are being proven, the same convention as
 * `VITE_UPLOAD_PROVIDER`. Set `VITE_LEAD_FUNCTIONS=supabase` to switch; unset
 * it to switch back to Base44's functions, which stay deployed as the rollback.
 */
export type LeadFunctions = "base44" | "supabase";

export const LEAD_FUNCTIONS: LeadFunctions =
  import.meta.env.VITE_LEAD_FUNCTIONS === "supabase" ? "supabase" : "base44";
```

- [ ] **Step 4: Write `src/services/lead-bodies.ts`** — move the three object literals out of `Base44LeadService.submitLead`, `Base44LeadService.submitInterview` and `Base44SupportService.escalate`, unchanged, into `leadBody(lead)`, `interviewBody(summary)` and `escalationBody(request)`; make the Base44 adapters call them (`invokeFunction(this.client, "submitLead", leadBody(lead))`, and so on).

- [ ] **Step 5: Change `SupabaseLeadService`**

```ts
  constructor(
    private readonly client: SupabaseFunctionsClient,
    private readonly rest: LeadPort,
    private readonly useEdge: boolean = false,
  ) {}

  submitLead(lead: Lead): Promise<SubmissionReceipt> {
    return this.useEdge ? this.edge("submit-lead", leadBody(lead)) : this.rest.submitLead(lead);
  }

  submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    return this.useEdge ? this.edge("submit-lead", interviewBody(summary)) : this.rest.submitInterview(summary);
  }

  private async edge(name: string, body: Record<string, unknown>): Promise<SubmissionReceipt> {
    const { data, error } = await this.client.functions.invoke(name, { body });
    if (error) throw await functionFailure(name, error);
    return (data as SubmissionReceipt | null) ?? { ok: true };
  }
```

Rename `claimFailure(error)` to `functionFailure(name, error)` with message `` `${name} failed: …` ``, and make `submitClaim` call `functionFailure("submit-claim", error)` (its existing test's text is unchanged). Leave `requestConsultationEvent` delegating to `rest` — it has no caller (spec).

- [ ] **Step 6: Write `src/services/supabase/SupabaseSupportService.ts`**

```ts
import type { EscalationReceipt, EscalationRequest, SupportPort } from "../ports";
import { escalationBody } from "../lead-bodies";
import type { SupabaseFunctionsClient } from "./SupabaseLeadService";
import { FALLBACK_CONTACT } from "../base44/Base44SupportService";

/**
 * The hand-off, on the `escalate-to-human` Edge Function. Like the Base44
 * adapter it never rejects: the visitor has just been told a person will call.
 */
export class SupabaseSupportService implements SupportPort {
  constructor(
    private readonly client: SupabaseFunctionsClient,
    private readonly fallback: SupportPort,
  ) {}

  async escalate(request: EscalationRequest): Promise<EscalationReceipt> {
    const failed = (warning: string): EscalationReceipt => ({
      ok: false,
      contact: FALLBACK_CONTACT,
      acknowledgement: "אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.",
      warnings: [warning],
    });
    try {
      const { data, error } = await this.client.functions.invoke("escalate-to-human", { body: escalationBody(request) });
      if (error) return failed("escalation_call_failed");
      const receipt = data as EscalationReceipt | null;
      return receipt?.contact ? receipt : failed("no_contact_in_receipt");
    } catch {
      return failed("escalation_call_failed");
    }
  }
}
```

Export `FALLBACK_CONTACT` from `Base44SupportService.ts` (add `export` to its `const`). `fallback` is kept for symmetry with `SupabaseLeadService` and is unused by `escalate`; remove the parameter if the reviewer prefers — then drop it from the test too.

- [ ] **Step 7: Wire it in `src/services/index.ts`**

```ts
import { LEAD_FUNCTIONS } from "@/config/lead-functions";
import { SupabaseSupportService } from "./supabase/SupabaseSupportService";
```
```ts
const leadPort: LeadPort = supabase
  ? new SupabaseLeadService(supabase as unknown as SupabaseFunctionsClient, base44Leads, LEAD_FUNCTIONS === "supabase")
  : base44Leads;

const base44Support = new Base44SupportService(client);
const supportPort: SupportPort =
  supabase && LEAD_FUNCTIONS === "supabase"
    ? new SupabaseSupportService(supabase as unknown as SupabaseFunctionsClient, base44Support)
    : base44Support;
```
and `support: supportPort,` in `services`.

- [ ] **Step 8: Run** — `npx vitest run tests/unit tests/component && npm run typecheck && npm run lint`. Expected: all pass, exit codes 0 (capture `$?` directly).

- [ ] **Step 9: Commit**

```bash
git add src/config/lead-functions.ts src/services tests/unit
git commit -m "Browser: VITE_LEAD_FUNCTIONS switches leads, interviews and hand-offs to Edge"
```

---

### Task 12: Smoke, documents, full verification, PR 1

**Files:**
- Modify: `e2e/api/supabase-live.spec.ts`
- Modify: `docs/base44-exit/00-inventory.md` (§5 and the function table), `tests/test-plan/12-std-integration.md` and `tests/test-plan/03-std-contract.md` (the new suites), `README.md` (the switch, under the claims section's pattern)

- [ ] **Step 1: Add the smoke cases** next to the `submit-claim` one, the same shape:

```ts
    test("submit-lead answers an empty request with what it could do", async () => {
      const res = await supabase.post("/functions/v1/submit-lead", { data: {} });
      const body = await res.json();
      expect(res.status(), `submit-lead: ${JSON.stringify(body)}`).toBe(400);
      expect(body.ready, "submit-lead cannot reach Google — set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CALENDAR_ID").toMatchObject({ google: true });
      expect(body.ready).toMatchObject({ db: true, mailer: true });
    });

    test("log-support-chat refuses an empty log", async () => {
      const res = await supabase.post("/functions/v1/log-support-chat", { data: {} });
      expect([200, 400]).toContain(res.status());
    });
```

(`log-support-chat` answers `200 { sheet: 'לא מוגדר' }` without `SHEET_ID`, `400` with it and an empty body — both mean the function is deployed and reachable.)

- [ ] **Step 2: Update the documents** — inventory §5: the Google connectors are replaced by the service account; Outlook and Docs dropped; the function table shows `submitLead`, `escalateToHuman`, `logSupportChat` as "Edge, forwarders pending". README: one paragraph on `VITE_LEAD_FUNCTIONS` and the three function secrets, in the same voice as the `VITE_UPLOAD_PROVIDER` paragraph.

- [ ] **Step 3: Full verification**

```bash
npx vitest run; a=$?; npm run -s lint; b=$?; npm run -s typecheck; c=$?; echo "vitest=$a lint=$b typecheck=$c"
```
Expected: `vitest=0 lint=0 typecheck=0`. Also run Task 1's SQL check once more.

- [ ] **Step 4: Commit, push, open PR 1**

```bash
git add e2e docs tests/test-plan README.md
git commit -m "Smoke and documents for the Edge lead functions"
git push -u origin feat/connectors-off-base44
gh pr create --base main --title "Connectors off Base44, part 1: lead functions on Edge, dark" --body-file <(…)
```
The PR body lists the rollout's step 2 as the post-merge checklist: secrets, sharing, smoke, then `VITE_LEAD_FUNCTIONS=supabase` and the two real test submissions. The migration is applied by hand after merge, as in PR 155.

---

### Task 13: PR 2 — Base44's tool functions forward to Edge

Only after rollout step 2 has passed in production.

**Files:**
- Modify: `base44/functions/submitLead/entry.ts`, `base44/functions/escalateToHuman/entry.ts`, `base44/functions/logSupportChat/entry.ts` (each replaced by a forwarder)
- Test: `tests/integration/forwarders.integration.test.ts` (new); `tests/contract/agents.contract.test.ts` (drop the identical-copy checks that name these three, add the forwarder contract)

**Interfaces:**
- Consumes: the Edge functions' URLs: `${SUPABASE_URL}/functions/v1/<name>`, with `SUPABASE_URL` from the Base44 function's own env (already set for the mirror).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

const env = { SUPABASE_URL: "https://stub.supabase.co", MAILER_URL: "x", MAILER_TOKEN: "x" };
const FORWARDERS = [
  ["submitLead", "submit-lead"],
  ["escalateToHuman", "escalate-to-human"],
  ["logSupportChat", "log-support-chat"],
] as const;

describe.each(FORWARDERS)("Base44 %s forwards to Edge %s", (fn, edge) => {
  it("posts the body and the user-agent, and returns the Edge answer unchanged", async () => {
    const r = await invokeFunction(fn, { name: "דנה", phone: "0501234567" }, {
      env,
      headers: { "user-agent": "Mozilla/5.0 (iPhone)" },
      fetchResponses: { [`/functions/v1/${edge}`]: { status: 400, body: { error: "נדרשים שם וטלפון", rid: "e1" } } },
    });
    const call = r.callsTo(`/functions/v1/${edge}`)[0];
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ name: "דנה", phone: "0501234567" });
    expect(call.headers["user-agent"]).toBe("Mozilla/5.0 (iPhone)");
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "נדרשים שם וטלפון", rid: "e1" });
  });

  it("answers in JSON, not a crash, when Edge cannot be reached", async () => {
    const r = await invokeFunction(fn, { name: "דנה", phone: "0501234567" }, { env, fetchStatus: 599 });
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: expect.any(String) });
  });
});
```

If `invokeFunction` lacks `headers` or `fetchResponses`, add them to `tests/helpers/base44-function.ts`: `headers` merged into the `Request`, and `fetchResponses` a map from URL fragment to `{ status, body }` checked before the default answer.

- [ ] **Step 2: Run, see it fail** — Expected: FAIL; the Base44 functions still do the work themselves.

- [ ] **Step 3: Replace each of the three `entry.ts` files with the forwarder**, changing only `EDGE` and `FN`:

```js
/**
 * A forwarder. The Base44 chat agents can only call Base44 functions, so this
 * one stays as their tool until the agents move (Phase 3). The work is done by
 * the Supabase Edge Function EDGE; this passes the request through and the
 * answer back. See docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md.
 */
const FN = 'submitLead';
const EDGE = 'submit-lead';

function log(level, event, fields) {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields }));
}

export default async function (req) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  if (!url) {
    log('error', 'forward.unconfigured', {});
    return Response.json({ error: 'השירות אינו זמין כרגע. אפשר לפנות לדורית ישירות.' }, { status: 503 });
  }
  const body = await req.text();
  try {
    const res = await fetch(`${url}/functions/v1/${EDGE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': req.headers.get('user-agent') || '' },
      body,
      signal: AbortSignal.timeout(25000),
    });
    const answer = await res.json().catch(() => ({ error: 'תשובה לא תקינה מהשרת.' }));
    return Response.json(answer, { status: res.status });
  } catch (e) {
    log('error', 'forward.failed', { err: String(e?.message ?? e).slice(0, 200) });
    return Response.json({ error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Update the contracts** — in `agents.contract.test.ts`, the identical-copy checks (`appendEventRow`, `CALENDARS`, mailbox lists, `redact`, guards, mirror) stop listing these three Base44 files and list their Edge homes instead where one exists. Add:

```ts
  it("leaves the agents' three tools as forwarders only", () => {
    for (const fn of ["submitLead", "escalateToHuman", "logSupportChat"]) {
      const src = read(join(REPO_ROOT, `base44/functions/${fn}/entry.ts`));
      for (const banned of ["entities.", "connectors.", "sendMail", "MAILER_URL"]) {
        expect(src.includes(banned), `${fn} still does work itself (${banned})`).toBe(false);
      }
      expect(src).toMatch(/\/functions\/v1\/[a-z-]+/);
    }
  });
```

- [ ] **Step 5: Run everything** — `npx vitest run; npm run -s lint; npm run -s typecheck` with real exit codes. The Base44 halves of the Task 7–9 suites now exercise forwarders: move each `describe.each` back to Edge-only and delete the Base44-only blocks, since the Base44 implementation no longer exists.

- [ ] **Step 6: Commit, push, PR 2** — the body's checklist is rollout step 3: publish to Base44, one test chat interview, one hand-off from the support agent, then two weeks before revoking the Base44 connector authorisations.

---

## Self-Review

1. **Spec coverage:** credentials and `google.ts` → Task 2; invitation → Tasks 3, 5, 7; calendar/sheet → Task 4; `meetings.lead_id` → Task 1; `submit-lead` with the open-interview lookup → Task 7; `escalate-to-human` → Task 8; `log-support-chat` → Task 9; browser switch → Task 11; CI (`config.toml` only) → Tasks 7–9; smoke → Task 12; contracts → Task 10; forwarders → Task 13; rollout and rollback → Tasks 12–13 PR checklists. `createConsultationEvent`, `upsertContact`, `contentAdmin` untouched — no task, by design.
2. **Placeholders:** the transcription steps (7.6, 8.5, 9.1) name every replacement in a table and every new block in full; the verbatim moves name each declaration. No "TBD".
3. **Types:** `createCalendarEvent` returns `start`/`end` as `Date`, consumed by `buildInvitation` as `Date`. `appendSheetRow(tab, columnCount, row)` in Tasks 4, 7, 8, 9. `oversizedField(body, limits = FIELD_LIMITS)` changed in Task 7 and used by Task 7 only. `SupabaseLeadService(client, rest, useEdge)` in Task 11 and `index.ts`.
4. **Review Focus:** all five lines have their pinning test in the named task.
