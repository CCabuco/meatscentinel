-- Inspector actions and app-reported viewing. Apply after migration 011.
-- New activity only: existing remarks/status history is not rewritten.
begin;

create table public.inspector_activity (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references public.accounts(id) on delete restrict,
  actor_user_id text,
  actor_name text,
  inspector_id uuid not null references public.accounts(id) on delete restrict,
  inspector_user_id text not null,
  inspector_name text not null,
  action text not null check (action in (
    'signed_in', 'signed_out', 'remark_added', 'status_changed',
    'account_updated', 'password_changed', 'email_change_requested',
    'email_change_cancelled', 'record_viewed', 'image_viewed'
  )),
  inspection_id text references public.inspection_records(inspection_id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  source text not null check (source in ('database', 'app')),
  event_id uuid,
  session_id uuid,
  unique (inspector_id, event_id)
);

create index inspector_activity_time_idx on public.inspector_activity (occurred_at desc, id desc);
create index inspector_activity_inspector_idx on public.inspector_activity (inspector_user_id, occurred_at desc, id desc);
create index inspector_activity_record_idx on public.inspector_activity (inspection_id, occurred_at desc, id desc);
create index inspector_activity_action_idx on public.inspector_activity (action, occurred_at desc, id desc);
create unique index inspector_activity_session_idx on public.inspector_activity (session_id, action)
  where action in ('signed_in', 'signed_out');

alter table public.inspector_activity enable row level security;
alter table public.inspector_activity force row level security;
revoke all on public.inspector_activity from public, anon, authenticated;
revoke all on sequence public.inspector_activity_id_seq from public, anon, authenticated;
grant select on public.inspector_activity to authenticated;
create policy inspector_activity_admin_read on public.inspector_activity
  for select to authenticated using (public.is_administrator());

create function public.guard_inspector_activity()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Activity history is append-only';
end;
$$;
create trigger inspector_activity_append_only
  before update or delete on public.inspector_activity
  for each row execute function public.guard_inspector_activity();
create trigger inspector_activity_no_truncate
  before truncate on public.inspector_activity
  for each statement execute function public.guard_inspector_activity();

-- Private writer. Only triggers and the two restricted RPCs below can call it.
-- Actor/inspector names are snapshots; later name changes do not rewrite history.
create function public.append_inspector_activity(
  p_actor uuid, p_inspector uuid, p_action text, p_inspection text default null,
  p_details jsonb default '{}'::jsonb, p_source text default 'database',
  p_event uuid default null, p_session uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inspector_activity (
    actor_id, actor_user_id, actor_name, inspector_id, inspector_user_id,
    inspector_name, action, inspection_id, details, source, event_id, session_id
  )
  select a.id, a.user_id, a.display_name, i.id, i.user_id, i.display_name,
    p_action, p_inspection, p_details, p_source, p_event, p_session
  from public.accounts i left join public.accounts a on a.id = p_actor
  where i.id = p_inspector
  on conflict do nothing;
end;
$$;

create function public.audit_inspector_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous_status public.case_status;
begin
  if not exists (select 1 from public.accounts where id = new.author_id and role = 'inspector') then
    return new;
  end if;
  if tg_table_name = 'remarks' then
    perform public.append_inspector_activity(new.author_id, new.author_id, 'remark_added',
      new.inspection_id, jsonb_build_object('entry_id', new.id, 'content', new.content));
  else
    select s.status into previous_status from public.status_entries s
      where s.inspection_id = new.inspection_id and s.id <> new.id
      order by s.created_at desc, s.id desc limit 1;
    perform public.append_inspector_activity(new.author_id, new.author_id, 'status_changed',
      new.inspection_id, jsonb_build_object('entry_id', new.id, 'before', previous_status, 'after', new.status));
  end if;
  return new;
end;
$$;
create trigger remarks_audit_inspector after insert on public.remarks
  for each row execute function public.audit_inspector_entry();
create trigger status_audit_inspector after insert on public.status_entries
  for each row execute function public.audit_inspector_entry();

create function public.audit_inspector_login()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.expires_at > now() and exists (
    select 1 from public.accounts where id = new.account_id and role = 'inspector' and is_active
  ) then
    perform public.append_inspector_activity(new.account_id, new.account_id, 'signed_in',
      p_session => new.session_id);
  end if;
  return new;
end;
$$;
create trigger verified_session_audit_inspector after insert on public.verified_sessions
  for each row execute function public.audit_inspector_login();

create function public.audit_inspector_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare changes jsonb := '{}'::jsonb; field_name text; actor uuid;
begin
  if old.role <> 'inspector' and new.role <> 'inspector' then return new; end if;
  -- Explicit allowlist: never serialize a whole auth/account record.
  foreach field_name in array array['email', 'display_name', 'role', 'is_active'] loop
    if to_jsonb(old)->field_name is distinct from to_jsonb(new)->field_name then
      changes := changes || jsonb_build_object(field_name,
        jsonb_build_object('before', to_jsonb(old)->field_name, 'after', to_jsonb(new)->field_name));
    end if;
  end loop;
  if changes <> '{}'::jsonb then
    if public.current_account_role() is not null then actor := auth.uid(); end if;
    perform public.append_inspector_activity(actor, new.id, 'account_updated',
      p_details => jsonb_build_object('changes', changes));
  end if;
  return new;
end;
$$;
create trigger accounts_audit_inspector after update on public.accounts
  for each row execute function public.audit_inspector_account();

create function public.audit_inspector_auth_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.accounts where id = new.id and role = 'inspector') then
    return new;
  end if;
  -- Auth may be changed by recovery or an administrator. Do not invent an actor
  -- when GoTrue has not supplied one. The affected inspector is always recorded.
  if old.encrypted_password is distinct from new.encrypted_password then
    perform public.append_inspector_activity(null, new.id, 'password_changed');
  end if;
  if nullif(new.email_change, '') is distinct from nullif(old.email_change, '') then
    if nullif(new.email_change, '') is not null then
      perform public.append_inspector_activity(null, new.id, 'email_change_requested',
        p_details => jsonb_build_object('requested_email', new.email_change));
    elsif new.email is not distinct from old.email then
      perform public.append_inspector_activity(null, new.id, 'email_change_cancelled');
    end if;
  end if;
  return new;
end;
$$;
create trigger auth_users_audit_inspector after update on auth.users
  for each row execute function public.audit_inspector_auth_change();

-- Viewing is an app report, not a claim that every database read is monitored.
-- The browser supplies no actor, timestamp, arbitrary details, or write event.
create function public.record_inspection_activity(p_action text, p_inspection text, p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if public.current_account_role() is distinct from 'inspector' or not exists (
    select 1 from public.verified_sessions where session_id = session and account_id = caller and expires_at > now()
  ) then raise exception 'Verified inspector session required' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('record_viewed', 'image_viewed') or p_event is null then
    raise exception 'Invalid viewing event' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inspection_records where inspection_id = p_inspection) then
    raise exception 'Inspection not found' using errcode = '22023';
  end if;
  if p_action = 'image_viewed' and not exists (
    select 1 from public.image_submissions where inspection_id = p_inspection and nullif(trim(image_path), '') is not null
  ) then raise exception 'Inspection image not found' using errcode = '22023'; end if;
  perform public.append_inspector_activity(caller, caller, p_action, p_inspection,
    p_source => 'app', p_event => p_event, p_session => session);
end;
$$;

-- Explicit logout revokes this verified app session and records that fact in
-- one transaction. Repeating a completed logout is safe.
create function public.end_inspector_session()
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if caller is null or session is null then
    raise exception 'Inspector session required' using errcode = '42501';
  end if;
  if exists (select 1 from public.inspector_activity where inspector_id = caller and session_id = session and action = 'signed_out') then
    return;
  end if;
  if public.current_account_role() is distinct from 'inspector' or not exists (
    select 1 from public.verified_sessions where session_id = session and account_id = caller and expires_at > now()
  ) then raise exception 'Verified inspector session required' using errcode = '42501'; end if;
  perform public.append_inspector_activity(caller, caller, 'signed_out', p_session => session);
  delete from public.verified_sessions where session_id = session and account_id = caller;
end;
$$;

revoke all on function public.guard_inspector_activity() from public, anon, authenticated;
revoke all on function public.append_inspector_activity(uuid, uuid, text, text, jsonb, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.audit_inspector_entry() from public, anon, authenticated;
revoke all on function public.audit_inspector_login() from public, anon, authenticated;
revoke all on function public.audit_inspector_account() from public, anon, authenticated;
revoke all on function public.audit_inspector_auth_change() from public, anon, authenticated;
revoke all on function public.record_inspection_activity(text, text, uuid) from public, anon, authenticated;
revoke all on function public.end_inspector_session() from public, anon, authenticated;
grant execute on function public.record_inspection_activity(text, text, uuid) to authenticated;
grant execute on function public.end_inspector_session() to authenticated;

commit;
