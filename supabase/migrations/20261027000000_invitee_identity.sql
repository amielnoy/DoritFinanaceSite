-- Invitations resolve an address against Auth, not the profile's historical
-- copy. A changed address must never give its former account a membership.
-- Keep the existing requirement that the account has an application profile.
create function public.invitee_for(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
    join public.profiles p on p.id = u.id
   where lower(u.email) = nullif(lower(btrim(p_email)), '')
   limit 1
$$;

revoke execute on function public.invitee_for(text) from public, anon, authenticated;
grant execute on function public.invitee_for(text) to service_role;
