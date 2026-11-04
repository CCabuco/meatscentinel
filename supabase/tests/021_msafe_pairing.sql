-- MeatScentinel — tests for 021_msafe_pairing.sql
-- Run on the scratch database after tests/020 (uses its accounts).
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into inspection_records (inspection_id) values ('GAS-MSAFE-01'),('GAS-MSAFE-02'),('GAS-MSAFE-03');
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at) values
  ('GAS-MSAFE-01','chicken',40,9,'Spoiled',true,now()),('GAS-MSAFE-02','chicken',4,1,'Fresh',true,now()),
  ('GAS-MSAFE-03','pork',4,1,'Fresh',true,now());
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
  values ('GAS-MSAFE-03','Fresh','GAS-MSAFE-03/p.jpg',now());
select set_config('request.headers', '{"x-msafe-key":"' || repeat('k',40) || '"}', false);
set role anon;
insert into msafe_reports (msafe_report_id, report_type, scan_result, photo_url, submitted_at) values
  ('99999999-0000-0000-0000-000000000001','consumer','Spoiled','https://x.example/p.jpg',now()),
  ('99999999-0000-0000-0000-000000000002','consumer','fresh',null,now()),
  ('99999999-0000-0000-0000-000000000003','supplier','Spoiled','https://x.example/q.jpg',now());
reset role;
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"session_id":"ffffffff-0000-0000-0000-000000000003"}',false);
set role authenticated;
select assign_msafe_report(('99999999-0000-0000-0000-00000000000' || n)::uuid, 'eeeeeeee-0000-0000-0000-000000000002'::uuid, 0) from generate_series(1,3) n;
select link_msafe_inspection('99999999-0000-0000-0000-000000000001','GAS-MSAFE-01');
select link_msafe_inspection('99999999-0000-0000-0000-000000000002','GAS-MSAFE-02');
select link_msafe_inspection('99999999-0000-0000-0000-000000000003','GAS-MSAFE-03');
reset role;
select 'expect 01 paired Spoiled/valid -> Spoiled; 02 paired Fresh/no photo -> For Review; 03 keeps its own Fresh -> Fresh:';
select inspection_id, pairing_state, image_result, image_is_valid, final_classification
  from inspection_records_view where inspection_id like 'GAS-MSAFE%' order by 1;
select 'source of 01 (expect msafe + report id):', source, msafe_report_id from image_submissions where inspection_id='GAS-MSAFE-01';
select 'MSafe inspector emails for 01 (expect inspection_linked,image_received,classification_ready):',
  string_agg(event_type, ',' order by created_at) from inspection_notifications where inspection_id='GAS-MSAFE-01';
