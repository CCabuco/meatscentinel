-- MeatScentinel — 020 Administrators assign inspectors to inspection records
--
-- Until now an inspection only had an inspector through a linked mobile
-- report (CheckMeat, retired) or a linked MSafe report. This adds a direct
-- assignment: an administrator picks an inspector for any inspection
-- record (gas reading, mobile submission or paired record).
--
--   * One assigned inspector per inspection. Administrators assign,
--     reassign and unassign through assign_inspection(). No direct writes.
--   * Every change is kept in inspection_assignment_events (append-only).
--   * The assigned inspector gets an email (same queue and email worker as
--     the other notifications) when they are assigned or unassigned, and
--     afterwards for remarks, status changes, new submissions and the
--     final classification once gas and mobile are paired.
--
-- After running this, redeploy the send-inspection-notifications Edge
-- Function (it passes the inspection ID to the delivery re-check).
--
-- Apply after 019_no_admin_promotion.sql.

begin;

-- ==================================================================
-- 1. Tables
-- ==================================================================
create table public.inspection_assignments (
  inspection_id text primary key
                references public.inspection_records (inspection_id) on delete restrict,
  inspector_id  uuid not null references public.accounts (id),
  assigned_by   uuid references public.accounts (id),
  assigned_at   timestamptz not null default now()
);

create index inspection_assignments_inspector_idx on public.inspection_assignments (inspector_id);

create table public.inspection_assignment_events (
  event_id              bigint generated always as identity primary key,
  inspection_id         text not null references public.inspection_records (inspection_id) on delete restrict,
  action                text not null check (action in ('assigned', 'reassigned', 'unassigned')),
  actor_id              uuid references public.accounts (id),
  inspector_id          uuid references public.accounts (id),
  previous_inspector_id uuid references public.accounts (id),
  occurred_at           timestamptz not null default clock_timestamp()
);

create index inspection_assignment_events_idx
  on public.inspection_assignment_events (inspection_id, occurred_at);

create trigger inspection_assignment_events_append_only
  before update or delete on public.inspection_assignment_events
  for each row execute function public.guard_inspector_activity();
create trigger inspection_assignment_events_no_truncate
  before truncate on public.inspection_assignment_events
  for each statement execute function public.guard_inspector_activity();

alter table public.inspection_assignments enable row level security;
alter table public.inspection_assignments force row level security;
alter table public.inspection_assignment_events enable row level security;
alter table public.inspection_assignment_events force row level security;

revoke all on public.inspection_assignments, public.inspection_assignment_events
  from public, anon, authenticated;
revoke all on sequence public.inspection_assignment_events_event_id_seq from public, anon, authenticated;
grant select on public.inspection_assignments, public.inspection_assignment_events to authenticated;

-- All staff can see who is assigned (same as MSafe reports).
create policy inspection_assignments_staff_read on public.inspection_assignments
  for select to authenticated using (msafe_private.staff_role() is not null);
create policy inspection_assignment_events_staff_read on public.inspection_assignment_events
  for select to authenticated using (msafe_private.staff_role() is not null);

-- Names come from author_names, which every signed-in user can read.
create view public.inspection_assignments_view with (security_invoker = true) as
select a.inspection_id, a.inspector_id, n.display_name as inspector_name,
       a.assigned_by, b.display_name as assigned_by_name, a.assigned_at
from public.inspection_assignments a
left join public.author_names n on n.id = a.inspector_id
left join public.author_names b on b.id = a.assigned_by;

grant select on public.inspection_assignments_view to authenticated;

-- ==================================================================
-- 2. Notifications for direct inspection assignments
-- ==================================================================
-- A notification now comes from a mobile report, an MSafe report, or
-- (new) straight from an inspection record.
alter table public.inspection_notifications
  drop constraint inspection_notifications_source,
  add constraint inspection_notifications_source check (
    num_nonnulls(scan_id, msafe_report_id) <= 1
    and (scan_id is not null or msafe_report_id is not null or inspection_id is not null)
  );

-- Same checks as before, plus: a direct inspection assignment counts as
-- "still assigned". The 4-argument version stays for older callers.
create function public.notification_skip_reason(p_recipient uuid, p_category text, p_scan uuid,
  p_event text, p_inspection text)
