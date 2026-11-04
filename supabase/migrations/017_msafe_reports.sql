-- MeatScentinel — 017 MSafe reports (hardened version of the MSafe team's SQL)
--
-- The MSafe (CheckMeat) backend server pushes spoiled-meat reports into
-- msafe_reports and reads our replies from msafe_responses. Same table
-- names, same columns and the same x-msafe-key header as their proposal,
-- so their server code does not change.
--
-- Decisions (Nov 4, 2026):
--   * MSafe server: insert reports, read sent responses. Nothing else.
--   * Key lives in Supabase Vault (secret 'msafe_key'), checked by a function
--     in a private schema the REST API does not expose.
--   * Reports are immutable. received_at is set by us. 60 reports/minute max.
--   * meat_type must be chicken, pork or beef (any case). confidence is a
--     percentage (0-100). Only report_type and submitted_at are required.
--   * Customers see "MeatScentinel Inspector", never the real name.
--   * Each sent response has public text (findings, action taken) and staff-only
--     internal notes plus the real author, kept in msafe_response_internal.
--   * Responses start as drafts (staff-only, editable by the author). Sending
--     locks them and only then does MSafe see them.
--   * Only the assigned inspector responds. Inspectors claim unassigned
--     reports; administrators assign/reassign and may also respond.
--   * Drafts are visible to their author and administrators only.
--   * A report can be linked once to a MeatScentinel inspection.
--
-- Store the key once in the SQL editor (do not save that query):
--   select vault.create_secret('<the key>', 'msafe_key');
-- Change it later:
--   select vault.update_secret(id, '<new key>') from vault.secrets where name = 'msafe_key';
--
-- Apply after 016_device_submission.sql.

begin;

-- ==================================================================
-- 1. Private key check (not exposed through the REST API)
-- ==================================================================
create schema if not exists msafe_private;
revoke all on schema msafe_private from public;
grant usage on schema msafe_private to anon, authenticated;

create function msafe_private.is_msafe_server()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_given    text := coalesce(current_setting('request.headers', true)::json ->> 'x-msafe-key', '');
  v_expected text;
begin
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'msafe_key' limit 1;
  if v_expected is null or length(v_expected) < 32 or length(v_given) < 32 then
    return false;
  end if;
  return v_given = v_expected;
end;
$$;

revoke all on function msafe_private.is_msafe_server() from public;
grant execute on function msafe_private.is_msafe_server() to anon, authenticated;

-- Staff role of the caller, or null. Used inside security definer
-- functions (search_path is empty there, so is_inspector() cannot be used).
create function msafe_private.staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r::text from (select public.current_account_role() as r) x
   where r::text in ('inspector', 'administrator');
$$;
revoke all on function msafe_private.staff_role() from public;
grant execute on function msafe_private.staff_role() to authenticated;

-- ==================================================================
-- 2. Reports (sent by the MSafe server)
-- ==================================================================
create table public.msafe_reports (
  msafe_report_id    uuid primary key,
  report_type        text not null check (report_type in ('consumer', 'supplier')),
  meat_type          text check (meat_type is null or meat_type in ('chicken', 'pork', 'beef')),
  scan_result        text check (scan_result is null or length(scan_result) <= 40),
  confidence         real check (confidence is null or (confidence >= 0 and confidence <= 100)),
  photo_url          text check (photo_url is null or (photo_url ~ '^https://' and length(photo_url) <= 2048)),
  scanned_at         timestamptz,
  purchase_location  text check (purchase_location is null or length(purchase_location) <= 200),
  purchase_address   text check (purchase_address is null or length(purchase_address) <= 500),
  purchase_lat       double precision check (purchase_lat is null or purchase_lat between -90 and 90),
  purchase_lng       double precision check (purchase_lng is null or purchase_lng between -180 and 180),
  purchase_date      date,
  purchase_time      text check (purchase_time is null or length(purchase_time) <= 20),
  supplier_name      text check (supplier_name is null or length(supplier_name) <= 200),
  supplier_contact   text check (supplier_contact is null or length(supplier_contact) <= 100),
  supplier_address   text check (supplier_address is null or length(supplier_address) <= 500),
  supplier_lat       double precision check (supplier_lat is null or supplier_lat between -90 and 90),
  supplier_lng       double precision check (supplier_lng is null or supplier_lng between -180 and 180),
  delivery_date      date,
  additional_details text check (additional_details is null or length(additional_details) <= 4000),
  submitted_at       timestamptz not null,
  received_at        timestamptz not null default now()
);

create index msafe_reports_received_idx on public.msafe_reports (received_at desc);

-- received_at is ours; meat_type is normalised; spam limit.
create function public.msafe_reports_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.received_at := now();
  new.meat_type := nullif(lower(trim(new.meat_type)), '');
  if (select count(*) from public.msafe_reports where received_at > now() - interval '1 minute') >= 60 then
    raise exception 'Too many reports. Try again in a minute.' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger msafe_reports_before_insert before insert on public.msafe_reports
  for each row execute function public.msafe_reports_before_insert();

-- ==================================================================
-- 3. Sent responses (what the reporter sees) + staff-only details
-- ==================================================================
create table public.msafe_responses (
  response_id     uuid primary key default gen_random_uuid(),
  msafe_report_id uuid not null references public.msafe_reports (msafe_report_id) on delete restrict,
  status          text not null check (status in ('under_review', 'investigated', 'resolved', 'not_substantiated')),
  findings        text check (findings is null or length(findings) <= 4000),
  action_taken    text check (action_taken is null or length(action_taken) <= 4000),
  inspector_name  text not null default 'MeatScentinel Inspector',
  inspection_date date,
  letter_url      text check (letter_url is null or (letter_url ~ '^https://' and length(letter_url) <= 2048)),
  responded_at    timestamptz not null default now()
);

create index msafe_responses_report_idx on public.msafe_responses (msafe_report_id, responded_at);
create index msafe_responses_responded_idx on public.msafe_responses (responded_at);

create table public.msafe_response_internal (
  response_id    uuid primary key references public.msafe_responses (response_id) on delete restrict,
  author_id      uuid not null references public.accounts (id),
  author_role    text not null check (author_role in ('inspector', 'administrator')),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 4000)
);

