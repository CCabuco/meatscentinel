-- MeatScentinel — 016 Device submission
--
-- Lets the kiosk upload gas results WITHOUT holding the service key.
-- The kiosk calls the submit-inspection Edge Function with a device
-- secret. The function validates the payload and calls
-- submit_device_inspection() below, which is the only write path.
--
-- What this adds:
--   1. Four extra columns on gas_submissions (device_id, reading_count,
--      nh3_stddev, h2s_stddev) plus clock_reliable.
--   2. device_submissions: a private ledger keyed by submission_id, so a
--      retried upload is recognised as "already stored" instead of an error.
--   3. submit_device_inspection(): inserts the gas row and the ledger row
--      in one transaction. Executable by service_role only.
--
-- Nothing here touches RLS on existing tables, immutability, append-only
-- history, or write-once classification. The existing gas_ensure_parent,
-- gas_immutable, gas_run_fusion and notification triggers still fire on
-- the insert exactly as before.
--
-- Apply after 015_notification_schedule.sql.

begin;

-- ------------------------------------------------------------------
-- 1. Extra gas_submissions columns (all nullable: older rows and the
--    seeded test data simply have nulls here)
-- ------------------------------------------------------------------
alter table public.gas_submissions
  add column device_id      text,
  add column reading_count  integer,
  add column nh3_stddev     numeric(8,3),
  add column h2s_stddev     numeric(8,3),
  add column clock_reliable boolean;

alter table public.gas_submissions
  add constraint device_id_format
    check (device_id is null or device_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  add constraint reading_count_range
    check (reading_count is null or reading_count between 0 and 10000),
  add constraint nh3_stddev_non_negative
    check (nh3_stddev is null or nh3_stddev >= 0),
  add constraint h2s_stddev_non_negative
    check (h2s_stddev is null or h2s_stddev >= 0);

comment on column public.gas_submissions.clock_reliable is
  'False when the device clock looked wrong at upload time (detected_at in the future, or very old). detected_at is kept as sent.';

-- ------------------------------------------------------------------
-- 2. Private ledger. RLS on with no policies = no client role can see
--    or touch it. Only the function below (security definer) writes.
-- ------------------------------------------------------------------
create table public.device_submissions (
  submission_id uuid primary key,
  device_id     text not null,
  inspection_id text not null references public.inspection_records (inspection_id) on delete restrict,
  received_at   timestamptz not null default now()
);

create index device_submissions_inspection_idx on public.device_submissions (inspection_id);

alter table public.device_submissions enable row level security;
alter table public.device_submissions force row level security;
revoke all on public.device_submissions from public, anon, authenticated;

-- Ledger rows are evidence of what the device sent. Same rule as the
-- other history tables: no edits, no deletes.
create function public.device_submissions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'device_submissions is append-only' using errcode = '42501';
end;
$$;

create trigger device_submissions_append_only
  before update or delete on public.device_submissions
  for each row execute function public.device_submissions_guard();

create trigger device_submissions_no_truncate
  before truncate on public.device_submissions
  for each statement execute function public.device_submissions_guard();

-- ------------------------------------------------------------------
-- 3. The write path.
--    Returns 'created'   - new gas submission stored
--            'duplicate' - this exact submission_id was already stored
--                          (a retry after a lost response). Treat as success.
--            'conflict'  - the inspection already has a gas submission from
--                          something else. Never retry.
-- ------------------------------------------------------------------
create function public.submit_device_inspection(
  p_submission_id  uuid,
  p_device_id      text,
  p_inspection_id  text,
  p_sample_type    public.sample_type,
  p_nh3_ppm        numeric,
  p_h2s_ppm        numeric,
  p_gas_result     public.source_result,
  p_is_valid       boolean,
  p_detected_at    timestamptz,
  p_reading_count  integer default null,
  p_nh3_stddev     numeric default null,
  p_h2s_stddev     numeric default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_inspection text;
  v_clock_ok boolean;
begin
  if p_submission_id is null or p_device_id is null or p_inspection_id is null
     or p_sample_type is null or p_is_valid is null or p_detected_at is null then
    raise exception 'Missing required field' using errcode = '22023';
  end if;

  -- Replay of a submission we already stored?
  select inspection_id into v_existing_inspection
    from public.device_submissions where submission_id = p_submission_id;
  if found then
    if v_existing_inspection is distinct from p_inspection_id then
      raise exception 'submission_id was already used for a different inspection' using errcode = '22023';
    end if;
    return 'duplicate';
  end if;

  if exists (select 1 from public.gas_submissions where inspection_id = p_inspection_id) then
    return 'conflict';
  end if;

  v_clock_ok := p_detected_at <= now() + interval '5 minutes'
            and p_detected_at >= now() - interval '30 days';

  begin
    -- gas_ensure_parent creates the inspection_records row (and the
    -- first 'Open' status entry through its own trigger).
    insert into public.gas_submissions (
      inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at,
      device_id, reading_count, nh3_stddev, h2s_stddev, clock_reliable
    ) values (
      p_inspection_id, p_sample_type, p_nh3_ppm, p_h2s_ppm, p_gas_result, p_is_valid, p_detected_at,
      p_device_id, p_reading_count, p_nh3_stddev, p_h2s_stddev, v_clock_ok
    );

    insert into public.device_submissions (submission_id, device_id, inspection_id)
    values (p_submission_id, p_device_id, p_inspection_id);
  exception when unique_violation then
    -- Two uploads raced. Whichever won, report the honest outcome.
    if exists (select 1 from public.device_submissions
               where submission_id = p_submission_id and inspection_id = p_inspection_id) then
      return 'duplicate';
    end if;
    return 'conflict';
  end;

  return 'created';
end;
$$;

revoke all on function public.submit_device_inspection(
  uuid, text, text, public.sample_type, numeric, numeric, public.source_result,
  boolean, timestamptz, integer, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.submit_device_inspection(
  uuid, text, text, public.sample_type, numeric, numeric, public.source_result,
  boolean, timestamptz, integer, numeric, numeric
) to service_role;

revoke all on function public.device_submissions_guard() from public, anon, authenticated;

commit;
