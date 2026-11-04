-- MeatScentinel — tests for 020_inspection_assignments.sql
-- Scratch database: 000 stubs, vault/storage/auth.jwt stand-ins, a
-- service_role role, migrations 001-014 and 016-020 (015 needs pg_cron).
-- Lines marked "ERR expected" must fail. Everything else must succeed.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001','i1@t.local'),('eeeeeeee-0000-0000-0000-000000000002','i2@t.local'),
  ('eeeeeeee-0000-0000-0000-000000000003','a1@t.local'),('eeeeeeee-0000-0000-0000-000000000004','i3@t.local');
insert into accounts (id, user_id, email, display_name, role, is_active) values
  ('eeeeeeee-0000-0000-0000-000000000001','INSP-G01','i1@t.local','Gina Inspector','inspector',true),
  ('eeeeeeee-0000-0000-0000-000000000002','INSP-G02','i2@t.local','Gabe Inspector','inspector',true),
  ('eeeeeeee-0000-0000-0000-000000000003','ADMN-G01','a1@t.local','Gail Admin','administrator',true),
  ('eeeeeeee-0000-0000-0000-000000000004','INSP-G03','i3@t.local','Gone Inspector','inspector',false);
insert into verified_sessions (session_id, account_id, expires_at) values
  ('ffffffff-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001', now()+interval '1 hour'),
  ('ffffffff-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000003', now()+interval '1 hour');
insert into inspection_records (inspection_id) values ('GAS-ASSIGN-01');

-- ===== Inspector cannot assign =====
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000001"}',false);
set role authenticated;
select 'inspector assigns: ERR expected'; select assign_inspection('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000001');
select 'inspector writes table directly: ERR expected';
insert into inspection_assignments (inspection_id, inspector_id) values ('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000001');
reset role;

-- ===== Administrator assigns =====
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000003"}',false);
set role authenticated;
select 'assign inactive inspector: ERR expected'; select assign_inspection('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000004');
select 'assign an administrator: ERR expected'; select assign_inspection('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000003');
select 'unknown inspection: ERR expected'; select assign_inspection('NOPE-0001','eeeeeeee-0000-0000-0000-000000000001');
select 'admin assigns Gina:'; select assign_inspection('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000001');
select 'same again is a no-op:'; select assign_inspection('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000001');
select 'view shows (expect Gina Inspector):', inspector_name, assigned_by_name from inspection_assignments_view;
reset role;
select 'queued email for Gina (expect assignment_received pending):', recipient_user_id, event_type, status
  from inspection_notifications order by created_at;

-- ===== Pairing: gas then mobile =====
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
  values ('GAS-ASSIGN-01','pork',1,1,'Fresh',true,now());
select 'after gas only (expect pending, no classification):', pairing_state, final_classification
  from inspection_records_view where inspection_id='GAS-ASSIGN-01';
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
  values ('GAS-ASSIGN-01','Spoiled','GAS-ASSIGN-01/photo.jpg',now());
select 'after mobile (expect paired + classified):', pairing_state, final_classification, current_case_status
  from inspection_records_view where inspection_id='GAS-ASSIGN-01';
select 'emails to Gina (expect gas_received, image_received, classification_ready):',
  string_agg(event_type, ',' order by created_at) from inspection_notifications
  where recipient_user_id='INSP-G01' and event_type <> 'assignment_received';

-- ===== Gina's own remark is not emailed back to her =====
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000001"}',false);
set role authenticated;
insert into remarks (inspection_id, author_id, content) values ('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000001','Checked.');
select 'inspector sees assignment:', count(*) from inspection_assignments;
reset role;
select 'remark emails (expect 0):', count(*) from inspection_notifications where event_type='remark_added';

-- ===== Worker can claim a direct inspection email =====
select 'worker claims (expect INSP-G01 assignment_received):', recipient_user_id, event_type
  from claim_inspection_notification();

-- ===== Reassign to Gabe, then unassign =====
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000003"}',false);
set role authenticated;
select 'reassign to Gabe:'; select assign_inspection('GAS-ASSIGN-01','eeeeeeee-0000-0000-0000-000000000002');
select 'unassign:'; select assign_inspection('GAS-ASSIGN-01',null);
select 'history (expect assigned,reassigned,unassigned):', string_agg(action, ',' order by event_id) from inspection_assignment_events;
select 'events are append-only: ERR expected'; delete from inspection_assignment_events;
reset role;
select 'Gina pending emails now skipped as no longer assigned (expect >0):',
  count(*) from inspection_notifications n
  where recipient_user_id='INSP-G01' and status='pending'
    and notification_skip_reason(recipient_id, category, null, event_type, inspection_id) = 'Inspector is no longer assigned';
select 'Gabe emails (expect assignment_received,assignment_removed):',
  string_agg(event_type, ',' order by created_at) from inspection_notifications where recipient_user_id='INSP-G02';
