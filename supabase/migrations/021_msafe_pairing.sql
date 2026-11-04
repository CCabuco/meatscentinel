-- MeatScentinel — 021 A linked MSafe scan becomes the mobile half of a record
--
-- Since the CheckMeat pull was retired, nothing wrote image_submissions,
-- so gas records could never pair and stayed Pending. Decision (Nov 5,
-- 2026): when an MSafe report is linked to an inspection, its scan is used
-- as that inspection's mobile (image-based) result.
--
--   * scan_result "fresh"/"spoiled" (any case) becomes image_result
--     Fresh/Spoiled. Anything else is stored as missing, so fusion gives
--     For Review (Table 3, unchanged).
--   * The MSafe photo link is kept as image_path. A missing photo makes
--     the submission invalid, which also gives For Review (V-18, unchanged).
--   * Only the first mobile result counts. If the inspection already has
--     one, linking changes nothing (submissions are immutable).
--   * Pairing, fusion, the classification and the emails to the assigned
--     inspector all run through the existing triggers.
--
-- Also fills in inspections that were linked before this migration.
--
-- Apply after 020_inspection_assignments.sql.

begin;

alter table public.image_submissions
  add column source text not null default 'mobile_app'
    check (source in ('mobile_app', 'msafe')),
  add column msafe_report_id uuid references public.msafe_reports (msafe_report_id) on delete restrict;

comment on column public.image_submissions.source is
  'mobile_app: sent by the mobile application. msafe: taken from a linked MSafe report scan (image_path is then the MSafe photo link).';

