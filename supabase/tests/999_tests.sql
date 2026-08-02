-- MeatScentinel — 999 Behavioural tests
-- Verifies that the confirmed requirements actually hold, rather than
-- assuming they do because the migrations ran. Local test harness only.

\set ON_ERROR_STOP on
\pset pager off

create or replace function t_ok(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

create or replace function t_raises(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'FAIL  % (expected an error, none raised)', p_label;
  exception
    when others then
      if sqlerrm like 'FAIL %' then raise; end if;
      raise notice 'PASS  % [%]', p_label, left(sqlerrm, 60);
  end;
end $$;

create or replace function t_as(p_uuid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uuid::text, ''), false);
end $$;


-- ============================================================
-- FIXTURES
-- ============================================================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'insp1@example.org'),
  ('22222222-2222-2222-2222-222222222222', 'insp2@example.org'),
  ('33333333-3333-3333-3333-333333333333', 'admin1@example.org'),
  ('44444444-4444-4444-4444-444444444444', 'admin2@example.org'),
  ('55555555-5555-5555-5555-555555555555', 'gone@example.org');

insert into accounts (id, user_id, email, display_name, role, is_active) values
  ('11111111-1111-1111-1111-111111111111','INSP-001','insp1@example.org','Inspector One','inspector',true),
  ('22222222-2222-2222-2222-222222222222','INSP-002','insp2@example.org','Inspector Two','inspector',true),
  ('33333333-3333-3333-3333-333333333333','ADMN-001','admin1@example.org','Admin One','administrator',true),
  ('44444444-4444-4444-4444-444444444444','ADMN-002','admin2@example.org','Admin Two','administrator',true),
  ('55555555-5555-5555-5555-555555555555','INSP-099','gone@example.org','Inactive One','inspector',false);


-- ============================================================
-- DB-01 / DB-02  eager creation and initial status
-- ============================================================

