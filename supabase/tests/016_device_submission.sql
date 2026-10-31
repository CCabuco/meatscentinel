-- MeatScentinel — tests for 016_device_submission.sql
-- Run on a scratch database after 001-005 + 016 (see tests/000_local_test_stubs.sql).
-- Lines marked "error expected" must fail.
\set ON_ERROR_STOP 0
\pset tuples_only on
select 'created?', public.submit_device_inspection('11111111-1111-1111-1111-111111111111','kiosk-001','a1b2c3d4-0000-0000-0000-000000000001','chicken',12.5,2.1,'Fresh',true,now(),15,1.2,0.4);
select 'replay=duplicate?', public.submit_device_inspection('11111111-1111-1111-1111-111111111111','kiosk-001','a1b2c3d4-0000-0000-0000-000000000001','chicken',12.5,2.1,'Fresh',true,now(),15,1.2,0.4);
select 'other submission same inspection=conflict?', public.submit_device_inspection('22222222-2222-2222-2222-222222222222','kiosk-001','a1b2c3d4-0000-0000-0000-000000000001','chicken',99,9,'Spoiled',true,now());
select 'reused id other inspection -> error expected:'; select public.submit_device_inspection('11111111-1111-1111-1111-111111111111','kiosk-001','a1b2c3d4-0000-0000-0000-000000000099','beef',1,1,'Fresh',true,now());
select 'invalid reading created?', public.submit_device_inspection('33333333-3333-3333-3333-333333333333','kiosk-001','a1b2c3d4-0000-0000-0000-000000000002','pork',null,null,null,false,now() + interval '2 days',3,null,null);
select 'parent + Open status:', (select count(*) from inspection_records), (select string_agg(status::text, ',') from status_entries);
select 'columns:', inspection_id, device_id, reading_count, clock_reliable, is_valid from gas_submissions order by 2,1;
-- fusion still fires: add image rows
insert into image_submissions(inspection_id,image_result,image_path,is_valid,submitted_at,received_at) values ('a1b2c3d4-0000-0000-0000-000000000001','Fresh','demo/1.jpg',true,now(),now());
insert into image_submissions(inspection_id,image_result,image_path,is_valid,submitted_at,received_at) values ('a1b2c3d4-0000-0000-0000-000000000002','Fresh','demo/2.jpg',true,now(),now());
select 'fusion:', inspection_id, final_classification from inspection_records order by 2;
select 'ledger delete -> error expected:'; delete from device_submissions;
select 'gas update -> error expected:'; update gas_submissions set nh3_ppm=0;
set role authenticated;
select 'authenticated execute -> error expected:'; select public.submit_device_inspection('44444444-4444-4444-4444-444444444444','x','abcdef-1','beef',1,1,'Fresh',true,now());
select 'authenticated read ledger -> error expected:'; select * from device_submissions;
reset role;
set role anon;
select 'anon execute -> error expected:'; select public.submit_device_inspection('44444444-4444-4444-4444-444444444444','x','abcdef-1','beef',1,1,'Fresh',true,now());
reset role;
