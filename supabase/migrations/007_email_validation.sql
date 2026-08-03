-- MeatScentinel — 007 Email validation and synchronisation
--
-- Two problems this fixes.
--
-- 1. The profile page wrote the new address to accounts.email straight away,
--    but Supabase only changes the auth email once the confirmation link is
--    clicked. Between those two moments the mapping disagreed with itself:
--    resolve_login_email returned the new address while auth still held the
--    old one, so the account could not sign in at all.
--
-- 2. accounts.email had no format constraint. Anything at all could be
--    stored, including text that never had a chance of receiving a recovery
--    link.


-- ============================================================
-- EMAIL FORMAT
-- ============================================================
-- Deliberately not an attempt at full RFC 5322 — that regex is famously
-- unreadable and rejects almost nothing extra in practice. This covers the
-- shape of a deliverable address and rules out whitespace, angle brackets,
-- quotes, and control characters.

alter table accounts
  add constraint email_format check (
    email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and length(email) <= 254
    and email !~ '[[:space:]<>"''\\;()]'
  );


-- ============================================================
-- SYNCHRONISE THE AUTH EMAIL INTO ACCOUNTS
-- ============================================================
-- auth.users.email changes only when Supabase has confirmed the new address.
-- Mirroring it from here means accounts.email is never ahead of what auth
-- actually accepts, so the User ID mapping cannot point at an address that
-- will not authenticate.

create or replace function sync_account_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update accounts
       set email = new.email
     where id = new.id
       and email is distinct from new.email;
  end if;
  return new;
end;
$$;

create trigger auth_user_email_synced
  after update of email on auth.users
  for each row execute function sync_account_email();


-- ============================================================
-- BLOCK DIRECT EMAIL EDITS FROM THE PROFILE PAGE
-- ============================================================
-- The account holder requests an email change through Supabase Auth, which
-- sends a confirmation link. The trigger above applies it here once that
-- link is used. Writing accounts.email directly would reintroduce the
-- mismatch, so it is refused.
--
-- Administrators are exempt: they set the address at account creation, and
-- correcting a typo on an account whose holder cannot receive mail is
-- exactly the situation A-04 exists for.

create or replace function guard_account_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email
     and auth.uid() = new.id
     and not is_administrator() then
    raise exception
      'Email changes are confirmed by the link sent to the new address.';
  end if;
  return new;
end;
$$;

create trigger accounts_email_change_guard
  before update on accounts
  for each row execute function guard_account_email_change();


-- ============================================================
-- NOTE ON EXISTING DATA
-- ============================================================
-- If this migration fails on the email_format constraint, an existing row
-- holds an address that does not pass. Find them with:
--
--   select id, user_id, email from accounts
--   where email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
--
-- Correct those rows, then run this migration again.
