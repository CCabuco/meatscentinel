-- MeatScentinel — 002 Functions and triggers
-- All behaviour that the requirements state must be automatic or
-- irreversible lives here, at the data layer (AD-03, AD-04, AD-05),
-- so it holds regardless of which client wrote the row. This is also
-- what keeps V-17 off the critical path: these fire on insert, not on
-- whatever transport performed the insert.


-- ============================================================
-- EAGER PARENT CREATION  (DB-01)
-- ============================================================
-- Whichever submission arrives first creates the parent record, so
-- Pending records are queryable alongside paired ones in a single
-- table rather than as orphan rows across two.

create or replace function ensure_inspection_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into inspection_records (inspection_id)
  values (new.inspection_id)
  on conflict (inspection_id) do nothing;
  return new;
end;
$$;

create trigger gas_ensure_parent
  before insert on gas_submissions
  for each row execute function ensure_inspection_record();

create trigger image_ensure_parent
  before insert on image_submissions
  for each row execute function ensure_inspection_record();


-- ============================================================
-- INITIAL CASE STATUS  (DB-02)
-- ============================================================
-- Every record opens at 'Open', system-authored (author_id null).
-- Without this, a case status filter would silently exclude every
-- untouched record — an inspector filtering 'Open' would not see
-- new arrivals.

create or replace function seed_initial_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into status_entries (inspection_id, author_id, status)
  values (new.inspection_id, null, 'Open');
  return new;
end;
$$;

create trigger inspection_record_seed_status
  after insert on inspection_records
  for each row execute function seed_initial_status();


-- ============================================================
-- VALIDATION ON RECEIPT  (V-18, AD-04)
-- ============================================================
-- The web application validates incoming submissions on receipt:
-- the result must be a recognised value and the image file present.
-- Failures are stored — the record is still needed — but flagged,
-- and fusion reads the flag as the Invalid condition in Table 3.

create or replace function validate_image_submission()
returns trigger
language plpgsql
as $$
begin
  new.is_valid :=
        new.image_result is not null
    and new.image_path  is not null
    and length(trim(new.image_path)) > 0;
  return new;
end;
$$;

create trigger image_validate_on_receipt
  before insert on image_submissions
  for each row execute function validate_image_submission();


-- ============================================================
-- RULE-BASED DECISION FUSION  (V-04, AD-03, Table 3)
-- ============================================================
-- Runs automatically upon successful pairing. Writes once. Never
-- recomputes: the guard below refuses to proceed if a classification
-- already exists.
--
-- Table 3, unmodified:
--   Missing / Invalid / Incomplete on either side  -> For Review
--   Either side Spoiled                            -> Spoiled
--   Both Fresh                                     -> Fresh

create or replace function run_decision_fusion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gas         gas_submissions%rowtype;
  v_image       image_submissions%rowtype;
  v_existing    final_classification;
  v_result      final_classification;
begin
  select * into v_gas   from gas_submissions   where inspection_id = new.inspection_id;
  select * into v_image from image_submissions where inspection_id = new.inspection_id;

  -- Not yet paired. The record waits in Pending; this is not an error.
  if v_gas.inspection_id is null or v_image.inspection_id is null then
    return new;
  end if;

  -- Never recompute (V-04).
  select final_classification into v_existing
  from inspection_records
  where inspection_id = new.inspection_id;

  if v_existing is not null then
    return new;
  end if;

  if v_gas.is_valid is not true
     or v_image.is_valid is not true
     or v_gas.gas_result is null
     or v_image.image_result is null then
    v_result := 'For Review';
  elsif v_gas.gas_result = 'Spoiled' or v_image.image_result = 'Spoiled' then
    v_result := 'Spoiled';
  else
    v_result := 'Fresh';
  end if;

  update inspection_records
     set final_classification = v_result,
         classified_at        = now()
   where inspection_id = new.inspection_id
     and final_classification is null;

  return new;
end;
$$;

create trigger gas_run_fusion
  after insert on gas_submissions
  for each row execute function run_decision_fusion();

create trigger image_run_fusion
  after insert on image_submissions
  for each row execute function run_decision_fusion();


-- ============================================================
-- WRITE-ONCE CLASSIFICATION  (V-02, V-04)
-- ============================================================
-- Once set, final_classification is permanent and no role may alter
-- it. The fusion trigger writes it while it is still null; every
-- other path is refused here. inspection_id is likewise immutable,
-- since it is the pairing key.

create or replace function guard_inspection_record_update()
returns trigger
language plpgsql
as $$
begin
  if old.inspection_id is distinct from new.inspection_id then
    raise exception 'inspection_id is immutable';
  end if;

  if old.final_classification is not null
     and new.final_classification is distinct from old.final_classification then
    raise exception 'final classification is written once and is never recomputed';
  end if;

  if old.classified_at is not null
     and new.classified_at is distinct from old.classified_at then
    raise exception 'classified_at is immutable once set';
  end if;

  return new;
end;
$$;

create trigger inspection_record_write_once
  before update on inspection_records
  for each row execute function guard_inspection_record_update();


-- ============================================================
-- SUBMISSION IMMUTABILITY
-- ============================================================
-- Classification is never recomputed, so a mutable submission would
-- let the stored readings drift out of agreement with the verdict
-- derived from them.

create or replace function guard_submission_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'submissions are immutable once received';
end;
$$;

create trigger gas_immutable
  before update or delete on gas_submissions
  for each row execute function guard_submission_immutable();

create trigger image_immutable
  before update or delete on image_submissions
  for each row execute function guard_submission_immutable();


-- ============================================================
-- APPEND-ONLY HISTORY
-- ============================================================
-- "The previous remarks or status will not be deleted or reset."
-- The absence of update/delete policies in 003 already prevents this
-- for ordinary callers; these triggers also cover privileged paths.

create or replace function guard_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'remarks and status entries are append-only';
end;
$$;

create trigger remarks_append_only
  before update or delete on remarks
  for each row execute function guard_append_only();

create trigger status_entries_append_only
  before update or delete on status_entries
  for each row execute function guard_append_only();


-- ============================================================
-- ADMINISTRATOR GUARDS  (U-B)
-- ============================================================
-- An administrator cannot deactivate their own account, and the last
-- remaining active administrator cannot be deactivated. Without these
-- a normal use of the deactivation function can lock every
-- administrator out, recoverable only by direct backend access —
-- since after the first, administrators are created in-app (A-06).

create or replace function guard_account_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining_admins integer;
begin
  if old.is_active = true and new.is_active = false then

    if new.id = auth.uid() then
      raise exception 'an administrator cannot deactivate their own account';
    end if;

    if old.role = 'administrator' then
      select count(*) into v_remaining_admins
      from accounts
      where role = 'administrator'
        and is_active = true
        and id <> old.id;

      if v_remaining_admins = 0 then
        raise exception 'the last remaining active administrator cannot be deactivated';
      end if;
    end if;
  end if;

  if old.user_id is distinct from new.user_id then
    raise exception 'user id is immutable';
  end if;

  return new;
end;
$$;

create trigger account_deactivation_guard
  before update on accounts
  for each row execute function guard_account_deactivation();
