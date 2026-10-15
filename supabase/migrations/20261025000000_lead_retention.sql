-- Lead retention, as the privacy policy promises (src/pages/PrivacyPolicy.tsx §7):
--
--   "פנייה שלא הבשילה להתקשרות נשמרת עד 24 חודשים ממועד הקשר האחרון, ומידע
--    הנוגע להתקשרות בפועל נשמר לתקופה הנדרשת על-פי דין ועל-פי הוראות רשות שוק
--    ההון. בתום התקופה המידע נמחק או עובר אנונימיזציה."
--
-- So an enquiry that became an engagement is never touched here — Dorit marks
-- it "client" in /admin/leads, and the period the law sets for it is hers to
-- keep — and every other enquiry is ANONYMIZED 24 months after its last
-- contact (the user's decision of 2026-10-15): the name, phone, email and
-- free text go; the date, source, topic and status stay, so the counts still
-- add up. A contact record (one person per phone) goes when its last
-- sighting is that old, unless a client or a recent enquiry shares the phone.
--
-- Not reached from here, and said so in Architecture.html (N-02): the row in
-- the Google Sheet and the copies already mailed.

-- 1. The status that keeps an enquiry out of this.
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'contacted', 'closed', 'escalated', 'partial', 'client'));

-- 2. When it was anonymized; null for a lead still whole.
alter table public.leads add column anonymized_at timestamptz;

-- 3. The job. The last contact is the latest of the enquiry, its last change
--    (a status change is a contact) and its meeting.
create or replace function public.anonymize_stale_leads(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff constant timestamptz := p_now - interval '24 months';
  n integer;
begin
  delete from public.contacts c
   where coalesce(c.last_seen, c.created_at) < cutoff
     and not exists (
       select 1 from public.leads k
        where k.phone = c.phone
          and (k.status = 'client' or greatest(k.created_at, k.updated_at) >= cutoff)
     );

  with stale as (
    select l.id
      from public.leads l
      left join public.meetings m on m.lead_id = l.id
     where l.status <> 'client'
       and l.anonymized_at is null
       and greatest(l.created_at, l.updated_at, coalesce(m.scheduled_at, l.created_at)) < cutoff
  )
  update public.leads l
     set name = 'נמחק',
         phone = '',
         email = null,
         message = null,
         summary = null,
         profile = null,
         notes = null,
         timing = null,
         campaign = null,
         anonymized_at = p_now
    from stale
   where l.id = stale.id;
  get diagnostics n = row_count;

  -- The meeting's own free text about the person.
  update public.meetings m
     set timing = null, notes = null
    from public.leads l
   where m.lead_id = l.id and l.anonymized_at = p_now;

  return n;
end;
$$;

revoke execute on function public.anonymize_stale_leads(timestamptz) from public, anon, authenticated;

-- 4. Nightly, after the claim documents' purge.
create extension if not exists pg_cron;

select cron.schedule(
  'leads-retention',
  '45 3 * * *',
  $$select public.anonymize_stale_leads()$$
);
