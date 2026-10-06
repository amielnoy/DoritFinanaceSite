\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000001','authenticated','authenticated','Ronit@Example.com', now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000002','authenticated','authenticated','other@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000003','authenticated','authenticated','unconfirmed@example.com', null);

insert into public.leads (base44_id, name, phone, email, source, status, summary, profile, track, track_label) values
  ('L-1','רונית','050-1','  ronit@example.COM ','interview','new','סיכום','[["יעד עיקרי","פרישה"]]','pension','פנסיה, גמל והשתלמות'),
  ('L-2','רונית','050-1','ronit@example.com','interview','partial',null,null,'pension','פנסיה, גמל והשתלמות'),
  ('L-3','אחר','050-2','other@example.com','quick','new',null,null,null,null),
  ('L-4','בלי מייל','050-3','','quick','new',null,null,null,null),
  ('L-5','מבקר','050-4','unconfirmed@example.com','quick','new',null,null,null,null);
insert into public.meetings (lead_base44_id, scheduled_at, calendar_status) values
  ('L-1', '2026-10-11 07:00:00+00', 'אירוע נוצר ✓ (outlook, google) — 2026-10-11 10:00');

-- Case and spaces do not matter; another person's row never appears.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.my_enquiries()) <> 2 then raise exception 'ronit should see exactly her two enquiries'; end if;
  if exists (select 1 from public.my_enquiries() where summary is null and completed) then raise exception 'the partial interview must be marked incomplete'; end if;
  if not (select in_calendar from public.my_enquiries() where summary = 'סיכום') then raise exception 'a booked meeting should read as in the calendar'; end if;
end $$;

-- The tables stay closed to her: RLS lets an ordinary user read no lead rows.
do $$ begin
  if (select count(*) from public.leads) <> 0 then raise exception 'an ordinary user read lead rows directly'; end if;
  if (select count(*) from public.meetings) <> 0 then raise exception 'an ordinary user read meeting rows directly'; end if;
end $$;

-- She cannot call the service-role function with someone else's address.
do $$ begin
  begin
    perform * from public.enquiries_for('other@example.com');
    raise exception 'authenticated called enquiries_for';
  exception when insufficient_privilege then null;
  end;
end $$;

-- An unconfirmed address sees nothing.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.my_enquiries()) <> 0 then raise exception 'an unconfirmed address saw enquiries'; end if;
end $$;

-- An anonymous visitor may not call either door.
set local role anon;
do $$ begin
  begin
    perform * from public.my_enquiries();
    raise exception 'anon called my_enquiries';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.enquiries_for('ronit@example.com');
    raise exception 'anon called enquiries_for';
  exception when insufficient_privilege then null;
  end;
end $$;

-- An empty address matches nothing, not the enquiry without an email.
reset role;
do $$ begin
  if (select count(*) from public.enquiries_for('')) <> 0 then raise exception 'an empty address matched'; end if;
  if (select count(*) from public.enquiries_for('   ')) <> 0 then raise exception 'a blank address matched'; end if;
end $$;

rollback;
