-- MeatScentinel — 010 Login verification (LV-01 … LV-12)
--
-- A verification code is emailed to the registered address after the
-- password is accepted, and no usable session exists until that code is
-- verified.
--
-- READ THIS BEFORE CHANGING ANYTHING BELOW.
--
-- The code is not enforced by the login page. It cannot be: the
-- publishable key permits auth.signInWithPassword from any browser
-- console, so a login form that "requires" a code is bypassed by one
-- direct call. Enforcement therefore lives where the access boundary
-- already lives — Row Level Security (AD-05).
--
-- The mechanism: login-verify mints the session server-side and records
-- its session_id in verified_sessions. current_account_role() — which
-- every policy in 003 funnels through — now also requires the caller's
-- session_id to appear there. A session obtained any other way resolves
-- to a null role and matches no policy on any table. The password grant
-- still works; it just produces a session that can read nothing.
--
-- LV-01  Codes are six digits, generated with a CSPRNG in the edge
--        function, and only a salted SHA-256 hash is stored. A dump of
--        this table is not a set of working codes.
-- LV-02  Five minutes to expiry, evaluated server-side only.
-- LV-03  Five verification attempts per challenge, then the challenge is
--        consumed. Recovery is to start again with the password.
-- LV-04  Three resends per challenge, 60 seconds apart.
-- LV-05  One live challenge per account; issuing a new one consumes the
--        previous.
-- LV-06  Challenges are bound to the browser that began them by a random
--        client secret, so a code cannot be redeemed from elsewhere.
-- LV-07  is_active is re-checked at verification, not only at password
--        check, so an account deactivated mid-login cannot complete.
-- LV-08  A trusted device skips the code for 7 days. It never skips the
--        password. Opt-in, off by default (D-09).
-- LV-09  Password change, email change, and deactivation revoke every
--        trusted device and consume every live challenge for that
--        account.
-- LV-10  Throttling is per account and per client, in a table only the
--        service role can reach. Postgres was the wrong layer for the
--        resolve_login_email throttle because the table would have had to
--        be anon-writable (see 004); it is the right layer here because
--        only the edge function — service role — ever touches it.
-- LV-11  The response to the credential step is identical whether the
--        User ID exists, the password was wrong, or a code was sent.
--        The code screen is not an enumeration oracle.
-- LV-12  Framing: this supports the authenticity and confidentiality
--        sub-characteristics of ISO/IEC 25010. It is NOT multi-factor
--        authentication in the NIST SP 800-63B sense — email is not an
--        approved out-of-band channel there, because a mailbox is
--        another account rather than a possessed device, and this
--        system's password recovery already targets that same mailbox.
--        Do not claim MFA compliance in the paper.


-- ============================================================
-- CHALLENGES
-- ============================================================

create table if not exists login_challenges (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id) on delete cascade,
  code_hash           text not null,
  code_salt           text not null,
  client_secret_hash  text not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  attempts            smallint not null default 0,
  resends             smallint not null default 0,
  last_sent_at        timestamptz not null default now(),
  consumed_at         timestamptz
);

create index if not exists login_challenges_live_idx
  on login_challenges (account_id) where consumed_at is null;
create index if not exists login_challenges_expiry_idx
  on login_challenges (expires_at);


-- ============================================================
-- TRUSTED DEVICES  (LV-08)
-- ============================================================
-- Only the code step is skipped. The password is always required, which
-- is what keeps this a remembered second factor rather than a long-lived
-- session.
--
-- The token is held in the browser's localStorage, because the edge
-- functions are on a different origin from the application and an
-- httpOnly cookie cannot be shared between them. It is therefore
-- readable by script if the application is ever XSS'd. That is accepted
-- on the basis that the token alone grants nothing without the password,
-- is bound to one account, expires in seven days, and is revoked by
-- LV-09. It is recorded here rather than left implicit.

create table if not exists trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  token_hash    text not null unique,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);

create index if not exists trusted_devices_account_idx
  on trusted_devices (account_id) where revoked_at is null;


-- ============================================================
-- VERIFIED SESSIONS
-- ============================================================
-- The record of which sessions completed the code step. Written only by
-- login-verify.