returns text language plpgsql security definer set search_path = '' as $$
declare a public.accounts; prefs jsonb; settings jsonb;
begin
  select * into a from public.accounts where id = p_recipient;
  if not found or not a.is_active or a.role <> 'inspector' then return 'Inspector account is inactive or unavailable'; end if;
  if nullif(trim(a.email), '') is null then return 'Inspector has no registered email'; end if;
  select to_jsonb(p) into prefs from public.notification_preferences p where account_id = p_recipient;
  select to_jsonb(s) into settings from public.notification_settings s where id;
  if coalesce((prefs->>'email_enabled')::boolean, true) = false then return 'Inspector turned off email notifications'; end if;
  if coalesce((prefs->>p_category)::boolean, true) = false then return 'Inspector turned off this notification category'; end if;
  if coalesce((settings->>p_category)::boolean, false) = false then return 'Administrator disabled this notification category'; end if;
  if p_event <> 'assignment_removed'
     and not exists (select 1 from public.customer_report_assignments where scan_id = p_scan and inspector_id = p_recipient)
     and not exists (select 1 from public.msafe_report_assignments where msafe_report_id = p_scan and inspector_id = p_recipient)
     and not exists (select 1 from public.inspection_assignments where inspection_id = p_inspection and inspector_id = p_recipient)
  then return 'Inspector is no longer assigned'; end if;
  return null;
end;
$$;

create or replace function public.notification_skip_reason(p_recipient uuid, p_category text, p_scan uuid, p_event text)
returns text language sql security definer set search_path = '' as $$
  select public.notification_skip_reason(p_recipient, p_category, p_scan, p_event, null::text);
$$;

create or replace function public.claim_inspection_notification()
returns setof public.inspection_notifications language plpgsql security definer set search_path = '' as $$
declare item public.inspection_notifications; skip_reason text;
begin
  update public.inspection_notifications set status = 'unknown', reason = 'Worker stopped before delivery could be confirmed',
    lease_token = null, lease_until = null where status = 'processing' and lease_until < now();
  if not exists (select 1 from public.notification_settings where id and email_enabled) then return; end if;
  for item in select * from public.inspection_notifications where status = 'pending' and next_attempt_at <= now()
    order by created_at, id limit 50 for update skip locked loop
    skip_reason := public.notification_skip_reason(item.recipient_id, item.category,
      coalesce(item.scan_id, item.msafe_report_id), item.event_type, item.inspection_id);
    if item.created_at < now() - interval '7 days' then skip_reason := 'Notification expired after seven days'; end if;
    if skip_reason is not null then
      update public.inspection_notifications set status = 'skipped', reason = skip_reason where id = item.id;
      continue;
    end if;
    return query update public.inspection_notifications set status = 'processing', attempts = attempts + 1,
      lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes', reason = null,
      sent_to = (select email from public.accounts where id = item.recipient_id)
      where id = item.id returning *;
    return;
  end loop;
end;
$$;

