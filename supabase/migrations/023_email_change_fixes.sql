-- MeatScentinel — 023 Email change and password change fixes
--
-- 1. Changing the email (and the password) re-checked the current password
--    by signing in again. With login verification (010) that new sign-in is
--    a NEW, unverified session, so the portal signed the user out in the
--    middle of the change. The password is now checked here instead, inside
--    the session the user already verified.
-- 2. The profile page's "Cancel email change" called
--    cancel_my_pending_email_change(), which no migration created.
-- 3. The new address is checked on the server too: format, not the current
--    address, and not already used by another account.
--
-- Apply after 022_inspection_claims.sql. Uses pgcrypto's crypt(), which
-- Supabase installs in the "extensions" schema.

begin;

-- Checks the signed-in user's current password without starting a new
-- session. 5 wrong tries per 15 minutes, then a wait.
create or replace function public.verify_my_password(p_password text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if public.current_account_role() is null then
    raise exception 'Sign in again to continue' using errcode = '42501';
  end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null or p_password is null or p_password = '' then
    return false;
  end if;
  if v_hash = extensions.crypt(p_password, v_hash) then
    return true;
  end if;
  if not public.auth_throttle_hit('password-check:' || auth.uid()::text, 5, 900) then
    raise exception 'Too many wrong passwords. Wait 15 minutes and try again.' using errcode = '54000';
  end if;
  return false;
end;
$$;

revoke all on function public.verify_my_password(text) from public, anon;
grant execute on function public.verify_my_password(text) to authenticated;

-- Everything that must be true before the confirmation emails are sent.
-- Returns null when the change may go ahead, otherwise the message to show.
create or replace function public.prepare_email_change(p_password text, p_new_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_new_email, ''))); v_current text;
begin
  if public.current_account_role() is null then
    raise exception 'Sign in again to continue' using errcode = '42501';
  end if;
  if v_email = '' then return 'Enter the new email address.'; end if;
  if length(v_email) > 254 then return 'That email address is too long.'; end if;
  if v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
     or v_email ~ '\.\.' or v_email ~ '^\.' or v_email ~ '\.@' then
    return 'Enter a valid email address, for example name@gmail.com.';
  end if;

  select lower(email) into v_current from auth.users where id = auth.uid();
  if v_email = v_current then return 'That is already your current email address.'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> auth.uid())
     or exists (select 1 from public.accounts where lower(email) = v_email and id <> auth.uid()) then
    return 'That email address is already used by another account.';
  end if;

  if not public.verify_my_password(p_password) then
    return 'Your current password is not correct.';
  end if;
  return null;
end;
$$;

revoke all on function public.prepare_email_change(text, text) from public, anon;
grant execute on function public.prepare_email_change(text, text) to authenticated;

-- Cancels a requested email change that has not been confirmed yet. The
-- links already sent stop working.
create or replace function public.cancel_my_pending_email_change()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_account_role() is null then
    raise exception 'Sign in again to continue' using errcode = '42501';
  end if;
  update auth.users
     set email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         email_change_confirm_status = 0,
         email_change_sent_at = null
   where id = auth.uid();
end;
$$;

revoke all on function public.cancel_my_pending_email_change() from public, anon;
grant execute on function public.cancel_my_pending_email_change() to authenticated;

commit;
