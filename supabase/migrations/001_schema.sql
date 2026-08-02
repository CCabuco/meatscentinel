-- MeatScentinel — 001 Schema
-- Types, tables, constraints, indexes.
-- Traceability: V-01..V-19, U-B..U-F, A-01..A-06, AD-01..AD-06, DB-01..DB-04.

-- ============================================================
-- ENUMERATED VOCABULARIES
-- ============================================================

-- Two roles only (V-13, A-01).
create type account_role as enum ('inspector', 'administrator');

-- Raw meat variants in scope (original Delimitations).
create type sample_type as enum ('chicken', 'pork', 'beef');

-- A single source's verdict. Never 'For Review' — that is a
-- fused outcome, not a source outcome (Table 3).
create type source_result as enum ('Fresh', 'Spoiled');

-- Final classification vocabulary (V-15). Algorithm-produced only.
create type final_classification as enum ('Fresh', 'Spoiled', 'For Review');

-- Case status vocabulary (V-03). Inspector-managed.
-- 'For Review' deliberately absent (V-02).
create type case_status as enum ('Open', 'Under Review', 'Resolved');


-- ============================================================
-- ACCOUNTS
-- ============================================================
-- Mirrors auth.users. Holds the User ID -> email mapping (AD-01),
-- the role (V-13), and the active flag that every access policy
-- checks so deactivation is immediate (AD-02, U-F).

create table accounts (
  id            uuid primary key references auth.users (id) on delete restrict,
  user_id       text        not null unique,
  email         text        not null unique,
  display_name  text        not null,
  role          account_role not null,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),

  constraint user_id_format check (user_id ~ '^[A-Za-z0-9-]{4,32}$'),
  constraint display_name_present check (length(trim(display_name)) > 0)
);

-- on delete restrict, plus no delete policy in 003, implements
-- "no account deletion" (A-03). Deactivation is the only removal path.

create index accounts_role_active_idx on accounts (role) where is_active;
create unique index accounts_user_id_lower_idx on accounts (lower(user_id));


-- ============================================================
-- INSPECTION RECORDS
-- ============================================================
-- Created eagerly by whichever submission arrives first (DB-01).
-- inspection_id is a natural key supplied by the IoT device (V-01),
-- not generated here.
--
-- final_classification NULL  => Pending (no fusion yet)
-- final_classification set   => fusion ran; value is permanent (V-04)

create table inspection_records (
  inspection_id        text primary key,
  final_classification final_classification,
  classified_at        timestamptz,
  created_at           timestamptz not null default now(),

  constraint inspection_id_format check (inspection_id ~ '^[A-Za-z0-9-]{6,40}$'),

  -- classified_at is set if and only if a classification exists.
  constraint classification_timestamp_paired check (
    (final_classification is null and classified_at is null)
    or
    (final_classification is not null and classified_at is not null)
  )
);

-- Records Management: newest first (V-19), filtered by classification.
create index inspection_records_created_idx
  on inspection_records (created_at desc);
create index inspection_records_pending_idx
  on inspection_records (created_at desc)
  where final_classification is null;
create index inspection_records_classification_idx
  on inspection_records (final_classification, created_at desc);


-- ============================================================
-- GAS SUBMISSIONS  (the IoT half)
-- ============================================================
-- Separate table so an unpaired gas record is a missing row rather
-- than a pattern of NULL columns (V-05).
--
-- The device uploads invalid readings rather than suppressing them
-- (DB-04); is_valid false routes fusion to For Review via Table 3.

create table gas_submissions (
  inspection_id text primary key
                references inspection_records (inspection_id) on delete restrict,
  sample_type   sample_type not null,
  nh3_ppm       numeric(8,2),
  h2s_ppm       numeric(8,2),
  gas_result    source_result,
  is_valid      boolean     not null,
  detected_at   timestamptz not null,
  received_at   timestamptz not null default now(),

  constraint nh3_non_negative check (nh3_ppm is null or nh3_ppm >= 0),
  constraint h2s_non_negative check (h2s_ppm is null or h2s_ppm >= 0),

  -- A valid submission must carry a verdict and both readings.
  -- An invalid one carries whatever it has.
  constraint valid_submission_complete check (
    is_valid = false
    or (gas_result is not null and nh3_ppm is not null and h2s_ppm is not null)
  )
);

