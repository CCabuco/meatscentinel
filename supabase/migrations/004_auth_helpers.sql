-- MeatScentinel — 004 Authentication helpers
-- AD-01: users authenticate with a User ID, but the auth layer is
-- email-based. Something must resolve one to the other before sign-in,
-- which means the resolver is reachable by an unauthenticated caller.
-- This is that resolver, scoped as narrowly as it can be.


-- ============================================================
-- USER ID -> EMAIL RESOLUTION  (AD-01, V-12)
-- ============================================================
-- Returns the mapped email for an active account and nothing else.
-- No display name, no role, no active flag, no existence signal
-- beyond the email itself.
--
-- Deactivated accounts resolve to null, so a deactivated user cannot
-- even reach the password prompt.

create or replace function resolve_login_email(p_user_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from accounts
  where lower(user_id) = lower(trim(p_user_id))
    and is_active = true;
$$;

revoke all on function resolve_login_email(text) from public;
grant execute on function resolve_login_email(text) to anon, authenticated;

-- RATE LIMITING IS NOT IMPLEMENTED HERE.
-- Postgres is the wrong layer for it: a per-caller throttle table
-- would itself need to be writable by anon, which is a worse hole
-- than the one it closes. Apply the limit at the API gateway or edge
-- function in front of this call. Without it, the function is
-- enumerable — an attacker who guesses valid User IDs can harvest the
-- mapped email addresses. The limit is part of the decision, not an
-- optional hardening step.


-- ============================================================
-- PASSWORD RECOVERY  (V-12b)
-- ============================================================
-- The inspector enters their User ID; the system resolves the mapped
-- email and the recovery link is sent there. The resolution uses the
-- same function above; the send is performed by Supabase Auth against
-- the resolved address.
--
-- The email address is never entered on the login or recovery screens.
-- Whether the confirmation message reveals or masks the destination
-- address is a UI decision and is not made here.


-- ============================================================
-- ACCOUNT PROVISIONING  (A-01, A-04, A-06)
-- ============================================================
-- Account creation cannot be done in SQL alone: it requires an
-- auth.users row, which only the Auth admin API can create. The flow
-- is therefore:
--
--   1. An administrator submits the new account from the account list.
--   2. A server-side function, authenticated as that administrator,
--      verifies is_administrator().
--   3. It calls the Auth admin API to create the auth user with the
--      supplied email and initial password. The password policy
--      (D-06) is enforced there and in the client.
--   4. It inserts the matching accounts row with user_id, display
--      name, and role.
--
-- Steps 3 and 4 must succeed or fail together; a created auth user
-- with no accounts row would be able to authenticate and then match
-- no policy at all.
--
-- Password reset for an inspector (A-04) follows the same shape: verify
-- is_administrator(), then call the Auth admin API for that user.
--
-- Deactivation (U-F, AD-02) is two operations:
--   - set accounts.is_active = false, which the guards in 002 check
--     and which makes every policy in 003 fail for that account
--     immediately;
--   - revoke the account's refresh token through the Auth admin API,
--     so the session cannot renew.
-- The first is what makes termination immediate. The second is what
-- stops it coming back.


-- ============================================================
-- ROLE ASSERTION FOR SERVER-SIDE FUNCTIONS
-- ============================================================
-- Server-side account management calls should assert the caller's role
-- through this rather than trusting a client-supplied claim.

create or replace function assert_administrator()
returns void
language plpgsql
stable
as $$
begin
  if not is_administrator() then
    raise exception 'administrator role required';
  end if;
end;
$$;


-- ============================================================
-- FIRST ADMINISTRATOR  (A-06)
-- ============================================================
-- The first administrator is provisioned directly during deployment,
-- not through the application. Create the auth user in the Supabase
-- dashboard, then insert the matching row:
--
--   insert into accounts (id, user_id, email, display_name, role)
--   values (
--     '<auth.users uuid>',
--     '<user id>',
--     '<email>',
--     '<display name>',
--     'administrator'
--   );
--
-- Every administrator after this one is created in-app.