create table if not exists verified_sessions (
  session_id  uuid primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists verified_sessions_account_idx
  on verified_sessions (account_id);
create index if not exists verified_sessions_expiry_idx
  on verified_sessions (expires_at);


-- ============================================================
-- THROTTLE  (LV-10)
-- ============================================================

create table if not exists auth_throttle (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);


-- ============================================================
-- NO POLICIES, NO GRANTS
-- ============================================================
-- RLS is enabled and deliberately left without a single policy, so anon
-- and authenticated match nothing on any of these tables. The service
-- role bypasses RLS and is the only caller. This is the same shape as
-- revoking resolve_login_email from anon in 008: the table exists for a
-- server-side function and for nothing else.

alter table login_challenges  enable row level security;
alter table trusted_devices   enable row level security;
alter table verified_sessions enable row level security;
alter table auth_throttle     enable row level security;

alter table login_challenges  force row level security;
alter table trusted_devices   force row level security;
alter table verified_sessions force row level security;
alter table auth_throttle     force row level security;

revoke all on login_challenges  from anon, authenticated;
revoke all on trusted_devices   from anon, authenticated;
revoke all on verified_sessions from anon, authenticated;
revoke all on auth_throttle     from anon, authenticated;


-- ============================================================
-- THE GATE
-- ============================================================
-- session_id is a standard claim in a Supabase access token and survives
-- token refresh, so a verified session stays verified until it ends.

create or replace function is_session_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from verified_sessions vs
    where vs.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and vs.expires_at > now()
  );
$$;

-- current_account_role() is redefined, not replaced by a new helper.
-- Every policy in 003 already calls it, and adding the requirement here
-- means no policy can be written later that forgets the check. This is
-- the same reasoning that put is_active in this function rather than in
-- each policy (AD-02).
--
-- Returns null for: unauthenticated, missing, deactivated, OR unverified.
-- Every policy fails closed on all four.

create or replace function current_account_role()
returns account_role
language sql
stable
security definer
set search_path = public
as $$
  select a.role
  from accounts a
  where a.id = auth.uid()
    and a.is_active = true
    and is_session_verified();
$$;


-- ============================================================
-- SESSION STATE FOR THE CLIENT
-- ============================================================
-- AuthContext previously inferred deactivation from "signed in but the
-- accounts row returned zero rows". With this migration that inference
-- becomes wrong: a recovery-link session and an email-change session are
-- both unverified, both read zero rows, and neither is deactivated.
-- Signing the user out on those would break password recovery entirely.
--
-- So the client stops inferring and asks. security definer, so it
-- answers regardless of policy.

create or replace function login_session_state()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'anonymous'
    when not exists (
      select 1 from accounts where id = auth.uid() and is_active = true
    ) then 'deactivated'
    when not is_session_verified() then 'unverified'
    else 'active'
  end;
$$;

revoke all on function login_session_state() from public;
grant execute on function login_session_state() to authenticated;


-- ============================================================
-- REVOCATION  (LV-09)
-- ============================================================
-- A password or email change invalidates every remembered device. Both
-- are credential events: whoever performed them should not leave a
-- previously trusted browser able to skip verification.

create or replace function revoke_devices_on_credential_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     or new.email is distinct from old.email then

    update trusted_devices
       set revoked_at = now()
     where account_id = new.id and revoked_at is null;

    update login_challenges
       set consumed_at = now()
     where account_id = new.id and consumed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists auth_users_revoke_devices on auth.users;
create trigger auth_users_revoke_devices
  after update on auth.users
  for each row execute function revoke_devices_on_credential_change();


-- Deactivation (U-F, AD-02). is_active already fails every policy
-- immediately; this additionally clears the artifacts so reactivation
-- does not silently restore a device trusted before the deactivation.

create or replace function revoke_devices_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active = true and new.is_active = false then
    update trusted_devices
       set revoked_at = now()
     where account_id = new.id and revoked_at is null;

    update login_challenges
       set consumed_at = now()
     where account_id = new.id and consumed_at is null;

    delete from verified_sessions where account_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_revoke_devices on accounts;
create trigger accounts_revoke_devices
  after update on accounts
  for each row execute function revoke_devices_on_deactivation();


-- ============================================================
-- HOUSEKEEPING
-- ============================================================
-- Called opportunistically by login-begin. No pg_cron dependency: these
-- tables are small and the cost of a bounded delete on each login start
-- is lower than the cost of another moving part at deployment.

create or replace function purge_expired_login_artifacts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from login_challenges
   where expires_at < now() - interval '1 day';

  delete from verified_sessions
   where expires_at < now();

  delete from trusted_devices
   where expires_at < now()
      or revoked_at < now() - interval '30 days';

  delete from auth_throttle
   where window_start < now() - interval '1 day';
end;
$$;


-- Throttle counter. Returns true when the caller is within the limit.
-- Fixed window rather than sliding: an attacker can get at most 2x the
-- limit across a window boundary, which is acceptable at these numbers
-- and avoids storing a row per attempt.

create or replace function auth_throttle_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into auth_throttle (bucket_key, window_start, count)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    set count = case
          when auth_throttle.window_start < now() - make_interval(secs => p_window_seconds)
          then 1
          else auth_throttle.count + 1
        end,
        window_start = case
          when auth_throttle.window_start < now() - make_interval(secs => p_window_seconds)
          then now()
          else auth_throttle.window_start
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function auth_throttle_hit(text, integer, integer) from public;
revoke all on function purge_expired_login_artifacts() from public;
revoke all on function is_session_verified() from public;
grant execute on function is_session_verified() to authenticated;
