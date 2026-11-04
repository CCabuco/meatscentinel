-- MeatScentinel — 018 Notification fixes + MSafe email notifications
--
-- 1. Fix: is_inspector() / is_administrator() resolved current_account_role()
--    through the caller's search_path. Functions that run with an empty
--    search_path (save_notification_options, retry_inspection_notification,
--    mark_notification_read, and others) failed with
--    "function current_account_role() does not exist". The helpers now pin
--    their own search_path, which fixes every caller at once.
--
-- 2. MSafe reports join the existing email outbox. A notification now
--    belongs to either a CheckMeat scan (scan_id, old reports) or an MSafe
--    report (msafe_report_id). Assigned inspectors are emailed when an MSafe
--    report is assigned to them, reassigned away from them, or linked to an
--    inspection. A self-claim does not email the person who claimed it.
--    Preferences, admin switches, retries and the 7-day expiry all apply as
--    before.
--
-- Apply after 017_msafe_reports.sql.

begin;

-- ------------------------------------------------------------------
-- 1. Role helpers with a fixed search_path
-- ------------------------------------------------------------------
create or replace function public.is_inspector()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.current_account_role() = 'inspector';
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.current_account_role() = 'administrator';
$$;

-- ------------------------------------------------------------------
-- 2. Outbox rows can point at an MSafe report
-- ------------------------------------------------------------------
alter table public.inspection_notifications
  alter column scan_id drop not null,
  add column msafe_report_id uuid references public.msafe_reports (msafe_report_id) on delete restrict,
  add constraint inspection_notifications_source
    check ((scan_id is not null) <> (msafe_report_id is not null));

create index inspection_notifications_msafe_idx on public.inspection_notifications (msafe_report_id)
  where msafe_report_id is not null;

-- Same signature as before. p_scan carries either a CheckMeat scan_id or an
-- MSafe report id; the assignment check looks in whichever table has it.
create or replace function public.notification_skip_reason(p_recipient uuid, p_category text, p_scan uuid, p_event text)
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
  then return 'Inspector is no longer assigned'; end if;
  return null;
end;
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
      coalesce(item.scan_id, item.msafe_report_id), item.event_type);
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
    coalesce(item.scan_id, item.msafe_report_id), item.event_type);
  if skip_reason is not null then raise exception '%', skip_reason; end if;
  if item.created_at < now() - interval '7 days' then raise exception 'This notification has expired'; end if;
  update public.inspection_notifications set status = 'pending', next_attempt_at = now(), reason = null where id = p_id;
  insert into public.notification_management_history (actor_id, action, details)
    values (auth.uid(), 'email_retry_requested', jsonb_build_object('notification_id', p_id, 'previous_status', item.status));
end;
$$;

-- ------------------------------------------------------------------
-- 3. Queue MSafe notifications
-- ------------------------------------------------------------------
create function public.enqueue_msafe_notification(p_recipient uuid, p_report uuid, p_inspection text,
  p_category text, p_event text, p_title text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare skip_reason text;
begin
  if p_recipient is null then return; end if;
  skip_reason := public.notification_skip_reason(p_recipient, p_category, p_report, p_event);
  insert into public.inspection_notifications (recipient_id, recipient_user_id, recipient_name, actor_id,
    msafe_report_id, inspection_id, category, event_type, title, message, status, reason)
  select a.id, a.user_id, a.display_name, (select id from public.accounts where id = auth.uid()),
    p_report, p_inspection, p_category, p_event, p_title, p_message,
    case when skip_reason is null then 'pending' else 'skipped' end, skip_reason
  from public.accounts a where a.id = p_recipient;
end;
$$;

create function public.notify_msafe_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.inspector_id is distinct from old.inspector_id then
    -- An inspector claiming a report for themselves does not need an email.
    if new.inspector_id is distinct from auth.uid() then
      perform public.enqueue_msafe_notification(new.inspector_id, new.msafe_report_id, new.inspection_id, 'assignments',
        'assignment_received', 'An MSafe report has been assigned to you',
        'You are now responsible for this MSafe report. Open MeatScentinel to review it and send a response.');
    end if;
    perform public.enqueue_msafe_notification(old.inspector_id, new.msafe_report_id, new.inspection_id, 'assignments',
      'assignment_removed', 'Your MSafe report assignment has changed',
      'This MSafe report has been reassigned. You are no longer the assigned inspector.');
  elsif new.inspection_id is distinct from old.inspection_id then
    perform public.enqueue_msafe_notification(new.inspector_id, new.msafe_report_id, new.inspection_id, 'results',
      'inspection_linked', 'Your MSafe report has been linked to an inspection',
      'The MSafe report assigned to you is now linked to a MeatScentinel inspection record.');
  end if;
  return new;
end;
$$;

create trigger msafe_assignment_notify after update on public.msafe_report_assignments
  for each row execute function public.notify_msafe_assignment();

revoke all on function public.enqueue_msafe_notification(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_msafe_assignment() from public, anon, authenticated;
revoke all on function public.claim_inspection_notification() from public, anon, authenticated;
revoke all on function public.notification_skip_reason(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_inspection_notification() to service_role;
grant execute on function public.notification_skip_reason(uuid, text, uuid, text) to service_role;
revoke all on function public.retry_inspection_notification(uuid, boolean) from public, anon;
grant execute on function public.retry_inspection_notification(uuid, boolean) to authenticated;

commit;
