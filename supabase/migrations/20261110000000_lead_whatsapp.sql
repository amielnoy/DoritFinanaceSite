-- One-click WhatsApp to a lead (feature 3).
--
-- agency_profiles.lead_whatsapp_template: the message a member opens in
-- WhatsApp, with {name}, {agent} and {topic} filled in the browser
-- (src/lib/lead-whatsapp.ts, whose DEFAULT_LEAD_WHATSAPP_TEMPLATE equals the
-- default below). The Owner edits it on /admin/agency under
-- agency_profiles_update_owner, like the agency's other details; members read
-- it under agency_profiles_read_member_or_admin.
--
-- log_lead_whatsapp: "נשלחה הודעת וואטסאפ" in the lead's activity log. Only
-- the fact is kept — not the number, not the text.

alter table public.agency_profiles
  add column lead_whatsapp_template text not null
    default 'היי {name}, כאן {agent} — קיבלתי את הפנייה שלך בנושא {topic}, מתי נוח לדבר?'
    check (char_length(btrim(lead_whatsapp_template)) between 1 and 500);

-- Whoever may see the lead, as for a note (add_lead_note).
create function public.log_lead_whatsapp(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_see_lead(p_lead_id)
     or exists (select 1 from public.leads l where l.id = p_lead_id and l.anonymized_at is not null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.lead_events (lead_id, actor_id, kind) values (p_lead_id, auth.uid(), 'whatsapp');
end;
$$;

revoke execute on function public.log_lead_whatsapp(uuid) from public, anon, authenticated;
grant execute on function public.log_lead_whatsapp(uuid) to authenticated;
