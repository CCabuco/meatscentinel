# MeatScentinel — Database Layer

Implements the approved Final Consolidated Requirements, the technical
architecture decisions AD-01 through AD-06, and the database decisions
DB-01 through DB-04.

## Files

Run in order. `000` is local testing only and must not be run against Supabase.

| File | Contents |
|---|---|
| `000_local_test_stubs.sql` | Stubs for `auth.users`, `auth.uid()`, and the `anon` / `authenticated` roles so the schema can run on plain Postgres. **Not deployed.** |
| `001_schema.sql` | Types, tables, constraints, indexes, records view |
| `002_functions_triggers.sql` | Eager creation, validation, fusion, write-once and append-only guards, administrator guards |
| `003_rls_policies.sql` | Grants and Row Level Security — the role boundary |
| `004_auth_helpers.sql` | User ID resolution, provisioning notes |
| `999_tests.sql` | 48 behavioural assertions. **Not deployed.** |

## Running the tests locally

```
createdb meatscentinel
psql -d meatscentinel -v ON_ERROR_STOP=1 \
  -f 000_local_test_stubs.sql \
  -f 001_schema.sql \
  -f 002_functions_triggers.sql \
  -f 003_rls_policies.sql \
  -f 004_auth_helpers.sql \
  -f 999_tests.sql
```

Expected: 48 `PASS` notices and `All assertions passed.`

## Why the logic is in the database

AD-03, AD-04, and AD-05 put fusion, validation, and access control at
the data layer rather than in application code. Three consequences worth
being able to state in defence:

- **Fusion cannot be bypassed or skipped.** It fires on insert, inside
  the same transaction, whether or not anyone is logged in.
- **Append-only is structural.** No update or delete permission on
  `remarks` or `status_entries` exists for any caller. The guarantee does
  not depend on the UI omitting a button.
- **The administrator boundary is real.** Those four tables carry no
  administrator policy at all, so an administrator token reads nothing —
  including through the records view, which uses `security_invoker`.

## Requirement traceability

| Requirement | Where |
|---|---|
| V-01 Inspection ID from the device | Natural primary key; never generated here |
| V-02 Classification and case status separate | Two enums; `case_status` has no For Review |
| V-03 Open / Under Review / Resolved | `case_status` enum |
| V-04 Fusion on pairing, written once | `run_decision_fusion`, `guard_inspection_record_update` |
| V-05 Symmetric pending | Separate submission tables, both optional |
| V-12 / V-12b User ID login and recovery | `resolve_login_email` |
| V-14 Attribution | `author_id` on both entry tables; insert policy requires `auth.uid()` |
| V-15 Combined timeline | Both tables keyed on `inspection_id` with `created_at` |
| V-16 Independent remark and status | Separate tables, no coupling |
| V-18 Validation on receipt | `validate_image_submission` |
| V-19 Newest first, pagination | `inspection_records_created_idx` |
| U-B Administrator guards | `guard_account_deactivation` |
| U-C No action logging | Deliberately absent |
| U-F Immediate deactivation | `is_active` checked in `current_account_role`, used by every policy |
| A-03 No account deletion | No delete policy or grant; `on delete restrict` |
| AD-01 User ID mapping | `resolve_login_email` |
| AD-05 Access boundary | `003_rls_policies.sql` |
| DB-01 Eager creation | `ensure_inspection_record` |
| DB-02 Initial Open status | `seed_initial_status` |
| DB-03 No sample type on image submissions | Column deliberately absent |
| DB-04 Invalid gas readings uploaded | `is_valid` on `gas_submissions` |
| Table 3 | `run_decision_fusion`; all six rows tested |

## Still open

**V-17 — submission transport and external application authentication.**

The schema is unaffected: `image_submissions` has the same shape however
rows arrive, and validation and fusion fire on insert regardless of what
performed it. What V-17 governs is write authorization — which credential
the collaborating mobile application presents, and what grants it insert
permission on `image_submissions` and on the image storage bucket.

Resolving it adds one policy to `003_rls_policies.sql`. It changes nothing
else in this layer.

## Known limitations, by decision

- **Rate limiting on `resolve_login_email` is not implemented here** and
  must be applied at the API gateway or edge function. Without it the
  function is enumerable. This is part of AD-01, not optional hardening.
- **Unpaired image submissions carry no sample type** (DB-03) and will not
  appear under a sample type filter. They remain visible under the mobile
  app submissions and pending or unmatched tabs.
- **Mistyped Inspection IDs produce permanently unpaired records** (U-D).
  Accepted; no manual pairing capability exists.
- **Administrator actions are not logged** (U-C).