create function msafe_private.pair_linked_scan(p_report_id uuid, p_inspection_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_report public.msafe_reports; v_result public.source_result;
begin
  if p_inspection_id is null then return; end if;
  select * into v_report from public.msafe_reports where msafe_report_id = p_report_id;
  if not found then return; end if;

  v_result := case lower(trim(coalesce(v_report.scan_result, '')))
    when 'fresh' then 'Fresh'::public.source_result
    when 'spoiled' then 'Spoiled'::public.source_result
    else null end;

  insert into public.image_submissions (inspection_id, image_result, image_path, submitted_at, source, msafe_report_id)
  values (p_inspection_id, v_result, v_report.photo_url,
          coalesce(v_report.scanned_at, v_report.submitted_at), 'msafe', p_report_id)
  on conflict (inspection_id) do nothing;
end;
$$;

revoke all on function msafe_private.pair_linked_scan(uuid, text) from public, anon, authenticated;

create function public.msafe_link_pairs_scan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.inspection_id is not null and new.inspection_id is distinct from old.inspection_id then
    perform msafe_private.pair_linked_scan(new.msafe_report_id, new.inspection_id);
  end if;
  return new;
end;
$$;

revoke all on function public.msafe_link_pairs_scan() from public, anon, authenticated;

create trigger msafe_link_pairs_scan after update on public.msafe_report_assignments
  for each row execute function public.msafe_link_pairs_scan();

-- Record changes (new submissions, the classification after pairing,
-- remarks, status) now also reach the inspector of each linked MSafe
-- report, not only the directly assigned inspector. Each inspector is
-- emailed once, and never about their own remark or status change.
create or replace function public.notify_inspection_change()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare assignment public.customer_report_assignments; v_direct uuid; m record;
  notified uuid[] := array[]::uuid[];
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
      message := case when tg_table_name = 'gas_submissions' then 'Gas readings were received.' else 'A mobile (image) result was received.' end;
    end if;
  end if;

  if assignment.inspector_id is not null then
    perform public.enqueue_inspection_notification(assignment.inspector_id, assignment.scan_id, assignment.inspection_id,
      category, event, title, message);
    notified := notified || assignment.inspector_id;
  end if;

  if tg_table_name <> 'customer_reports' then
    select inspector_id into v_direct from public.inspection_assignments where inspection_id = new.inspection_id;
    if v_direct is not null and not (v_direct = any(notified)) and v_direct is distinct from auth.uid() then
      perform public.enqueue_direct_inspection_notification(v_direct, new.inspection_id, category, event, title, message);
      notified := notified || v_direct;
    end if;

    for m in select msafe_report_id, inspector_id from public.msafe_report_assignments
              where inspection_id = new.inspection_id and inspector_id is not null loop
      if not (m.inspector_id = any(notified)) and m.inspector_id is distinct from auth.uid() then
        perform public.enqueue_msafe_notification(m.inspector_id, m.msafe_report_id, new.inspection_id,
          category, event, title, message);
        notified := notified || m.inspector_id;
      end if;
    end loop;
  end if;
  return new;
end;
$fn$;

-- Staff names now come with their User ID, so two people with the same
-- display name (for example two "Cj Inspector" accounts) can be told
-- apart everywhere. User IDs are already shown in the Activity Log and
-- notification pages, so this exposes nothing new.
create or replace view public.author_names as
select id, display_name, user_id from public.accounts;

-- Activity Log: inspection assignments and MSafe report actions are now
-- recorded there too (they were only in each record's / report's history).
-- Each entry is filed under the inspector it concerns.
alter table public.inspector_activity drop constraint inspector_activity_action_check;
alter table public.inspector_activity add constraint inspector_activity_action_check check (action in (
  'signed_in', 'signed_out', 'remark_added', 'status_changed', 'account_updated',
  'password_changed', 'email_change_requested', 'email_change_cancelled', 'record_viewed', 'image_viewed',
  'report_claimed', 'report_assigned', 'report_linked', 'report_viewed', 'report_image_viewed',
  'inspection_assigned', 'inspection_unassigned',
  'msafe_claimed', 'msafe_assigned', 'msafe_linked', 'msafe_response_sent'
));

create function public.audit_inspection_assignment()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare b text; a text;
begin
  select display_name into b from public.accounts where id = new.previous_inspector_id;
  select display_name into a from public.accounts where id = new.inspector_id;
  if new.inspector_id is not null then
    perform public.append_inspector_activity(new.actor_id, new.inspector_id, 'inspection_assigned', new.inspection_id,
      jsonb_build_object('before', b, 'after', a));
  end if;
  if new.previous_inspector_id is not null then
    perform public.append_inspector_activity(new.actor_id, new.previous_inspector_id, 'inspection_unassigned', new.inspection_id,
      jsonb_build_object('before', b, 'after', a));
  end if;
  return new;
end;
$fn$;
revoke all on function public.audit_inspection_assignment() from public, anon, authenticated;
create trigger inspection_assignment_audit after insert on public.inspection_assignment_events
  for each row execute function public.audit_inspection_assignment();

create function public.audit_msafe_event()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare v_inspector uuid := new.inspector_id; v_inspection text := new.inspection_id; v_name text;
begin
  if v_inspector is null or v_inspection is null then
    select coalesce(v_inspector, inspector_id), coalesce(v_inspection, inspection_id)
      into v_inspector, v_inspection
      from public.msafe_report_assignments where msafe_report_id = new.msafe_report_id;
  end if;
  if v_inspector is null then return new; end if;
  select display_name into v_name from public.accounts where id = new.inspector_id;
  perform public.append_inspector_activity(new.actor_id, v_inspector,
    case new.action when 'claimed' then 'msafe_claimed' when 'linked' then 'msafe_linked'
      when 'response_sent' then 'msafe_response_sent' else 'msafe_assigned' end,
    v_inspection, jsonb_build_object('msafe_report_id', new.msafe_report_id, 'after', v_name));
  return new;
end;
$fn$;
revoke all on function public.audit_msafe_event() from public, anon, authenticated;
create trigger msafe_event_audit after insert on public.msafe_assignment_events
  for each row execute function public.audit_msafe_event();

-- Inspections already linked before this migration (oldest link first).
do $$
declare r record;
begin
  for r in
    select a.msafe_report_id, a.inspection_id
    from public.msafe_report_assignments a
    where a.inspection_id is not null
    order by a.updated_at
  loop
    perform msafe_private.pair_linked_scan(r.msafe_report_id, r.inspection_id);
  end loop;
end;
$$;

commit;
