-- MeatScentinel — tests for 022_inspection_claims.sql (run after tests/020).
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into inspection_records (inspection_id) values ('GAS-CLAIM-01');
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000001"}',false);
set role authenticated;
select 'Gina claims (ok):'; select claim_inspection('GAS-CLAIM-01');
select 'Gina claims again: ERR expected'; select claim_inspection('GAS-CLAIM-01');
select 'unknown inspection: ERR expected'; select claim_inspection('NOPE-0001');
reset role;
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000003"}',false);
set role authenticated;
select 'admin claims: ERR expected'; select claim_inspection('GAS-CLAIM-01');
select 'admin reassigns to Gabe (ok):'; select assign_inspection('GAS-CLAIM-01','eeeeeeee-0000-0000-0000-000000000002');
reset role;
select 'events (expect claimed,reassigned):', string_agg(action, ',' order by event_id) from inspection_assignment_events where inspection_id='GAS-CLAIM-01';
select 'activity (expect inspection_claimed first):', string_agg(action, ',' order by id) from inspector_activity where inspection_id='GAS-CLAIM-01';
select 'emails to Gina for her own claim (expect 0 assignment_received):', count(*) from inspection_notifications
  where inspection_id='GAS-CLAIM-01' and recipient_user_id='INSP-G01' and event_type='assignment_received';
