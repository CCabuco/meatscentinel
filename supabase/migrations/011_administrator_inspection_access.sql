-- Administrators can use inspection modules as well as account management.
-- Apply after 010_login_verification.sql. Both role helpers use
-- current_account_role(), preserving active-account and verified-session checks.
-- Only read and append permissions change; immutable submissions, write-once
-- classifications, and append-only history remain enforced.

begin;

alter policy inspection_records_read on public.inspection_records
  using (public.is_inspector() or public.is_administrator());

alter policy gas_submissions_read on public.gas_submissions
  using (public.is_inspector() or public.is_administrator());

alter policy image_submissions_read on public.image_submissions
  using (public.is_inspector() or public.is_administrator());

alter policy remarks_read on public.remarks
  using (public.is_inspector() or public.is_administrator());

alter policy status_entries_read on public.status_entries
  using (public.is_inspector() or public.is_administrator());

alter policy remarks_insert on public.remarks
  with check (
    (public.is_inspector() or public.is_administrator())
    and author_id = auth.uid()
  );

alter policy status_entries_insert on public.status_entries
  with check (
    (public.is_inspector() or public.is_administrator())
    and author_id = auth.uid()
  );

create policy "administrators read inspection images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'inspection-images'
    and public.is_administrator()
  );

commit;