create or replace function public.retry_inspection_notification(p_id uuid, p_allow_unknown boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.inspection_notifications; skip_reason text;
begin
  if public.is_administrator() is not true then raise exception 'Administrator required' using errcode = '42501'; end if;
  select * into item from public.inspection_notifications where id = p_id for update;
  if not found or item.status not in ('failed', 'unknown') then raise exception 'Only failed or uncertain messages can be retried'; end if;
  if item.status = 'unknown' and p_allow_unknown is not true then raise exception 'Confirm possible duplicate email before retrying'; end if;
  skip_reason := public.notification_skip_reason(item.recipient_id, item.category,
    coalesce(item.scan_id, item.msafe_report_id), item.event_type, item.inspection_id);
  if skip_reason is not null then raise exception '%', skip_reason; end if;
  if item.created_at < now() - interval '7 days' then raise exception 'This notification has expired'; end if;
  update public.inspection_notifications set status = 'pending', next_attempt_at = now(), reason = null where id = p_id;
  insert into public.notification_management_history (actor_id, action, details)
    values (auth.uid(), 'email_retry_requested', jsonb_build_object('notification_id', p_id, 'previous_status', item.status));
end;
$$;

create function public.enqueue_direct_inspection_notification(p_recipient uuid, p_inspection text,
  p_category text, p_event text, p_title text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare skip_reason text;
begin
  if p_recipient is null or p_inspection is null then return; end if;
  skip_reason := public.notification_skip_reason(p_recipient, p_category, null, p_event, p_inspection);
  insert into public.inspection_notifications (recipient_id, recipient_user_id, recipient_name, actor_id,
    inspection_id, category, event_type, title, message, status, reason)
  select a.id, a.user_id, a.display_name, (select id from public.accounts where id = auth.uid()),
    p_inspection, p_category, p_event, p_title, p_message,
    case when skip_reason is null then 'pending' else 'skipped' end, skip_reason
  from public.accounts a where a.id = p_recipient;
end;
$$;

-- Record changes (remarks, status, gas or mobile received, classification
-- after pairing) now also reach the directly assigned inspector. They are
-- not emailed about their own remark or status change.
create or replace function public.notify_inspection_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assignment public.customer_report_assignments; v_direct uuid;
  category text; event text; title text; message text;
begin
  if tg_table_name = 'customer_reports' then
    if row(new.meat_type, new.classification, new.confidence_score, new.scanned_at)
      is not distinct from row(old.meat_type, old.classification, old.confidence_score, old.scanned_at) then return new; end if;
    select * into assignment from public.customer_report_assignments where scan_id = new.scan_id;
    category := 'results'; event := 'mobile_updated'; title := 'An assigned mobile report was updated';
    message := 'CheckMeat report details changed during refresh. Open the report to review the latest information.';
  else
    select * into assignment from public.customer_report_assignments where inspection_id = new.inspection_id;
    if tg_table_name = 'remarks' then
      category := 'remarks'; event := 'remark_added'; title := 'New remark on your assigned inspection';
      message := 'A remark was added. Sign in to read the inspection history.';
    elsif tg_table_name = 'status_entries' then
      category := 'statuses'; event := 'status_changed'; title := 'Your inspection case status was updated';
      message := 'The case status is now ' || new.status::text || '.';
    elsif tg_table_name = 'inspection_records' then
      if row(new.final_classification, new.classified_at) is not distinct from row(old.final_classification, old.classified_at) then return new; end if;
      category := 'results'; event := 'classification_ready'; title := 'Gas and mobile results are paired';
      message := 'Both submissions were received and paired. The final classification is '
        || coalesce(new.final_classification::text, 'Pending') || '.';
    else
      category := 'results'; event := case when tg_table_name = 'gas_submissions' then 'gas_received' else 'image_received' end;
      title := 'New submission for your assigned inspection';
      message := case when tg_table_name = 'gas_submissions' then 'Gas readings were received.' else 'A mobile (image) submission was received.' end;
    end if;
  end if;

  perform public.enqueue_inspection_notification(assignment.inspector_id, assignment.scan_id, assignment.inspection_id,
    category, event, title, message);

  if tg_table_name <> 'customer_reports' then
    select inspector_id into v_direct from public.inspection_assignments where inspection_id = new.inspection_id;
    if v_direct is not null
       and v_direct is distinct from assignment.inspector_id
       and v_direct is distinct from auth.uid() then
      perform public.enqueue_direct_inspection_notification(v_direct, new.inspection_id, category, event, title, message);
    end if;
  end if;
  return new;
end;
$$;

-- ==================================================================
-- 3. Assign / reassign / unassign (administrators only)
-- ==================================================================
create function public.assign_inspection(p_inspection_id text, p_inspector_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text := trim(p_inspection_id); v_old uuid; v_account public.accounts;
begin
  if msafe_private.staff_role() is distinct from 'administrator' then
    raise exception 'Only an administrator can assign inspectors' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inspection_records where inspection_id = v_id) then
    raise exception 'Inspection not found' using errcode = '22023';
  end if;

  select inspector_id into v_old from public.inspection_assignments where inspection_id = v_id for update;
  if v_old is not distinct from p_inspector_id then return; end if;

  if p_inspector_id is null then
    delete from public.inspection_assignments where inspection_id = v_id;
    insert into public.inspection_assignment_events (inspection_id, action, actor_id, previous_inspector_id)
      values (v_id, 'unassigned', auth.uid(), v_old);
  else
    select * into v_account from public.accounts where id = p_inspector_id;
    if not found or v_account.role <> 'inspector' or not v_account.is_active then
      raise exception 'Choose an active Meat Inspector account' using errcode = '22023';
    end if;
    insert into public.inspection_assignments (inspection_id, inspector_id, assigned_by, assigned_at)
      values (v_id, p_inspector_id, auth.uid(), now())
      on conflict (inspection_id) do update
        set inspector_id = excluded.inspector_id, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
    insert into public.inspection_assignment_events (inspection_id, action, actor_id, inspector_id, previous_inspector_id)
      values (v_id, case when v_old is null then 'assigned' else 'reassigned' end, auth.uid(), p_inspector_id, v_old);
    perform public.enqueue_direct_inspection_notification(p_inspector_id, v_id, 'assignments',
      'assignment_received', 'An inspection has been assigned to you',
      'An administrator assigned inspection ' || v_id || ' to you. Open MeatScentinel to review the gas readings, mobile result and case status.');
  end if;

  if v_old is not null then
    perform public.enqueue_direct_inspection_notification(v_old, v_id, 'assignments',
      'assignment_removed', 'Your inspection assignment has changed',
      'Inspection ' || v_id || ' has been reassigned. You are no longer the assigned inspector.');
  end if;
end;
$$;

revoke all on function public.assign_inspection(text, uuid) from public, anon;
grant execute on function public.assign_inspection(text, uuid) to authenticated;
revoke all on function public.enqueue_direct_inspection_notification(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notification_skip_reason(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.notification_skip_reason(uuid, text, uuid, text, text) to service_role;
revoke all on function public.notification_skip_reason(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.notification_skip_reason(uuid, text, uuid, text) to service_role;
revoke all on function public.claim_inspection_notification() from public, anon, authenticated;
grant execute on function public.claim_inspection_notification() to service_role;
revoke all on function public.retry_inspection_notification(uuid, boolean) from public, anon;
grant execute on function public.retry_inspection_notification(uuid, boolean) to authenticated;

commit;
