-- MeatScentinel — 019 Administrators cannot create or promote administrators
--
-- Adviser decision: from the portal, an administrator may only create
-- Meat Inspector accounts. The website no longer offers the choice and
-- the manage-account Edge Function rejects it; this trigger closes the
-- last path, a direct API call by a signed-in user (the 003 grants allow
-- updating the role column).
--
-- Who can still make an administrator: the system owner, from the
-- Supabase SQL editor or dashboard (runs as postgres / service_role).
--
-- Safe to run more than once.

create or replace function public.guard_administrator_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'administrator'
     and (tg_op = 'INSERT' or old.role is distinct from 'administrator')
     and current_user in ('authenticated', 'anon') then
    raise exception 'Administrator accounts can only be created by the system owner'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_administrator_role_guard on public.accounts;
create trigger accounts_administrator_role_guard
  before insert or update of role on public.accounts
  for each row execute function public.guard_administrator_role();
