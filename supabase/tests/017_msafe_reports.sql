-- MeatScentinel — tests for 017_msafe_reports.sql
-- Scratch database after 000 stubs, 001-005, 016, with a stand-in vault:
--   create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
--   insert into vault.decrypted_secrets values ('msafe_key', repeat('k',40));
-- then 017, then this file. Lines marked "ERR expected" must fail.
\set ON_ERROR_STOP 0
\pset tuples_only on
\set R1 '11111111-0000-0000-0000-000000000001'
\set I1 'aaaaaaaa-0000-0000-0000-000000000001'
\set I2 'aaaaaaaa-0000-0000-0000-000000000003'
\set A1 'aaaaaaaa-0000-0000-0000-000000000002'

insert into auth.users (id, email) values (:'I1','i1@t.local'), (:'A1','a1@t.local'), (:'I2','i2@t.local');
insert into accounts (id, user_id, email, display_name, role, is_active) values
  (:'I1','INSP-T01','i1@t.local','Juan Inspector','inspector',true),
  (:'A1','ADMN-T01','a1@t.local','Ana Admin','administrator',true),
  (:'I2','INSP-T02','i2@t.local','Pedro Inspector','inspector',true);
insert into inspection_records (inspection_id) values ('MS-TEST-0001');

-- ===== MSafe server =====
set role anon;
select set_config('request.headers', '{}', false);
select 'no key insert: ERR expected';
insert into msafe_reports (msafe_report_id, report_type, submitted_at) values (:'R1','consumer',now());
select set_config('request.headers', '{"x-msafe-key":"' || repeat('k',40) || '"}', false);
select 'insert with key, meat "Pork", fake received_at:';
insert into msafe_reports (msafe_report_id, report_type, meat_type, confidence, submitted_at, received_at)
  values (:'R1','consumer','Pork',91.5,now(),'2000-01-01');
select 'meat fish: ERR expected';
insert into msafe_reports (msafe_report_id, report_type, meat_type, submitted_at) values (gen_random_uuid(),'consumer','fish',now());
select 'confidence 150: ERR expected';
insert into msafe_reports (msafe_report_id, report_type, confidence, submitted_at) values (gen_random_uuid(),'consumer',150,now());
select 'read reports: ERR expected'; select count(*) from msafe_reports;
select 'update report: ERR expected'; update msafe_reports set meat_type='beef';
select 'read drafts: ERR expected'; select count(*) from msafe_response_drafts;
select 'read internal: ERR expected'; select count(*) from msafe_response_internal;
select 'read assignments: ERR expected'; select count(*) from msafe_report_assignments;
select 'responses before send:', count(*) from msafe_responses;
reset role;

-- ===== Inspector 1 =====
select set_config('request.jwt.claim.sub', :'I1', false);
set role authenticated;
select 'view row:', meat_type, received_at > '2001-01-01', inspector_id is null, latest_status is null from msafe_reports_view;
select 'draft before claim: ERR expected';
select save_msafe_draft(null, :'R1', 'under_review', 'Checking');
select 'assign as inspector: ERR expected';
select assign_msafe_report(:'R1', :'I1', 0);
select 'claim:'; select claim_msafe_report(:'R1', 0);
select 'claim again: ERR expected'; select claim_msafe_report(:'R1', 1);
select 'save draft:', (select save_msafe_draft(null, :'R1', 'investigated', 'Expired stock', null, null, null, 'Owner uncooperative')) is not null;
select 'edit draft:', (select save_msafe_draft((select draft_id from msafe_response_drafts limit 1), :'R1', 'resolved', 'Expired stock found', 'Warning letter', current_date, null, 'Owner uncooperative')) is not null;
select 'bad letter url: ERR expected';
select save_msafe_draft(null, :'R1', 'resolved', 'x', null, null, 'http://x', null);
select 'send:', (select send_msafe_draft((select draft_id from msafe_response_drafts limit 1))) is not null;
select 'drafts left:', count(*) from msafe_response_drafts;
select 'response edit: ERR expected'; update msafe_responses set findings='no';
select 'link bad id: ERR expected'; select link_msafe_inspection(:'R1', 'NOPE-0001');
select 'link:'; select link_msafe_inspection(:'R1', 'MS-TEST-0001');
select 'link again: ERR expected'; select link_msafe_inspection(:'R1', 'MS-TEST-0001');
select 'empty resolved draft send: ERR expected';
select send_msafe_draft(save_msafe_draft(null, :'R1', 'resolved'));
reset role;

-- ===== Inspector 2 (not assigned) =====
select set_config('request.jwt.claim.sub', :'I2', false);
set role authenticated;
select 'I2 sees I1 drafts (0 expected):', count(*) from msafe_response_drafts;
select 'I2 draft on R1: ERR expected'; select save_msafe_draft(null, :'R1', 'under_review');
select 'I2 sees internal notes + real author:', i.internal_notes, n.display_name from msafe_response_internal i join author_names n on n.id = i.author_id;
reset role;

-- ===== Admin =====
select set_config('request.jwt.claim.sub', :'A1', false);
set role authenticated;
select 'admin sees all drafts:', count(*) from msafe_response_drafts;
select 'reassign stale version: ERR expected'; select assign_msafe_report(:'R1', :'I2', 0);
select 'reassign:'; select assign_msafe_report(:'R1', :'I2', (select assignment_version from msafe_reports_view));
select 'admin draft+send:', (select send_msafe_draft(save_msafe_draft(null, :'R1', 'under_review', 'Admin follow-up'))) is not null;
select 'admin edits I1 draft: ERR expected';
select save_msafe_draft((select draft_id from msafe_response_drafts where author_id = :'I1' limit 1), :'R1', 'under_review');
reset role;

-- ===== Draft ownership across reassignment =====
select set_config('request.jwt.claim.sub', :'A1', false);
set role authenticated;
select assign_msafe_report(:'R1', :'I1', (select assignment_version from msafe_reports_view));
reset role;
select set_config('request.jwt.claim.sub', :'I1', false);
set role authenticated;
select 'I1 draft made:', save_msafe_draft(null, :'R1', 'under_review', 'I1 draft') is not null;
reset role;
select set_config('request.jwt.claim.sub', :'A1', false);
set role authenticated;
select 'admin edits I1 draft: ERR expected';
select save_msafe_draft((select draft_id from msafe_response_drafts where author_id = :'I1'), :'R1', 'resolved', 'hijack');
select 'admin sends I1 draft: ERR expected';
select send_msafe_draft((select draft_id from msafe_response_drafts where author_id = :'I1'));
select assign_msafe_report(:'R1', :'I2', (select assignment_version from msafe_reports_view));
reset role;
select set_config('request.jwt.claim.sub', :'I1', false);
set role authenticated;
select 'I1 sends draft after reassignment: ERR expected';
select send_msafe_draft((select draft_id from msafe_response_drafts where author_id = :'I1'));
select 'I1 deletes own draft:'; select delete_msafe_draft((select draft_id from msafe_response_drafts where author_id = :'I1'));
reset role;

-- ===== MSafe reads responses =====
set role anon;
select set_config('request.headers', '{"x-msafe-key":"' || repeat('k',40) || '"}', false);
select 'MSafe sees (expect MeatScentinel Inspector, no notes):', status, inspector_name, findings from msafe_responses order by responded_at;
reset role;

select 'history:', string_agg(action, ',' order by event_id) from msafe_assignment_events;
select 'owner delete report: ERR expected'; delete from msafe_reports;
