-- MeatScentinel — 022 Inspectors can claim unassigned inspection records
--
-- Same idea as claiming an MSafe report: an inspector takes an inspection
-- (gas reading, mobile result or paired record) that has no assigned
-- inspector yet. Only administrators can reassign or unassign afterwards.
--
--   * Only active, verified inspectors can claim, and only records with
--     no directly assigned inspector. Two inspectors claiming at once:
--     the first wins, the second gets "already assigned".
--   * The claim is kept in inspection_assignment_events (action 'claimed')
--     and in the Activity Log ('inspection_claimed').
--   * No email is sent for your own claim. Later record emails (results,
--     pairing, remarks, status) work as for an assignment.
--
-- Apply after 021_msafe_pairing.sql.

begin;

alter table public.inspection_assignment_events
  drop constraint inspection_assignment_events_action_check,
  add constraint inspection_assignment_events_action_check
    check (action in ('assigned', 'reassigned', 'unassigned', 'claimed'));

alter table public.inspector_activity drop constraint inspector_activity_action_check;
alter table public.inspector_activity add constraint inspector_activity_action_check check (action in (
  'signed_in', 'signed_out', 'remark_added', 'status_changed', 'account_updated',
  'password_changed', 'email_change_requested', 'email_change_cancelled', 'record_viewed', 'image_viewed',
  'report_claimed', 'report_assigned', 'report_linked', 'report_viewed', 'report_image_viewed',
  'inspection_assigned', 'inspection_unassigned', 'inspection_claimed',
  'msafe_claimed', 'msafe_assigned', 'msafe_linked', 'msafe_response_sent'
));

create or replace function public.audit_inspection_assignment()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare b text; a text;
begin
  select display_name into b from public.accounts where id = new.previous_inspector_id;
  select display_name into a from public.accounts where id = new.inspector_id;
  if new.inspector_id is not null then
    perform public.append_inspector_activity(new.actor_id, new.inspector_id,
      case when new.action = 'claimed' then 'inspection_claimed' else 'inspection_assigned' end,
      new.inspection_id, jsonb_build_object('before', b, 'after', a));
  end if;
  if new.previous_inspector_id is not null then
    perform public.append_inspector_activity(new.actor_id, new.previous_inspector_id, 'inspection_unassigned', new.inspection_id,
      jsonb_build_object('before', b, 'after', a));
  end if;
  return new;
end;
$fn$;

create function public.claim_inspection(p_inspection_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text := trim(p_inspection_id);
begin
  if msafe_private.staff_role() is distinct from 'inspector' then
    raise exception 'Only a Meat Inspector can claim an inspection' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inspection_records where inspection_id = v_id) then
    raise exception 'Inspection not found' using errcode = '22023';
  end if;

  insert into public.inspection_assignments (inspection_id, inspector_id, assigned_by, assigned_at)
  values (v_id, auth.uid(), auth.uid(), now())
  on conflict (inspection_id) do nothing;
  if not found then
    raise exception 'This inspection is already assigned. Ask an administrator to reassign it.' using errcode = '22023';
  end if;

  insert into public.inspection_assignment_events (inspection_id, action, actor_id, inspector_id)
  values (v_id, 'claimed', auth.uid(), auth.uid());
end;
$$;

revoke all on function public.claim_inspection(text) from public, anon;
grant execute on function public.claim_inspection(text) to authenticated;

commit;