insert into gas_submissions
  (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000001','chicken',12.5,3.1,'Fresh',true, now());

select t_ok('DB-01 first submission creates the parent record',
  exists (select 1 from inspection_records where inspection_id = 'MS-000001'));

select t_ok('DB-01 unpaired record is Pending (classification null)',
  (select final_classification is null from inspection_records where inspection_id='MS-000001'));

select t_ok('DB-02 initial status entry is Open',
  (select status = 'Open' from status_entries where inspection_id='MS-000001'));

select t_ok('DB-02 initial status entry is system-authored',
  (select author_id is null from status_entries where inspection_id='MS-000001'));


-- ============================================================
-- TABLE 3  fusion matrix, all six rows
-- ============================================================

-- Row 1: Fresh + Fresh -> Fresh
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000001','Fresh','img/1.jpg', now());
select t_ok('Table 3 row 1: Fresh + Fresh = Fresh',
  (select final_classification = 'Fresh' from inspection_records where inspection_id='MS-000001'));

-- Row 2: Fresh + Spoiled -> Spoiled
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000002','pork',10.0,2.0,'Fresh',true, now());
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000002','Spoiled','img/2.jpg', now());
select t_ok('Table 3 row 2: Fresh + Spoiled = Spoiled',
  (select final_classification = 'Spoiled' from inspection_records where inspection_id='MS-000002'));

-- Row 3: Spoiled + Fresh -> Spoiled
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000003','beef',88.0,25.0,'Spoiled',true, now());
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000003','Fresh','img/3.jpg', now());
select t_ok('Table 3 row 3: Spoiled + Fresh = Spoiled',
  (select final_classification = 'Spoiled' from inspection_records where inspection_id='MS-000003'));

-- Row 4: Spoiled + Spoiled -> Spoiled
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000004','chicken',95.0,30.0,'Spoiled',true, now());
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000004','Spoiled','img/4.jpg', now());
select t_ok('Table 3 row 4: Spoiled + Spoiled = Spoiled',
  (select final_classification = 'Spoiled' from inspection_records where inspection_id='MS-000004'));

-- Row 5: invalid gas + any -> For Review  (DB-04: device uploads invalid readings)
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000005','pork',null,null,null,false, now());
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000005','Fresh','img/5.jpg', now());
select t_ok('Table 3 row 5: invalid gas reading = For Review',
  (select final_classification = 'For Review' from inspection_records where inspection_id='MS-000005'));

-- Row 6: any + invalid image -> For Review  (V-18 validation on receipt)
insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000006','beef',9.0,1.5,'Fresh',true, now());
insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000006','Fresh',null, now());
select t_ok('V-18 missing image file fails validation on receipt',
  (select is_valid = false from image_submissions where inspection_id='MS-000006'));
select t_ok('Table 3 row 6: invalid image submission = For Review',
  (select final_classification = 'For Review' from inspection_records where inspection_id='MS-000006'));


-- ============================================================
-- V-05  symmetric pending — image arrives first
-- ============================================================

insert into image_submissions (inspection_id, image_result, image_path, submitted_at)
values ('MS-000007','Spoiled','img/7.jpg', now());
select t_ok('V-05 image-first submission creates a Pending record',
  (select final_classification is null from inspection_records where inspection_id='MS-000007'));
select t_ok('V-05 image-first record has no sample type yet (DB-03)',
  (select sample_type is null from inspection_records_view where inspection_id='MS-000007'));

insert into gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000007','chicken',15.0,4.0,'Fresh',true, now());
select t_ok('V-05 late gas submission completes the pair and fuses',
  (select final_classification = 'Spoiled' from inspection_records where inspection_id='MS-000007'));


-- ============================================================
-- V-04  written once, never recomputed
-- ============================================================

select t_raises('V-04 classification cannot be changed once written',
  $$update inspection_records set final_classification='Fresh' where inspection_id='MS-000002'$$);

select t_raises('inspection_id is immutable',
  $$update inspection_records set inspection_id='MS-999999' where inspection_id='MS-000001'$$);

select t_raises('submissions are immutable once received',
  $$update gas_submissions set nh3_ppm=1 where inspection_id='MS-000001'$$);


-- ============================================================
-- APPEND-ONLY HISTORY
-- ============================================================

insert into remarks (inspection_id, author_id, content)
values ('MS-000002','11111111-1111-1111-1111-111111111111','Odour consistent with spoilage.');

select t_raises('remarks cannot be updated',
  $$update remarks set content='changed' where inspection_id='MS-000002'$$);
select t_raises('remarks cannot be deleted',
  $$delete from remarks where inspection_id='MS-000002'$$);
select t_raises('status entries cannot be deleted',
  $$delete from status_entries where inspection_id='MS-000002'$$);


-- ============================================================
-- V-03 / V-02  vocabularies stay separate
-- ============================================================

select t_raises('case status cannot be For Review (V-02)',
  $$insert into status_entries (inspection_id, author_id, status)
    values ('MS-000002','11111111-1111-1111-1111-111111111111','For Review')$$);

insert into status_entries (inspection_id, author_id, status)
values ('MS-000002','11111111-1111-1111-1111-111111111111','Under Review');
select t_ok('V-03 case status advances to Under Review',
  (select current_case_status = 'Under Review'
   from inspection_records_view where inspection_id='MS-000002'));
select t_ok('V-14/V-15 history retains both entries with attribution',
  (select count(*) = 2 from status_entries where inspection_id='MS-000002'));


-- ============================================================
-- U-B  administrator guards
-- ============================================================

select t_as('33333333-3333-3333-3333-333333333333');
select t_raises('U-B administrator cannot deactivate their own account',
  $$update accounts set is_active=false where id='33333333-3333-3333-3333-333333333333'$$);

update accounts set is_active=false where id='44444444-4444-4444-4444-444444444444';
select t_ok('U-B a non-last administrator can be deactivated',
  (select is_active = false from accounts where id='44444444-4444-4444-4444-444444444444'));

select t_as('44444444-4444-4444-4444-444444444444');
select t_raises('U-B the last active administrator cannot be deactivated',
  $$update accounts set is_active=false where id='33333333-3333-3333-3333-333333333333'$$);

update accounts set is_active=true where id='44444444-4444-4444-4444-444444444444';
select t_raises('user id is immutable',
  $$update accounts set user_id='CHANGED' where id='11111111-1111-1111-1111-111111111111'$$);


-- ============================================================
-- AD-01 / V-12b  User ID resolution
-- ============================================================

select t_ok('AD-01 active User ID resolves to the mapped email',
  resolve_login_email('INSP-001') = 'insp1@example.org');
select t_ok('AD-01 resolution is case-insensitive',
  resolve_login_email('insp-001') = 'insp1@example.org');
select t_ok('AD-02 deactivated account does not resolve',
  resolve_login_email('INSP-099') is null);
select t_ok('AD-01 unknown User ID resolves to null',
  resolve_login_email('NOPE-000') is null);


-- ============================================================
-- AD-05  the role boundary, under RLS
-- ============================================================

set role authenticated;

select t_as('11111111-1111-1111-1111-111111111111');
select t_ok('AD-05 inspector can read inspection records',
  (select count(*) > 0 from inspection_records));
select t_ok('AD-05 inspector can read gas submissions',
  (select count(*) > 0 from gas_submissions));
select t_ok('AD-05 inspector sees only their own account row',
  (select count(*) = 1 from accounts));

select t_as('33333333-3333-3333-3333-333333333333');
select t_ok('AD-05 administrator reads NO inspection records',
  (select count(*) = 0 from inspection_records));
select t_ok('AD-05 administrator reads NO gas submissions',
  (select count(*) = 0 from gas_submissions));
select t_ok('AD-05 administrator reads NO image submissions',
  (select count(*) = 0 from image_submissions));
select t_ok('AD-05 administrator reads NO remarks',
  (select count(*) = 0 from remarks));
select t_ok('AD-05 administrator reads NO status entries',
  (select count(*) = 0 from status_entries));
select t_ok('AD-05 administrator reads NOTHING through the records view',
  (select count(*) = 0 from inspection_records_view));
select t_ok('A-01 administrator can read all accounts',
  (select count(*) = 5 from accounts));

select t_raises('V-14 an inspector cannot attribute a remark to someone else',
  $$select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    insert into remarks (inspection_id, author_id, content)
    values ('MS-000003','22222222-2222-2222-2222-222222222222','not mine')$$);


-- ============================================================
-- AD-02  deactivation is immediate
-- ============================================================

select t_as('55555555-5555-5555-5555-555555555555');
select t_ok('AD-02 deactivated inspector reads no inspection records',
  (select count(*) = 0 from inspection_records));
select t_ok('AD-02 deactivated inspector reads no accounts at all',
  (select count(*) = 0 from accounts));

reset role;
select t_as(null);


-- ============================================================
-- V-19  ordering and the pending/paired split
-- ============================================================

select t_ok('V-19 records order newest first',
  (select bool_and(ordered) from (
     select created_at <= lag(created_at) over () as ordered
     from inspection_records_view order by created_at desc
   ) s where ordered is not null));

select t_ok('pairing_state derives from row existence, not a column',
  (select bool_and(
            (pairing_state = 'paired')
            = (has_gas_submission and has_image_submission))
   from inspection_records_view));

select t_ok('every paired record carries a classification',
  (select count(*) = 0 from inspection_records_view
   where pairing_state = 'paired' and final_classification is null));

select t_ok('no pending record carries a classification',
  (select count(*) = 0 from inspection_records_view
   where pairing_state = 'pending' and final_classification is not null));

\echo ''
\echo 'All assertions passed.'