-- ==================================================================
-- 4. Drafts (staff-only, editable by the author until sent)
-- ==================================================================
create table public.msafe_response_drafts (
  draft_id        uuid primary key default gen_random_uuid(),
  msafe_report_id uuid not null references public.msafe_reports (msafe_report_id) on delete restrict,
  author_id       uuid not null references public.accounts (id),
  status          text not null check (status in ('under_review', 'investigated', 'resolved', 'not_substantiated')),
  findings        text check (findings is null or length(findings) <= 4000),
  action_taken    text check (action_taken is null or length(action_taken) <= 4000),
  inspection_date date,
  letter_url      text check (letter_url is null or (letter_url ~ '^https://' and length(letter_url) <= 2048)),
  internal_notes  text check (internal_notes is null or length(internal_notes) <= 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index msafe_drafts_report_idx on public.msafe_response_drafts (msafe_report_id);

-- ==================================================================
-- 5. Assignment (current owner) + append-only history
-- ==================================================================
create table public.msafe_report_assignments (
  msafe_report_id uuid primary key references public.msafe_reports (msafe_report_id) on delete restrict,
  inspector_id    uuid references public.accounts (id),
  inspection_id   text references public.inspection_records (inspection_id) on delete restrict,
  version         integer not null default 0,
  updated_at      timestamptz not null default now()
);

create table public.msafe_assignment_events (
  event_id        bigserial primary key,
  msafe_report_id uuid not null references public.msafe_reports (msafe_report_id) on delete restrict,
  action          text not null check (action in ('claimed', 'assigned', 'reassigned', 'linked', 'response_sent')),
  actor_id        uuid not null references public.accounts (id),
  inspector_id    uuid references public.accounts (id),
  inspection_id   text,
  occurred_at     timestamptz not null default now()
);

create index msafe_events_report_idx on public.msafe_assignment_events (msafe_report_id, occurred_at);

-- ==================================================================
-- 6. Immutability / append-only
-- ==================================================================
create function public.msafe_block_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger msafe_reports_immutable before update or delete on public.msafe_reports
  for each row execute function public.msafe_block_change();
create trigger msafe_reports_no_truncate before truncate on public.msafe_reports
  for each statement execute function public.msafe_block_change();
create trigger msafe_responses_append_only before update or delete on public.msafe_responses
  for each row execute function public.msafe_block_change();
create trigger msafe_responses_no_truncate before truncate on public.msafe_responses
  for each statement execute function public.msafe_block_change();
create trigger msafe_internal_append_only before update or delete on public.msafe_response_internal
  for each row execute function public.msafe_block_change();
create trigger msafe_internal_no_truncate before truncate on public.msafe_response_internal
  for each statement execute function public.msafe_block_change();
create trigger msafe_events_append_only before update or delete on public.msafe_assignment_events
  for each row execute function public.msafe_block_change();
create trigger msafe_events_no_truncate before truncate on public.msafe_assignment_events
  for each statement execute function public.msafe_block_change();

-- ==================================================================
-- 7. Row Level Security and grants
-- ==================================================================
alter table public.msafe_reports            enable row level security;
alter table public.msafe_responses          enable row level security;
alter table public.msafe_response_internal  enable row level security;
alter table public.msafe_response_drafts    enable row level security;
alter table public.msafe_report_assignments enable row level security;
alter table public.msafe_assignment_events  enable row level security;
alter table public.msafe_reports            force row level security;
alter table public.msafe_responses          force row level security;
alter table public.msafe_response_internal  force row level security;
alter table public.msafe_response_drafts    force row level security;
alter table public.msafe_report_assignments force row level security;
alter table public.msafe_assignment_events  force row level security;

revoke all on public.msafe_reports, public.msafe_responses, public.msafe_response_internal,
  public.msafe_response_drafts, public.msafe_report_assignments, public.msafe_assignment_events
  from public, anon, authenticated;
revoke all on sequence public.msafe_assignment_events_event_id_seq from public, anon, authenticated;

-- MSafe server (anon + valid key): insert reports, read sent responses.
grant insert on public.msafe_reports to anon;
create policy msafe_server_insert_reports on public.msafe_reports for insert to anon
  with check (msafe_private.is_msafe_server());

grant select on public.msafe_responses to anon;
create policy msafe_server_read_responses on public.msafe_responses for select to anon
  using (msafe_private.is_msafe_server());

-- Staff: read reports, sent responses, internal details, assignments, history.
grant select on public.msafe_reports, public.msafe_responses, public.msafe_response_internal,
  public.msafe_report_assignments, public.msafe_assignment_events, public.msafe_response_drafts
  to authenticated;

create policy msafe_staff_read_reports on public.msafe_reports for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create policy msafe_staff_read_responses on public.msafe_responses for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create policy msafe_staff_read_internal on public.msafe_response_internal for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create policy msafe_staff_read_assignments on public.msafe_report_assignments for select to authenticated
  using (public.is_inspector() or public.is_administrator());
create policy msafe_staff_read_events on public.msafe_assignment_events for select to authenticated
  using (public.is_inspector() or public.is_administrator());

-- Drafts: author sees own; administrators see all.
create policy msafe_drafts_read on public.msafe_response_drafts for select to authenticated
  using ((public.is_inspector() and author_id = auth.uid()) or public.is_administrator());

-- Staff view: reports with current assignment (security_invoker keeps RLS).
create view public.msafe_reports_view with (security_invoker = true) as
select r.*, a.inspector_id, a.inspection_id, coalesce(a.version, 0) as assignment_version,
       n.display_name as inspector_name,
       (select s.status from public.msafe_responses s
         where s.msafe_report_id = r.msafe_report_id order by s.responded_at desc limit 1) as latest_status,
       (select count(*) from public.msafe_responses s where s.msafe_report_id = r.msafe_report_id) as response_count
  from public.msafe_reports r
  left join public.msafe_report_assignments a using (msafe_report_id)
  left join public.author_names n on n.id = a.inspector_id;

revoke all on public.msafe_reports_view from public, anon, authenticated;
grant select on public.msafe_reports_view to authenticated;

-- ==================================================================
-- 8. Staff actions
-- ==================================================================

-- Inspector claims an unassigned report.
create function public.claim_msafe_report(p_report_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.msafe_report_assignments;
begin
  if msafe_private.staff_role() is distinct from 'inspector' then
    raise exception 'Only inspectors can claim reports' using errcode = '42501';
  end if;
  perform 1 from public.msafe_reports where msafe_report_id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = '22023'; end if;
  insert into public.msafe_report_assignments (msafe_report_id) values (p_report_id) on conflict do nothing;
  select * into v_row from public.msafe_report_assignments where msafe_report_id = p_report_id for update;
  if v_row.version is distinct from p_version then
    raise exception 'This report changed. Refresh and try again.' using errcode = '40001';
  end if;
  if v_row.inspector_id is not null then
    raise exception 'This report is already assigned' using errcode = '22023';
  end if;
  update public.msafe_report_assignments
     set inspector_id = auth.uid(), version = version + 1, updated_at = now()
   where msafe_report_id = p_report_id;
  insert into public.msafe_assignment_events (msafe_report_id, action, actor_id, inspector_id)
  values (p_report_id, 'claimed', auth.uid(), auth.uid());
end;
$$;

-- Administrator assigns or reassigns to an active inspector.
create function public.assign_msafe_report(p_report_id uuid, p_inspector_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.msafe_report_assignments;
begin
  if msafe_private.staff_role() is distinct from 'administrator' then
    raise exception 'Only administrators can assign reports' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = p_inspector_id and role = 'inspector' and is_active) then
    raise exception 'Choose an active inspector' using errcode = '22023';
  end if;
  perform 1 from public.msafe_reports where msafe_report_id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = '22023'; end if;
  insert into public.msafe_report_assignments (msafe_report_id) values (p_report_id) on conflict do nothing;
  select * into v_row from public.msafe_report_assignments where msafe_report_id = p_report_id for update;
  if v_row.version is distinct from p_version then
    raise exception 'This report changed. Refresh and try again.' using errcode = '40001';
  end if;
  if v_row.inspector_id = p_inspector_id then
    raise exception 'That inspector is already assigned' using errcode = '22023';
  end if;
  update public.msafe_report_assignments
     set inspector_id = p_inspector_id, version = version + 1, updated_at = now()
   where msafe_report_id = p_report_id;
  insert into public.msafe_assignment_events (msafe_report_id, action, actor_id, inspector_id)
  values (p_report_id, case when v_row.inspector_id is null then 'assigned' else 'reassigned' end,
          auth.uid(), p_inspector_id);
end;
$$;

-- Assigned inspector or administrator links an inspection, once.
create function public.link_msafe_inspection(p_report_id uuid, p_inspection_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := msafe_private.staff_role(); v_row public.msafe_report_assignments;
begin
  if v_role is null then raise exception 'Verified staff session required' using errcode = '42501'; end if;
  select * into v_row from public.msafe_report_assignments where msafe_report_id = p_report_id for update;
  if not found or v_row.inspector_id is null then
    raise exception 'Assign this report before linking an inspection' using errcode = '22023';
  end if;
  if v_role = 'inspector' and v_row.inspector_id <> auth.uid() then
    raise exception 'Only the assigned inspector or an administrator can link this report' using errcode = '42501';
  end if;
  if v_row.inspection_id is not null then
    raise exception 'This report is already linked' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inspection_records where inspection_id = trim(p_inspection_id)) then
    raise exception 'Inspection not found' using errcode = '22023';
  end if;
  update public.msafe_report_assignments
     set inspection_id = trim(p_inspection_id), version = version + 1, updated_at = now()
   where msafe_report_id = p_report_id;
  insert into public.msafe_assignment_events (msafe_report_id, action, actor_id, inspection_id)
  values (p_report_id, 'linked', auth.uid(), trim(p_inspection_id));
end;
$$;

-- Can the caller write responses for this report?
create function msafe_private.can_respond(p_report_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role text := msafe_private.staff_role();
begin
  if v_role = 'administrator' then
    return exists (select 1 from public.msafe_reports where msafe_report_id = p_report_id);
  end if;
  if v_role = 'inspector' then
    return exists (select 1 from public.msafe_report_assignments
                    where msafe_report_id = p_report_id and inspector_id = auth.uid());
  end if;
  return false;
end;
$$;
revoke all on function msafe_private.can_respond(uuid) from public;

-- Create (p_draft_id null) or update the caller's own draft.
create function public.save_msafe_draft(
  p_draft_id uuid, p_report_id uuid, p_status text,
  p_findings text default null, p_action_taken text default null,
  p_inspection_date date default null, p_letter_url text default null, p_internal_notes text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not msafe_private.can_respond(p_report_id) then
    raise exception 'Only the assigned inspector or an administrator can respond to this report' using errcode = '42501';
  end if;
  if p_inspection_date is not null and p_inspection_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Inspection date cannot be in the future' using errcode = '22023';
  end if;
  if p_draft_id is null then
    insert into public.msafe_response_drafts (msafe_report_id, author_id, status, findings, action_taken,
      inspection_date, letter_url, internal_notes)
    values (p_report_id, auth.uid(), p_status, nullif(trim(p_findings), ''), nullif(trim(p_action_taken), ''),
      p_inspection_date, nullif(trim(p_letter_url), ''), nullif(trim(p_internal_notes), ''))
    returning draft_id into v_id;
  else
    update public.msafe_response_drafts
       set status = p_status, findings = nullif(trim(p_findings), ''), action_taken = nullif(trim(p_action_taken), ''),
           inspection_date = p_inspection_date, letter_url = nullif(trim(p_letter_url), ''),
           internal_notes = nullif(trim(p_internal_notes), ''), updated_at = now()
     where draft_id = p_draft_id and author_id = auth.uid() and msafe_report_id = p_report_id
    returning draft_id into v_id;
    if v_id is null then raise exception 'Draft not found' using errcode = '22023'; end if;
  end if;
  return v_id;
end;
$$;

create function public.delete_msafe_draft(p_draft_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if msafe_private.staff_role() is null then
    raise exception 'Verified staff session required' using errcode = '42501';
  end if;
  delete from public.msafe_response_drafts where draft_id = p_draft_id and author_id = auth.uid();
  if not found then raise exception 'Draft not found' using errcode = '22023'; end if;
end;
$$;

-- Send the caller's own draft: becomes a locked response the reporter sees.
create function public.send_msafe_draft(p_draft_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.msafe_response_drafts; v_id uuid; v_role text := msafe_private.staff_role();
begin
  select * into d from public.msafe_response_drafts
   where draft_id = p_draft_id and author_id = auth.uid() for update;
  if not found then raise exception 'Draft not found' using errcode = '22023'; end if;
  if not msafe_private.can_respond(d.msafe_report_id) then
    raise exception 'You are no longer assigned to this report' using errcode = '42501';
  end if;
  if d.status <> 'under_review' and d.findings is null and d.action_taken is null then
    raise exception 'Add findings or the action taken before sending this status' using errcode = '22023';
  end if;

  insert into public.msafe_responses (msafe_report_id, status, findings, action_taken, inspection_date, letter_url)
  values (d.msafe_report_id, d.status, d.findings, d.action_taken, d.inspection_date, d.letter_url)
  returning response_id into v_id;

  insert into public.msafe_response_internal (response_id, author_id, author_role, internal_notes)
  values (v_id, auth.uid(), v_role, d.internal_notes);

  insert into public.msafe_assignment_events (msafe_report_id, action, actor_id)
  values (d.msafe_report_id, 'response_sent', auth.uid());

  delete from public.msafe_response_drafts where draft_id = p_draft_id;
  return v_id;
end;
$$;

-- ==================================================================
-- 9. Function grants
-- ==================================================================
revoke all on function public.msafe_reports_before_insert() from public, anon, authenticated;
revoke all on function public.msafe_block_change() from public, anon, authenticated;
revoke all on function public.claim_msafe_report(uuid, integer) from public, anon, authenticated;
revoke all on function public.assign_msafe_report(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.link_msafe_inspection(uuid, text) from public, anon, authenticated;
revoke all on function public.save_msafe_draft(uuid, uuid, text, text, text, date, text, text) from public, anon, authenticated;
revoke all on function public.delete_msafe_draft(uuid) from public, anon, authenticated;
revoke all on function public.send_msafe_draft(uuid) from public, anon, authenticated;

grant execute on function public.claim_msafe_report(uuid, integer) to authenticated;
grant execute on function public.assign_msafe_report(uuid, uuid, integer) to authenticated;
grant execute on function public.link_msafe_inspection(uuid, text) to authenticated;
grant execute on function public.save_msafe_draft(uuid, uuid, text, text, text, date, text, text) to authenticated;
grant execute on function public.delete_msafe_draft(uuid) to authenticated;
grant execute on function public.send_msafe_draft(uuid) to authenticated;

commit;