create index gas_submissions_sample_type_idx on gas_submissions (sample_type);


-- ============================================================
-- IMAGE SUBMISSIONS  (the external mobile application half)
-- ============================================================
-- Result and image arrive already computed. The image is stored for
-- documentation only and never analysed (original scope).
--
-- No sample_type column: sample type is selected on the IoT device,
-- so unpaired image submissions carry none (DB-03).
--
-- is_valid is written by the receipt validation trigger (V-18, AD-04),
-- which fires on insert regardless of transport — leaving V-17 open
-- does not block this table.

create table image_submissions (
  inspection_id text primary key
                references inspection_records (inspection_id) on delete restrict,
  image_result  source_result,
  image_path    text,
  is_valid      boolean     not null default false,
  submitted_at  timestamptz not null,
  received_at   timestamptz not null default now()
);


-- ============================================================
-- REMARKS
-- ============================================================
-- Insert-only. No update or delete policy exists in 003, which is
-- what makes "previous remarks will not be deleted or reset"
-- structural rather than a UI convention.
--
-- Independent of status changes (V-16).

create table remarks (
  id            uuid primary key default gen_random_uuid(),
  inspection_id text        not null
                references inspection_records (inspection_id) on delete restrict,
  author_id     uuid        references accounts (id) on delete restrict,
  content       text        not null,
  created_at    timestamptz not null default now(),

  constraint content_present check (length(trim(content)) > 0),
  constraint content_length check (length(content) <= 2000)
);

-- author_id NOT NULL is not declared here because status_entries
-- shares the "system author" convention (see below) and the two
-- tables are read through one combined timeline (V-15). Remarks are
-- never system-authored in practice; the insert policy in 003
-- requires author_id = auth.uid().

create index remarks_record_idx on remarks (inspection_id, created_at desc);


-- ============================================================
-- STATUS ENTRIES
-- ============================================================
-- Insert-only, same reasoning as remarks. Current case status is the
-- most recent row for a record.
--
-- author_id NULL means the entry was written by the system. This is
-- used exactly once per record: the initial 'Open' entry created with
-- the record (DB-02). V-14 attribution is satisfied by displaying
-- "System" for these — the timeline still states who acted and when.

create table status_entries (
  id            uuid primary key default gen_random_uuid(),
  inspection_id text        not null
                references inspection_records (inspection_id) on delete restrict,
  author_id     uuid        references accounts (id) on delete restrict,
  status        case_status not null,
  created_at    timestamptz not null default now()
);

create index status_entries_record_idx on status_entries (inspection_id, created_at desc);


-- ============================================================
-- READ VIEW FOR RECORDS MANAGEMENT
-- ============================================================
-- One query surface for the records page. security_invoker keeps
-- row-level policies applying to the caller, not the view owner —
-- without it the administrator boundary (AD-05) would leak here.
--
-- pairing_state is derived from row existence, so it cannot drift
-- out of step with reality.

create view inspection_records_view
with (security_invoker = true) as
select
  r.inspection_id,
  r.final_classification,
  r.classified_at,
  r.created_at,
  g.sample_type,
  g.nh3_ppm,
  g.h2s_ppm,
  g.gas_result,
  g.is_valid          as gas_is_valid,
  i.image_result,
  i.image_path,
  i.is_valid          as image_is_valid,
  (g.inspection_id is not null) as has_gas_submission,
  (i.inspection_id is not null) as has_image_submission,
  case
    when g.inspection_id is not null and i.inspection_id is not null then 'paired'
    else 'pending'
  end as pairing_state,
  (
    select se.status
    from status_entries se
    where se.inspection_id = r.inspection_id
    order by se.created_at desc, se.id desc
    limit 1
  ) as current_case_status
from inspection_records r
left join gas_submissions   g on g.inspection_id = r.inspection_id
left join image_submissions i on i.inspection_id = r.inspection_id;
