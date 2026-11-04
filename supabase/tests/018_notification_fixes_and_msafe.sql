-- MeatScentinel — tests for 018_notification_fixes_and_msafe.sql
-- Scratch database: 000 stubs, vault/storage/auth.jwt stand-ins, 001-005,
-- 007, 010-014, 016, 017, 018. Lines marked "ERR expected" must fail.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001','i1@t.local'),('bbbbbbbb-0000-0000-0000-000000000002','i2@t.local'),('bbbbbbbb-0000-0000-0000-000000000003','a1@t.local');
insert into accounts (id, user_id, email, display_name, role, is_active) values
  ('bbbbbbbb-0000-0000-0000-000000000001','INSP-N01','i1@t.local','Ina Inspector','inspector',true),
  ('bbbbbbbb-0000-0000-0000-000000000002','INSP-N02','i2@t.local','Ike Inspector','inspector',true),
  ('bbbbbbbb-0000-0000-0000-000000000003','ADMN-N01','a1@t.local','Ada Admin','administrator',true);
insert into verified_sessions (session_id, account_id, expires_at) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', now()+interval '1 hour'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002', now()+interval '1 hour'),
  ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000003', now()+interval '1 hour');
insert into inspection_records (inspection_id) values ('MS-NOTIF-0001');

-- MSafe sends two reports
set role anon;
select set_config('request.headers', '{"x-msafe-key":"' || repeat('k',40) || '"}', false);
insert into msafe_reports (msafe_report_id, report_type, submitted_at) values
  ('dddddddd-0000-0000-0000-000000000001','consumer',now()), ('dddddddd-0000-0000-0000-000000000002','supplier',now());
reset role;

-- ===== Bug fix: inspector saves preferences / marks read =====
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"session_id":"cccccccc-0000-0000-0000-000000000001"}',false);
set role authenticated;
select 'inspector saves own preferences (was broken):'; select save_notification_options(false,true,true,true,true,true);
select 'inspector marks read (was broken):'; select mark_notification_read(gen_random_uuid());
reset role;

-- ===== Admin: global settings, assign =====
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"session_id":"cccccccc-0000-0000-0000-000000000003"}',false);
set role authenticated;
select 'admin saves global settings (was broken):'; select save_notification_options(true,true,true,true,true,true);
select 'admin assigns R1 to I1:'; select assign_msafe_report('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',0);
reset role;

-- ===== I2 claims R2 (no self email) =====
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
select set_config('request.jwt.claims','{"session_id":"cccccccc-0000-0000-0000-000000000002"}',false);
set role authenticated;
select 'I2 claims R2:'; select claim_msafe_report('dddddddd-0000-0000-0000-000000000002',0);
reset role;

-- ===== Admin reassigns R1 to I2, then I2 links =====
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"session_id":"cccccccc-0000-0000-0000-000000000003"}',false);
set role authenticated;
select 'reassign R1 to I2:'; select assign_msafe_report('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002',1);
reset role;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
select set_config('request.jwt.claims','{"session_id":"cccccccc-0000-0000-0000-000000000002"}',false);
set role authenticated;
select 'I2 links R1:'; select link_msafe_inspection('dddddddd-0000-0000-0000-000000000001','MS-NOTIF-0001');
select 'I2 sees own notifications:', count(*) from inspection_notifications;
reset role;

select 'queue:', n.recipient_name, n.event_type, n.status, coalesce(n.reason,'-'), (n.msafe_report_id is not null) as msafe
  from inspection_notifications n order by n.created_at;

-- ===== Worker claims (service_role) =====
set role service_role;
select 'worker claims:', recipient_name, event_type, status, sent_to from claim_inspection_notification();
reset role;

select 'scan_id and msafe both null: ERR expected';
insert into inspection_notifications (recipient_id, recipient_user_id, recipient_name, category, event_type, title, message)
  values ('bbbbbbbb-0000-0000-0000-000000000001','x','x','results','x','x','x');
