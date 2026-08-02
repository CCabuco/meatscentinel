-- MeatScentinel — 003 Row Level Security
-- AD-05: this file is the access boundary. Client-side route guards
-- are user experience only; if the administrator/inspector separation
-- existed only in React routing, an administrator's token could still
-- query inspection records directly.
--
-- AD-02: every helper below requires is_active, so deactivation makes
-- an existing token useless immediately rather than at token expiry.


-- ============================================================
-- ROLE HELPERS
-- ============================================================
-- security definer so they bypass RLS on accounts — a policy on
-- accounts that queried accounts through RLS would recurse.
--
-- Returns null for a missing, deactivated, or unauthenticated caller,
-- so every policy below fails closed.

create or replace function current_account_role()
returns account_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from accounts
  where id = auth.uid()
    and is_active = true;
$$;

create or replace function is_inspector()
returns boolean
language sql
stable
as $$
  select current_account_role() = 'inspector';
$$;

create or replace function is_administrator()
returns boolean
language sql
stable
as $$
  select current_account_role() = 'administrator';
$$;


-- ============================================================
-- ENABLE RLS
-- ============================================================

alter table accounts            enable row level security;
alter table inspection_records  enable row level security;
alter table gas_submissions     enable row level security;
alter table image_submissions   enable row level security;
alter table remarks             enable row level security;
alter table status_entries      enable row level security;

alter table accounts            force row level security;
alter table inspection_records  force row level security;
alter table gas_submissions     force row level security;
alter table image_submissions   force row level security;
alter table remarks             force row level security;
alter table status_entries      force row level security;


-- ============================================================
-- ACCOUNTS
-- ============================================================
-- Administrators manage accounts. Inspectors see and edit only their
-- own row, and only the email that serves as their recovery contact
-- (D-01) — display name is immutable to the holder (D-04), which is
-- what keeps attribution in the history stable.

create policy accounts_admin_select on accounts
  for select using (is_administrator());

create policy accounts_admin_insert on accounts
  for insert with check (is_administrator());

create policy accounts_admin_update on accounts
  for update using (is_administrator())
  with check (is_administrator());

-- The active check matters here too. Without it a deactivated holder
-- could still read their own row, and AD-02 would be "immediate
-- except for one table".
create policy accounts_self_select on accounts
  for select using (
    id = auth.uid() and current_account_role() is not null
  );

create policy accounts_self_update on accounts
  for update using (id = auth.uid() and current_account_role() is not null)
  with check (id = auth.uid());

-- No delete policy on accounts, anywhere, for any role (A-03).
-- Deactivation is the only removal path.

-- Policies filter rows; they do not grant access. Both are required.
-- The grants below are the ceiling of what any authenticated caller
-- may attempt; the policies above decide who actually may.
grant select, insert on accounts to authenticated;
grant update (email, display_name, role, is_active) on accounts to authenticated;

-- The update grant is what administrators need. An account holder
-- editing their own row is narrowed further by the trigger below, so
-- only the email address is editable from the profile page (D-01).

create or replace function guard_self_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id and not is_administrator() then
    if new.display_name is distinct from old.display_name
       or new.role      is distinct from old.role
       or new.is_active is distinct from old.is_active then
      raise exception 'only the email address may be changed from the profile page';
    end if;
  end if;
  return new;
end;
$$;

create trigger accounts_self_field_guard
  before update on accounts
  for each row execute function guard_self_field_changes();


-- ============================================================
-- INSPECTION DATA — INSPECTORS ONLY
-- ============================================================
-- "The administrator has no access to inspection data of any kind."
-- These four tables carry no administrator policy at all, so an
-- administrator session matches nothing and reads nothing.

create policy inspection_records_read on inspection_records
  for select using (is_inspector());

create policy gas_submissions_read on gas_submissions
  for select using (is_inspector());

create policy image_submissions_read on image_submissions
  for select using (is_inspector());

create policy remarks_read on remarks
  for select using (is_inspector());

create policy status_entries_read on status_entries
  for select using (is_inspector());

-- No update or delete policy on inspection_records: final
-- classification is never editable by any user (V-02).
-- No insert policy either — records are created by the eager-creation
-- trigger, which runs security definer.


-- ============================================================
-- REMARKS AND STATUS — INSERT ONLY
-- ============================================================
-- Append-only is enforced by the absence of update and delete
-- policies, not by the UI omitting a delete button.
--
-- author_id must be the caller: an inspector cannot attribute an
-- entry to someone else (V-14).

create policy remarks_insert on remarks
  for insert with check (
    is_inspector() and author_id = auth.uid()
  );

create policy status_entries_insert on status_entries
  for insert with check (
    is_inspector() and author_id = auth.uid()
  );

-- The system-authored initial 'Open' entry (DB-02) has author_id null
-- and is written by seed_initial_status(), which runs security
-- definer and therefore does not pass through this policy. No
-- ordinary caller can create a null-authored entry.


-- ============================================================
-- GRANTS FOR INSPECTION DATA
-- ============================================================
-- Read-only on records and submissions: no grant to update or delete
-- exists for any caller, which is the first line of defence behind
-- write-once classification (V-02, V-04) and submission immutability.
--
-- Insert-only on remarks and status entries — no update, no delete —
-- which is what makes the history append-only at the permission level
-- as well as the policy level.

grant select on inspection_records  to authenticated;
grant select on gas_submissions     to authenticated;
grant select on image_submissions   to authenticated;
grant select on remarks             to authenticated;
grant select on status_entries      to authenticated;

grant insert on remarks             to authenticated;
grant insert on status_entries      to authenticated;

grant select on inspection_records_view to authenticated;


-- ============================================================
-- SUBMISSION WRITES — PENDING V-17
-- ============================================================
-- gas_submissions has no insert policy for `authenticated`: the IoT
-- device writes with its own service credential.
--
-- image_submissions likewise has no insert policy. Which credential
-- the collaborating mobile application presents, and what grants it
-- insert permission here and on the image storage bucket, is
-- V-17 — deferred, pending coordination with that team.
--
-- Everything else in this schema is already transport-agnostic: the
-- validation and fusion triggers fire on insert whatever performed
-- the insert. Resolving V-17 adds a policy here. It changes nothing
-- else.
