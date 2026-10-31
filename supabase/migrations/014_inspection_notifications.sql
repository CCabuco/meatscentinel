-- Transactional notification outbox. Apply after 013. No historical backfill.
begin;
create table public.notification_settings (
  id boolean primary key default true check (id),
  email_enabled boolean not null default true,
  assignments boolean not null default true,
  remarks boolean not null default true,
  statuses boolean not null default true,
  results boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.notification_settings(id) values (true);
create table public.notification_preferences (
  account_id uuid primary key references public.accounts(id),
  email_enabled boolean not null default true,
  assignments boolean not null default true,
  remarks boolean not null default true,
  statuses boolean not null default true,
  results boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.inspection_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.accounts(id),
  recipient_user_id text not null,
  recipient_name text not null,
  actor_id uuid references public.accounts(id),
  scan_id uuid not null references public.customer_reports(scan_id),
  inspection_id text references public.inspection_records(inspection_id),
  category text not null check (category in ('assignments','remarks','statuses','results')),
  event_type text not null,
  title text not null,
  message text not null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  status text not null default 'pending' check (status in ('pending','processing','accepted','failed','unknown','skipped')),
  reason text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  accepted_at timestamptz,
  provider_message_id text,
  sent_to text
);
create index inspection_notifications_recipient_idx on public.inspection_notifications(recipient_id,created_at desc,id);
create index inspection_notifications_queue_idx on public.inspection_notifications(next_attempt_at) where status='pending';
create table public.notification_management_history (
  id bigint generated always as identity primary key,
  actor_id uuid references public.accounts(id),
  account_id uuid references public.accounts(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create trigger notification_management_append_only before update or delete on public.notification_management_history
  for each row execute function public.guard_inspector_activity();
create trigger notification_management_no_truncate before truncate on public.notification_management_history
  for each statement execute function public.guard_inspector_activity();

alter table public.notification_settings enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.inspection_notifications enable row level security;
alter table public.notification_management_history enable row level security;
revoke all on public.notification_settings, public.notification_preferences, public.inspection_notifications,
  public.notification_management_history from public, anon, authenticated;
revoke all on sequence public.notification_management_history_id_seq from public, anon, authenticated;
grant select on public.notification_settings, public.notification_preferences, public.inspection_notifications,
  public.notification_management_history to authenticated;
create policy notification_settings_read on public.notification_settings for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create policy notification_preferences_read on public.notification_preferences for select to authenticated
  using (public.is_administrator() or (public.is_inspector() and account_id=auth.uid()));
create policy inspection_notifications_read on public.inspection_notifications for select to authenticated
  using (public.is_administrator() or (public.is_inspector() and recipient_id=auth.uid()));
create policy notification_management_read on public.notification_management_history for select to authenticated
  using (public.is_administrator());

create function public.save_notification_options(p_global boolean, p_email boolean, p_assignments boolean,
  p_remarks boolean, p_statuses boolean, p_results boolean)
returns void language plpgsql security definer set search_path='' as $$
declare before_value jsonb; after_value jsonb;
begin
  if p_global is null or p_email is null or p_assignments is null or p_remarks is null or p_statuses is null or p_results is null then
    raise exception 'All notification options are required';
  end if;
  if p_global then
    if public.is_administrator() is not true then raise exception 'Administrator required' using errcode='42501'; end if;
    select to_jsonb(s) into before_value from public.notification_settings s where id for update;
    update public.notification_settings set email_enabled=p_email, assignments=p_assignments, remarks=p_remarks,
      statuses=p_statuses, results=p_results, updated_at=now() where id;
  else
    if public.is_inspector() is not true then raise exception 'Verified inspector required' using errcode='42501'; end if;
    select to_jsonb(p) into before_value from public.notification_preferences p where account_id=auth.uid() for update;
    insert into public.notification_preferences(account_id,email_enabled,assignments,remarks,statuses,results)
      values(auth.uid(),p_email,p_assignments,p_remarks,p_statuses,p_results)
      on conflict(account_id) do update set email_enabled=excluded.email_enabled,assignments=excluded.assignments,
        remarks=excluded.remarks,statuses=excluded.statuses,results=excluded.results,updated_at=now();
  end if;
  after_value := jsonb_build_object('email_enabled',p_email,'assignments',p_assignments,'remarks',p_remarks,'statuses',p_statuses,'results',p_results);
  insert into public.notification_management_history(actor_id,account_id,action,details)
    values(auth.uid(),case when p_global then null else auth.uid() end,
      case when p_global then 'global_settings_changed' else 'personal_preferences_changed' end,
      jsonb_build_object('before',before_value,'after',after_value));
end;
$$;

-- Private eligibility check, called both when queued and immediately before sending.
create function public.notification_skip_reason(p_recipient uuid,p_category text,p_scan uuid,p_event text)
returns text language plpgsql security definer set search_path='' as $$
declare a public.accounts; prefs jsonb; settings jsonb;
begin
  select * into a from public.accounts where id=p_recipient;
  if not found or not a.is_active or a.role <> 'inspector' then return 'Inspector account is inactive or unavailable'; end if;
  if nullif(trim(a.email),'') is null then return 'Inspector has no registered email'; end if;
  select to_jsonb(p) into prefs from public.notification_preferences p where account_id=p_recipient;
  select to_jsonb(s) into settings from public.notification_settings s where id;
  if coalesce((prefs->>'email_enabled')::boolean,true)=false then return 'Inspector turned off email notifications'; end if;
  if coalesce((prefs->>p_category)::boolean,true)=false then return 'Inspector turned off this notification category'; end if;
  if coalesce((settings->>p_category)::boolean,false)=false then return 'Administrator disabled this notification category'; end if;
  if p_event <> 'assignment_removed' and not exists (
    select 1 from public.customer_report_assignments where scan_id=p_scan and inspector_id=p_recipient
  ) then return 'Inspector is no longer assigned'; end if;
  return null;
end;
$$;
create function public.enqueue_inspection_notification(p_recipient uuid,p_scan uuid,p_inspection text,
  p_category text,p_event text,p_title text,p_message text)
returns void language plpgsql security definer set search_path='' as $$
declare skip_reason text;
begin
  if p_recipient is null then return; end if;
  skip_reason := public.notification_skip_reason(p_recipient,p_category,p_scan,p_event);
  insert into public.inspection_notifications(recipient_id,recipient_user_id,recipient_name,actor_id,scan_id,
    inspection_id,category,event_type,title,message,status,reason)
  select a.id,a.user_id,a.display_name,(select id from public.accounts where id=auth.uid()),p_scan,
    p_inspection,p_category,p_event,p_title,p_message,
    case when skip_reason is null then 'pending' else 'skipped' end,skip_reason
  from public.accounts a where a.id=p_recipient;
end;
$$;

create function public.notify_report_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.inspector_id is distinct from old.inspector_id then
    perform public.enqueue_inspection_notification(new.inspector_id,new.scan_id,new.inspection_id,'assignments',
      'assignment_received','An inspection has been assigned to you',
      'You are now responsible for this customer report and its linked inspection. Open MeatScentinel to review it.');
    perform public.enqueue_inspection_notification(old.inspector_id,new.scan_id,new.inspection_id,'assignments',
      'assignment_removed','Your inspection assignment has changed',
      'This customer report and its linked inspection have been reassigned. You are no longer the assigned inspector.');
  elsif new.inspection_id is distinct from old.inspection_id then
    perform public.enqueue_inspection_notification(new.inspector_id,new.scan_id,new.inspection_id,'results',
      'inspection_linked','Your report has been linked to an inspection',
      'The assigned mobile report is now linked to a MeatScentinel inspection record.');
  end if;
  return new;
end;
$$;
create trigger customer_assignment_notify after update on public.customer_report_assignments
  for each row execute function public.notify_report_assignment();

create function public.notify_inspection_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare assignment public.customer_report_assignments; category text; event text; title text; message text;
begin
  if tg_table_name='customer_reports' then
    -- A refresh timestamp alone is not a change to the mobile inspection.
    if row(new.meat_type,new.classification,new.confidence_score,new.scanned_at)
      is not distinct from row(old.meat_type,old.classification,old.confidence_score,old.scanned_at) then return new; end if;
    select * into assignment from public.customer_report_assignments where scan_id=new.scan_id;
    category:='results'; event:='mobile_updated'; title:='An assigned mobile report was updated';
    message:='CheckMeat report details changed during refresh. Open the report to review the latest information.';
  else
    select * into assignment from public.customer_report_assignments where inspection_id=new.inspection_id;
    if tg_table_name='remarks' then
      category:='remarks'; event:='remark_added'; title:='New remark on your assigned inspection';
      message:='A remark was added. Sign in to read the inspection history.';
    elsif tg_table_name='status_entries' then
      category:='statuses'; event:='status_changed'; title:='Your inspection case status was updated';
      message:='The case status is now ' || new.status::text || '.';
    elsif tg_table_name='inspection_records' then
      if row(new.final_classification,new.classified_at) is not distinct from row(old.final_classification,old.classified_at) then return new; end if;
      category:='results'; event:='classification_ready'; title:='Classification available for your inspection';
      message:='The final classification is ' || coalesce(new.final_classification::text,'Pending') || '.';
    else
      category:='results'; event:=case when tg_table_name='gas_submissions' then 'gas_received' else 'image_received' end;
      title:='New submission for your assigned inspection';
      message:=case when tg_table_name='gas_submissions' then 'Gas readings were received.' else 'An image submission was received.' end;
    end if;
  end if;
  perform public.enqueue_inspection_notification(assignment.inspector_id,assignment.scan_id,assignment.inspection_id,
    category,event,title,message);
  return new;
end;
$$;
create trigger remarks_notify after insert on public.remarks for each row execute function public.notify_inspection_change();
create trigger status_notify after insert on public.status_entries for each row execute function public.notify_inspection_change();
create trigger gas_notify after insert on public.gas_submissions for each row execute function public.notify_inspection_change();
create trigger image_notify after insert on public.image_submissions for each row execute function public.notify_inspection_change();
create trigger classification_notify after update on public.inspection_records for each row execute function public.notify_inspection_change();
create trigger mobile_report_notify after update on public.customer_reports for each row execute function public.notify_inspection_change();

-- Only the scheduled service worker may lease messages; overlapping runs cannot claim the same row.
create function public.claim_inspection_notification()
returns setof public.inspection_notifications language plpgsql security definer set search_path='' as $$
declare item public.inspection_notifications; skip_reason text;
begin
  -- A dead worker might have sent already. Never blindly resend an uncertain delivery.
  update public.inspection_notifications set status='unknown',reason='Worker stopped before delivery could be confirmed',
    lease_token=null,lease_until=null where status='processing' and lease_until<now();
  if not exists(select 1 from public.notification_settings where id and email_enabled) then return; end if;
  for item in select * from public.inspection_notifications where status='pending' and next_attempt_at<=now()
    order by created_at,id limit 50 for update skip locked loop
    skip_reason := public.notification_skip_reason(item.recipient_id,item.category,item.scan_id,item.event_type);
    if item.created_at<now()-interval '7 days' then skip_reason:='Notification expired after seven days'; end if;
    if skip_reason is not null then
      update public.inspection_notifications set status='skipped',reason=skip_reason where id=item.id;
      continue;
    end if;
    return query update public.inspection_notifications set status='processing',attempts=attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',reason=null,
      sent_to=(select email from public.accounts where id=item.recipient_id)
      where id=item.id returning *;
    return;
  end loop;
end;
$$;

create function public.finish_inspection_notification(p_id uuid,p_lease uuid,p_status text,p_reason text default null,p_provider_id text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('accepted','failed','unknown','pending','skipped') or p_status is null then raise exception 'Invalid delivery status'; end if;
  update public.inspection_notifications set
    status=case when p_status='pending' and attempts>=5 then 'failed' else p_status end,
    reason=left(p_reason,300),provider_message_id=p_provider_id,
    accepted_at=case when p_status='accepted' then now() else accepted_at end,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::integer),
    lease_token=null,lease_until=null
    where id=p_id and lease_token=p_lease and status='processing';
end;
$$;

create function public.retry_inspection_notification(p_id uuid,p_allow_unknown boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare item public.inspection_notifications; skip_reason text;
begin
  if public.is_administrator() is not true then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into item from public.inspection_notifications where id=p_id for update;
  if not found or item.status not in ('failed','unknown') then raise exception 'Only failed or uncertain messages can be retried'; end if;
  if item.status='unknown' and p_allow_unknown is not true then raise exception 'Confirm possible duplicate email before retrying'; end if;
  skip_reason:=public.notification_skip_reason(item.recipient_id,item.category,item.scan_id,item.event_type);
  if skip_reason is not null then raise exception '%',skip_reason; end if;
  if item.created_at<now()-interval '7 days' then raise exception 'This notification has expired'; end if;
  update public.inspection_notifications set status='pending',next_attempt_at=now(),reason=null where id=p_id;
  insert into public.notification_management_history(actor_id,action,details)
    values(auth.uid(),'email_retry_requested',jsonb_build_object('notification_id',p_id,'previous_status',item.status));
end;
$$;
create function public.mark_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.is_inspector() is not true then raise exception 'Verified inspector required' using errcode='42501'; end if;
  update public.inspection_notifications set read_at=coalesce(read_at,now()) where id=p_id and recipient_id=auth.uid();
end;
$$;

-- Client roles have SELECT only. All state mutations are via restricted RPCs.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_notification_options','notification_skip_reason',
      'enqueue_inspection_notification','notify_report_assignment','notify_inspection_change','claim_inspection_notification',
      'finish_inspection_notification','retry_inspection_notification','mark_notification_read') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.proname in ('save_notification_options','retry_inspection_notification','mark_notification_read') then
      execute format('grant execute on function %s to authenticated',f.signature);
    elsif f.proname in ('claim_inspection_notification','finish_inspection_notification','notification_skip_reason') then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;
end $$;
commit;

