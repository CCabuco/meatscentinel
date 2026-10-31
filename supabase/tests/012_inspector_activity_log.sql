-- Database owner connection, after migration 012. All fixtures roll back.
begin;

create function pg_temp.assert_activity(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
end;
$$;
create function pg_temp.activity_rejected(statement text, expected_state text default '42501')
returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when others then
  if sqlstate = expected_state then return true; end if;
  raise;
end;
$$;

do $$
declare
  inspector uuid := gen_random_uuid();
  administrator uuid := gen_random_uuid();
  inactive uuid := gen_random_uuid();
  inspector_session uuid := gen_random_uuid();
  admin_session uuid := gen_random_uuid();
  inactive_session uuid := gen_random_uuid();
  view_event uuid := gen_random_uuid();
  record_id text := 'TEST-' || left(gen_random_uuid()::text, 8);
begin
  insert into auth.users (id, email) values
    (inspector, inspector || '@example.org'), (administrator, administrator || '@example.org'), (inactive, inactive || '@example.org');
  insert into public.accounts (id, user_id, email, display_name, role, is_active) values
    (inspector, 'TEST-' || left(inspector::text, 8), inspector || '@example.org', 'Audit inspector', 'inspector', true),
    (administrator, 'TEST-' || left(administrator::text, 8), administrator || '@example.org', 'Audit administrator', 'administrator', true),
    (inactive, 'TEST-' || left(inactive::text, 8), inactive || '@example.org', 'Inactive inspector', 'inspector', false);
  insert into public.verified_sessions (session_id, account_id, expires_at) values
    (inspector_session, inspector, now() + interval '5 minutes'),
    (admin_session, administrator, now() + interval '5 minutes'),
    (inactive_session, inactive, now() + interval '5 minutes');
  insert into public.verified_sessions (session_id, account_id, expires_at)
    values (inspector_session, inspector, now() + interval '6 minutes')
    on conflict (session_id) do update set expires_at = excluded.expires_at;
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where inspector_id = inspector and action = 'signed_in'), 'one login per verified session');
  perform pg_temp.assert_activity((select count(*) = 0 from public.inspector_activity where inspector_id in (administrator, inactive)), 'admin and inactive verification does not create inspector login');

  insert into public.gas_submissions (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
    values (record_id, 'chicken', 1, 1, 'Fresh', true, now());
  insert into public.image_submissions (inspection_id, image_result, image_path, submitted_at)
    values (record_id, 'Fresh', 'audit-test/example.jpg', now());
  perform pg_temp.assert_activity((select count(*) = 0 from public.inspector_activity where inspection_id = record_id), 'system initial status is not inspector activity');

  perform set_config('request.jwt.claims', json_build_object('sub', inspector, 'role', 'authenticated', 'session_id', inspector_session)::text, true);
  execute 'set local role authenticated';
  perform public.record_inspection_activity('record_viewed', record_id, view_event);
  perform public.record_inspection_activity('record_viewed', record_id, view_event);
  perform public.record_inspection_activity('image_viewed', record_id, gen_random_uuid());
  insert into public.remarks (inspection_id, author_id, content) values (record_id, inspector, 'Audit remark');
  insert into public.status_entries (inspection_id, author_id, status) values (record_id, inspector, 'Under Review');
  perform pg_temp.assert_activity((select count(*) = 0 from public.inspector_activity), 'inspectors cannot read activity log');
  perform pg_temp.assert_activity(pg_temp.activity_rejected('insert into public.inspector_activity default values'), 'direct event inserts forbidden');
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.append_inspector_activity(%L, %L, %L)', inspector, inspector, 'signed_in')), 'private writer is not callable');
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.record_inspection_activity(%L, %L, %L)', 'signed_in', record_id, gen_random_uuid()), '22023'), 'client cannot forge completed actions');
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.record_inspection_activity(%L, %L, %L)', 'record_viewed', 'DOES-NOT-EXIST', gen_random_uuid()), '22023'), 'missing inspection rejected');

  perform set_config('request.jwt.claims', json_build_object('sub', administrator, 'role', 'authenticated', 'session_id', admin_session)::text, true);
  perform pg_temp.assert_activity((select count(*) = 5 from public.inspector_activity where inspector_id = inspector), 'administrator can read all five inspector events');
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where event_id = view_event and source = 'app' and actor_id = inspector), 'view deduplicated and correctly attributed');
  perform pg_temp.assert_activity((select details->>'content' = 'Audit remark' and source = 'database' from public.inspector_activity where inspector_id = inspector and action = 'remark_added'), 'remark captured by trigger');
  perform pg_temp.assert_activity((select details->>'before' = 'Open' and details->>'after' = 'Under Review' from public.inspector_activity where inspector_id = inspector and action = 'status_changed'), 'status transition captured');
  perform pg_temp.assert_activity(pg_temp.activity_rejected('update public.inspector_activity set source = ''app'''), 'administrator cannot edit log');
  perform pg_temp.assert_activity(pg_temp.activity_rejected('delete from public.inspector_activity'), 'administrator cannot delete log');
  perform pg_temp.assert_activity(pg_temp.activity_rejected('truncate public.inspector_activity'), 'administrator cannot truncate log');
  update public.accounts set display_name = 'Renamed inspector' where id = inspector;
  perform pg_temp.assert_activity((select actor_id = administrator and details->'changes'->'display_name'->>'before' = 'Audit inspector' from public.inspector_activity where inspector_id = inspector and action = 'account_updated'), 'account changes identify administrator and old name');
  perform pg_temp.assert_activity((select inspector_name = 'Audit inspector' from public.inspector_activity where event_id = view_event), 'past identity snapshot preserved');

  perform set_config('request.jwt.claims', json_build_object('sub', inspector, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.record_inspection_activity(%L, %L, %L)', 'record_viewed', record_id, gen_random_uuid())), 'unverified inspector cannot report views');
  perform set_config('request.jwt.claims', json_build_object('sub', inactive, 'role', 'authenticated', 'session_id', inactive_session)::text, true);
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.record_inspection_activity(%L, %L, %L)', 'record_viewed', record_id, gen_random_uuid())), 'inactive inspector cannot report views');
  perform set_config('request.jwt.claims', json_build_object('sub', administrator, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  perform pg_temp.assert_activity((select count(*) = 0 from public.inspector_activity), 'unverified administrator cannot read log');
  execute 'set local role anon';
  perform pg_temp.assert_activity(pg_temp.activity_rejected('select * from public.inspector_activity'), 'anonymous log reads forbidden');
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.record_inspection_activity(%L, %L, %L)', 'record_viewed', record_id, gen_random_uuid())), 'anonymous view reports forbidden');
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  update auth.users set encrypted_password = 'DO-NOT-LOG-THIS-HASH' where id = inspector;
  update auth.users set email_change = inspector || '-new@example.org' where id = inspector;
  update auth.users set email_change = '' where id = inspector;
  update auth.users set email = inspector || '-confirmed@example.org' where id = inspector;
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where inspector_id = inspector and action = 'password_changed' and actor_id is null and details = '{}'), 'password change recorded without secret or invented actor');
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where inspector_id = inspector and action = 'email_change_requested'), 'pending email request recorded');
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where inspector_id = inspector and action = 'email_change_cancelled'), 'email cancellation recorded');
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where inspector_id = inspector and action = 'account_updated' and details->'changes' ? 'email'), 'confirmed email change recorded');
  perform pg_temp.assert_activity((select count(*) = 0 from public.inspector_activity where inspector_id = inspector and to_jsonb(inspector_activity)::text like '%DO-NOT-LOG-THIS-HASH%'), 'password hash never stored');
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('update public.inspector_activity set actor_name = %L where inspector_id = %L', 'Rewritten', inspector), 'P0001'), 'append-only trigger blocks owner edits');

  perform set_config('request.jwt.claims', json_build_object('sub', inspector, 'role', 'authenticated', 'session_id', inspector_session)::text, true);
  execute 'set local role authenticated';
  perform public.end_inspector_session();
  perform public.end_inspector_session();
  perform pg_temp.assert_activity(public.current_account_role() is null, 'logout revokes app access');
  perform pg_temp.assert_activity(pg_temp.activity_rejected(format('select public.record_inspection_activity(%L, %L, %L)', 'record_viewed', record_id, gen_random_uuid())), 'signed-out session cannot append views');
  execute 'reset role';
  perform pg_temp.assert_activity((select count(*) = 1 from public.inspector_activity where inspector_id = inspector and action = 'signed_out'), 'logout recorded exactly once');
  perform pg_temp.assert_activity((select count(*) = 0 from public.verified_sessions where session_id = inspector_session), 'verified session removed');
end;
$$;

rollback;
select 'PASS: activity capture, attribution, privacy, deduplication, admin-only access, append-only history, and logout revocation; fixtures rolled back' as result;
