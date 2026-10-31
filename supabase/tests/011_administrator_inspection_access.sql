-- Run after migration 011 using a database owner connection.
-- Fixtures, sessions, and test writes are rolled back; no existing rows change.
begin;

create function pg_temp.assert_access(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
end;
$$;

create function pg_temp.write_denied(statement text)
returns boolean language plpgsql as $$
declare affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected = 0;
exception when insufficient_privilege or raise_exception then
  return true;
end;
$$;

do $$
declare
  admin_id uuid := gen_random_uuid();
  inspector_id uuid := gen_random_uuid();
  inactive_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  inspector_session uuid := gen_random_uuid();
  inactive_session uuid := gen_random_uuid();
  record_id text := 'TEST-' || left(gen_random_uuid()::text, 8);
  image_name text := 'permission-test/' || gen_random_uuid()::text || '.jpg';
  other_bucket text := 'permission-test-' || gen_random_uuid()::text;
begin
  insert into auth.users (id, email) values
    (admin_id, admin_id || '@example.org'),
    (inspector_id, inspector_id || '@example.org'),
    (inactive_id, inactive_id || '@example.org');
  insert into public.accounts (id, user_id, email, display_name, role, is_active) values
    (admin_id, 'TEST-' || left(admin_id::text, 8), admin_id || '@example.org', 'Test administrator', 'administrator', true),
    (inspector_id, 'TEST-' || left(inspector_id::text, 8), inspector_id || '@example.org', 'Test inspector', 'inspector', true),
    (inactive_id, 'TEST-' || left(inactive_id::text, 8), inactive_id || '@example.org', 'Test inactive administrator', 'administrator', false);
  insert into public.verified_sessions (session_id, account_id, expires_at) values
    (session_id, admin_id, now() + interval '5 minutes'),
    (inspector_session, inspector_id, now() + interval '5 minutes'),
    (inactive_session, inactive_id, now() + interval '5 minutes');
  insert into public.gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
    values (record_id, 'chicken', 1, 1, 'Fresh', true, now());
  insert into public.image_submissions (inspection_id, image_result, image_path, submitted_at)
    values (record_id, 'Fresh', image_name, now());
  insert into storage.buckets (id, name) values (other_bucket, other_bucket);
  insert into storage.objects (bucket_id, name) values
    ('inspection-images', image_name), (other_bucket, image_name);

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'session_id', session_id)::text, true);
  execute 'set local role authenticated';
  perform pg_temp.assert_access(public.is_administrator(), 'verified administrator role');
  perform pg_temp.assert_access((select count(*) = 1 from public.inspection_records_view where inspection_id = record_id), 'administrator reads records view');
  perform pg_temp.assert_access((select count(*) = 1 from public.gas_submissions where inspection_id = record_id), 'administrator reads gas');
  perform pg_temp.assert_access((select count(*) = 1 from public.image_submissions where inspection_id = record_id), 'administrator reads image result');
  perform pg_temp.assert_access((select count(*) = 1 from storage.objects where name = image_name and bucket_id = 'inspection-images'), 'administrator reads inspection image');
  perform pg_temp.assert_access((select count(*) = 0 from storage.objects where name = image_name and bucket_id = other_bucket), 'other bucket stays private');
  perform pg_temp.assert_access((select count(*) = 3 from public.accounts where id in (admin_id, inspector_id, inactive_id)), 'administrator reads accounts');
  update public.accounts set display_name = 'Updated test inspector' where id = inspector_id;
  perform pg_temp.assert_access((select display_name = 'Updated test inspector' from public.accounts where id = inspector_id), 'administrator still manages accounts');
  insert into public.remarks (inspection_id, author_id, content) values (record_id, admin_id, 'Permission test');
  insert into public.status_entries (inspection_id, author_id, status) values (record_id, admin_id, 'Under Review');
  perform pg_temp.assert_access((select count(*) = 1 from public.remarks where inspection_id = record_id and author_id = admin_id), 'administrator appends and reads own remark');
  perform pg_temp.assert_access((select count(*) = 2 from public.status_entries where inspection_id = record_id), 'administrator reads seeded and appended status');
  perform pg_temp.assert_access(pg_temp.write_denied(format('insert into public.remarks (inspection_id, author_id, content) values (%L, %L, %L)', record_id, inspector_id, 'Spoofed')), 'remark attribution cannot be spoofed');
  perform pg_temp.assert_access(pg_temp.write_denied(format('insert into public.status_entries (inspection_id, author_id, status) values (%L, null, %L)', record_id, 'Open')), 'administrator cannot create system-authored status');
  perform pg_temp.assert_access(pg_temp.write_denied(format('update public.remarks set content = %L where inspection_id = %L', 'Rewritten', record_id)), 'remarks stay append-only');
  perform pg_temp.assert_access(pg_temp.write_denied(format('delete from public.status_entries where inspection_id = %L', record_id)), 'status history cannot be deleted');
  perform pg_temp.assert_access(pg_temp.write_denied(format('update public.inspection_records set final_classification = %L where inspection_id = %L', 'Spoiled', record_id)), 'classification stays write-once');
  perform pg_temp.assert_access(pg_temp.write_denied(format('update public.gas_submissions set nh3_ppm = 999 where inspection_id = %L', record_id)), 'gas submission stays immutable');
  perform pg_temp.assert_access(pg_temp.write_denied(format('update public.image_submissions set image_result = %L where inspection_id = %L', 'Spoiled', record_id)), 'image submission stays immutable');

  perform set_config('request.jwt.claims', json_build_object('sub', inspector_id, 'role', 'authenticated', 'session_id', inspector_session)::text, true);
  perform pg_temp.assert_access((select count(*) = 1 from public.inspection_records_view where inspection_id = record_id), 'inspector still reads records');
  perform pg_temp.assert_access((select count(*) = 1 from public.accounts), 'inspector sees only own account');
  insert into public.remarks (inspection_id, author_id, content) values (record_id, inspector_id, 'Inspector permission test');
  insert into public.status_entries (inspection_id, author_id, status) values (record_id, inspector_id, 'Resolved');
  perform pg_temp.assert_access(pg_temp.write_denied(format('update public.accounts set display_name = %L where id = %L', 'Unauthorized', admin_id)), 'inspector cannot manage administrator');

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  perform pg_temp.assert_access((select count(*) = 0 from public.inspection_records_view), 'unverified administrator cannot read records');
  perform pg_temp.assert_access((select count(*) = 0 from storage.objects where name = image_name), 'unverified administrator cannot read images');
  perform pg_temp.assert_access(pg_temp.write_denied(format('insert into public.remarks (inspection_id, author_id, content) values (%L, %L, %L)', record_id, admin_id, 'Unverified')), 'unverified administrator cannot append');

  perform set_config('request.jwt.claims', json_build_object('sub', inactive_id, 'role', 'authenticated', 'session_id', inactive_session)::text, true);
  perform pg_temp.assert_access((select count(*) = 0 from public.inspection_records_view), 'inactive administrator cannot read records');
  perform pg_temp.assert_access((select count(*) = 0 from storage.objects where name = image_name), 'inactive administrator cannot read images');
  perform pg_temp.assert_access(pg_temp.write_denied(format('insert into public.status_entries (inspection_id, author_id, status) values (%L, %L, %L)', record_id, inactive_id, 'Open')), 'inactive administrator cannot append');
  execute 'reset role';
end;
$$;

rollback;
select 'PASS: administrator inspection access, inspector isolation, session checks, attribution, and immutability; fixtures rolled back' as result;
