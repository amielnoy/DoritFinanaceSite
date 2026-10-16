-- An unconfirmed sign-up proves nothing about who holds the address, so it
-- must not receive an invitation's membership. invite-user then fails to make
-- an account for the address (it exists) and answers its existing 409.
-- my_email(), and through it my_enquiries() and my_snapshot(), already require
-- a confirmed address (20261006000000_personal_area.sql).
create or replace function public.invitee_for(p_email text)
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
     and u.email_confirmed_at is not null
   limit 1
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so the revoke names them.
revoke execute on function public.invitee_for(text) from public, anon, authenticated;
grant execute on function public.invitee_for(text) to service_role;
