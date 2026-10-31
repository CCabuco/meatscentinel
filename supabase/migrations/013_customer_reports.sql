-- CheckMeat scans are read-only source data. Assignment stays in MeatScentinel.
begin;
create table public.customer_reports (
  scan_id uuid primary key,
  meat_type text not null,
  classification text not null check (classification in ('Fresh', 'Spoiled')),
  confidence_score real,
  scanned_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create table public.customer_report_assignments (
  scan_id uuid primary key references public.customer_reports(scan_id),
  inspector_id uuid references public.accounts(id),
  inspector_user_id text,
  inspector_name text,
  inspection_id text unique references public.inspection_records(inspection_id),
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.customer_reports enable row level security;
alter table public.customer_report_assignments enable row level security;
revoke all on public.customer_reports, public.customer_report_assignments from public, anon, authenticated;
grant select on public.customer_reports, public.customer_report_assignments to authenticated;
grant select, insert, update on public.customer_reports to service_role;
create policy customer_reports_read on public.customer_reports for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create policy customer_assignments_read on public.customer_report_assignments for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create view public.customer_reports_view with (security_invoker = true) as
select r.*, a.inspector_id, a.inspector_user_id, a.inspector_name, a.inspection_id,
  coalesce(a.version, 0) as version
from public.customer_reports r left join public.customer_report_assignments a using (scan_id);
grant select on public.customer_reports_view to authenticated;
create index customer_reports_date_idx on public.customer_reports(scanned_at desc, scan_id desc);

alter table public.inspector_activity drop constraint inspector_activity_action_check;
alter table public.inspector_activity add constraint inspector_activity_action_check check (action in (
  'signed_in', 'signed_out', 'remark_added', 'status_changed', 'account_updated',
  'password_changed', 'email_change_requested', 'email_change_cancelled', 'record_viewed', 'image_viewed',
  'report_claimed', 'report_assigned', 'report_linked', 'report_viewed', 'report_image_viewed'
));

-- Lock the source row even for a first claim: two inspectors cannot both win.
create function public.manage_customer_report(
  p_scan uuid, p_action text, p_version integer,
  p_inspector uuid default null, p_inspection text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); role public.account_role := public.current_account_role();
  previous public.customer_report_assignments; target public.accounts;
  event text; details jsonb;
begin
  if role is null or role not in ('inspector', 'administrator') then
    raise exception 'Verified staff session required' using errcode = '42501';
  end if;
  perform 1 from public.customer_reports where scan_id = p_scan for update;
  if not found then raise exception 'Customer report not found'; end if;
  insert into public.customer_report_assignments(scan_id) values (p_scan) on conflict do nothing;
  select * into previous from public.customer_report_assignments where scan_id = p_scan for update;
  if p_version is distinct from previous.version then
    raise exception 'This report changed. Refresh it before trying again.' using errcode = '40001';
  end if;
  if p_action in ('claim', 'assign') then
    if p_action = 'claim' then
      if role <> 'inspector' or previous.inspector_id is not null then
        raise exception 'Only an inspector can claim an unassigned report' using errcode = '42501';
      end if;
      p_inspector := caller;
    elsif role <> 'administrator' then
      raise exception 'Only an administrator can assign reports' using errcode = '42501';
    end if;
    select * into target from public.accounts where id = p_inspector and role = 'inspector' and is_active for share;
    if not found then raise exception 'Choose an active inspector'; end if;
    if target.id = previous.inspector_id then return; end if;
    update public.customer_report_assignments set inspector_id = target.id,
      inspector_user_id = target.user_id, inspector_name = target.display_name,
      version = version + 1, updated_at = now() where scan_id = p_scan;
    event := case when p_action = 'claim' then 'report_claimed' else 'report_assigned' end;
    details := jsonb_build_object('scan_id', p_scan, 'before', previous.inspector_user_id, 'after', target.user_id);
    perform public.append_inspector_activity(caller, target.id, event, previous.inspection_id, details);
    -- The previous assignee's activity also shows a reassignment away from them.
    if previous.inspector_id is not null and previous.inspector_id <> target.id then
      perform public.append_inspector_activity(caller, previous.inspector_id, event, previous.inspection_id, details);
    end if;
  elsif p_action = 'link' then
    if previous.inspector_id is null then raise exception 'Assign an inspector before linking'; end if;
    if role <> 'administrator' and previous.inspector_id <> caller then
      raise exception 'Only the assigned inspector or an administrator can link this report' using errcode = '42501';
    end if;
    if previous.inspection_id is not null then raise exception 'This report is already linked'; end if;
    if not exists (select 1 from public.inspection_records where inspection_id = p_inspection) then
      raise exception 'Inspection ID not found';
    end if;
    update public.customer_report_assignments set inspection_id = p_inspection,
      version = version + 1, updated_at = now() where scan_id = p_scan;
    perform public.append_inspector_activity(caller, previous.inspector_id, 'report_linked', p_inspection,
      jsonb_build_object('scan_id', p_scan));
  else raise exception 'Unknown report action';
  end if;
end;
$$;

create function public.record_customer_report_view(p_scan uuid, p_action text, p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare linked text;
begin
  if public.current_account_role() is distinct from 'inspector' then
    raise exception 'Verified inspector session required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('report_viewed', 'report_image_viewed') or p_event is null then
    raise exception 'Invalid viewing event';
  end if;
  if not exists(select 1 from public.customer_reports where scan_id = p_scan) then
    raise exception 'Customer report not found';
  end if;
  select inspection_id into linked from public.customer_report_assignments where scan_id = p_scan;
  perform public.append_inspector_activity(auth.uid(), auth.uid(), p_action, linked,
    jsonb_build_object('scan_id', p_scan), 'app', p_event, nullif(auth.jwt()->>'session_id','')::uuid);
end;
$$;
revoke all on function public.manage_customer_report(uuid,text,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.record_customer_report_view(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.manage_customer_report(uuid,text,integer,uuid,text) to authenticated;
grant execute on function public.record_customer_report_view(uuid,text,uuid) to authenticated;
commit;
