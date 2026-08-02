-- MeatScentinel — 000 Local test stubs
-- NOT PART OF THE DEPLOYED SCHEMA.
-- Supabase provides auth.users, auth.uid(), the `anon` and
-- `authenticated` roles, and pgcrypto. This file stands them up on a
-- plain Postgres instance so the migrations can be executed and tested
-- without a Supabase project. Do not run this against Supabase.

create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Test seam: auth.uid() reads a session setting so a test can
-- impersonate any account.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;
