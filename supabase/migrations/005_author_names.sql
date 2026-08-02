-- MeatScentinel — 005 Author names
--
-- Surfaced while building the record detail timeline.
--
-- V-14 requires every remark and status entry to display the user who
-- made it. But the accounts policies in 003 let an inspector read only
-- their own row, so an inspector cannot resolve another inspector's
-- display name — the timeline would show "Inspector One" on their own
-- entries and nothing on a colleague's.
--
-- This exposes the minimum needed to satisfy the attribution
-- requirement: an id and a display name. No email, no role, no active
-- status, no User ID. security_invoker is deliberately NOT set, so the
-- view reads with owner rights and bypasses the accounts policies for
-- these two columns only.

create view author_names as
select
  id,
  display_name
from accounts;

grant select on author_names to authenticated;

-- Administrators have no reason to read this — they have no access to
-- inspection data and therefore never render a timeline — but the grant
-- is harmless: display names are already visible to them through the
-- account list.
