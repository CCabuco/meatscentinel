-- MeatScentinel — tests for 023_email_change_fixes.sql (run after tests/020).
-- Local stand-ins: auth.users gets encrypted_password/email_change columns,
-- and extensions.crypt wraps pgcrypto.
\set ON_ERROR_STOP 0
\pset tuples_only on
update auth.users set encrypted_password = crypt('Secret#123', gen_salt('bf')), email_change = 'pending@t.local'
  where id = 'eeeeeeee-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000001"}',false);
set role authenticated;
select 'right password (expect t):', verify_my_password('Secret#123');
select 'wrong password (expect f):', verify_my_password('nope');
select 'empty email:', prepare_email_change('Secret#123', '');
select 'bad format:', prepare_email_change('Secret#123', 'gina@@gmail');
select 'double dot:', prepare_email_change('Secret#123', 'gina..x@gmail.com');
select 'same as current (any case):', prepare_email_change('Secret#123', 'I1@T.LOCAL');
select 'taken by Gabe:', prepare_email_change('Secret#123', 'i2@t.local');
select 'wrong password:', prepare_email_change('bad', 'gina.new@gmail.com');
select 'all good (expect <ok>):', coalesce(prepare_email_change('Secret#123', ' Gina.New@Gmail.com '), '<ok>');
select 'cancel pending:'; select cancel_my_pending_email_change();
reset role;
select 'email_change after cancel (expect []):', '[' || email_change || ']' from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"session_id":"00000000-0000-0000-0000-000000000000"}',false);
set role authenticated;
select 'unverified session: ERR expected'; select verify_my_password('Secret#123');
reset role;
