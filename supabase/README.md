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
| `011_administrator_inspection_access.sql` | Extends inspection reads and attributed remark/status inserts to administrators; requires migration 010 |
| `tests/011_administrator_inspection_access.sql` | Current role-access regression checks; all fixtures and writes are rolled back |
| `012_inspector_activity_log.sql` | Admin-only, append-only inspector activity; database triggers and restricted viewing/logout RPCs |
| `tests/012_inspector_activity_log.sql` | Activity capture, access, attribution, deduplication, privacy, and logout checks; rolled back |
| `999_tests.sql` | 48 behavioural assertions. **Not deployed.** |

## Running the original schema tests locally

These tests cover migrations 001–004, including the original administrator
restriction. For the current permissions after migration 011, run the separate
role-access checks below.

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

## Current administrator inspection access

Migration `011_administrator_inspection_access.sql` allows active, verified
administrators to read inspection records, results, images, and history, and
append their own remarks and case statuses. Account management remains restricted
to administrators. Classification, submission, and history immutability remain
enforced. This supersedes the original administrator restriction in migration 003.

After applying migration 011, run from the repository root with an authorized
database owner connection:

```powershell
npx.cmd supabase db query --linked --file supabase/tests/011_administrator_inspection_access.sql
```

The checks cover administrator access, inspector account isolation, inactive and
unverified sessions, author attribution, image bucket isolation, and immutable
records. Synthetic accounts, sessions, records, and storage metadata exist only
inside the test transaction and are rolled back.

## Inspector activity log

Migration 012 implements the October 24, 2026 decision to log **actions plus
viewing**, superseding the original no-action-logging requirement for inspectors.
The admin-only Activity Log filters by inspector User ID, inspection ID, action,
and dates. Dates use Philippine time (UTC+8). Record history also shows inspector
viewing events to administrators, alongside the existing remarks and statuses.

Recorded from activation onward:

- Completed verified sign-ins (including trusted-device sign-ins) and explicit
  sign-outs from the updated web app. Token refreshes and browser closures are
  not new sign-ins/sign-outs.
- Inspector remarks and case-status inserts, captured in the same transaction as
  the action. System initial status and administrator inspection actions are
  excluded from this inspector log; they remain in normal record history.
- Changes to inspector account email, display name, role, and active status,
  with before/after values. Changes initiated by an identifiable administrator
  name that administrator as actor.
- Password updates (event only), pending email change requests/cancellations,
  and confirmed email changes. Auth-service updates with no known actor show
  System / authentication service and the affected inspector.
- Inspection details displayed and images successfully loaded in the app.
  These are explicitly labelled app reports. They cannot prove attention or
  detect direct API reads, copied image URLs, old app versions, or a modified
  client that suppresses reports. Reporting failures show a retry notice.

Passwords, password hashes, verification codes, bearer tokens, and arbitrary
request bodies are never copied to activity details. Identity and action details
are snapshots. Only active, verified administrators can read the log. Browser
clients cannot directly insert, update, delete, or truncate it; viewing RPCs only
accept the two viewing action types and derive the caller/time themselves.
There is no automatic retention/deletion job. Earlier activity is not invented
or backfilled; original remarks and statuses remain available in record history.

The logout RPC revokes the current verified app session atomically with its
activity entry before the browser calls Supabase Auth sign-out. It is idempotent.
Automatic session expiry/deactivation is not presented as a manual sign-out.

Run the regression checks after migration 012:

```powershell
npx.cmd supabase db query --linked --file supabase/tests/012_inspector_activity_log.sql
```

All synthetic fixtures and changes are rolled back. Production test-data cleanup
now also needs to account for activity foreign keys and append-only protection;
do not disable these protections during normal operation.

## Customer Reports: external CheckMeat scans

Apply `migrations/013_customer_reports.sql` after 012 and deploy
`functions/customer-reports/index.ts` with `--no-verify-jwt`. The function
authenticates the caller itself and requires an active, verified inspector or
administrator session before connecting to CheckMeat.

The source of customer reports is **another Supabase project**:
`flurlbxydnnpmccsashm`, table `scans`. Its `reports` complaint table is not used.
No customer accounts or mobile inspections are created by MeatScentinel.

Configure these secrets in the **MeatScentinel** project's Edge Functions settings:

- `CHECKMEAT_PUBLISHABLE_KEY`: the external project's publishable or legacy anon key.
- `CHECKMEAT_INSPECTOR_EMAIL`: the external staff account email (inspector or admin).
- `CHECKMEAT_INSPECTOR_PASSWORD`: its password, entered only in the secret manager.

The connector signs in as that staff account and reads through the external project's
RLS. External service keys are rejected. The external account must have role
`inspector` or `admin`, matching CheckMeat's `scans_select_staff` policy, with
authenticated access to `scans` and `meat_types`. The secret names remain unchanged.
A successful
SQL Dashboard query does not prove that this account can read through RLS.

The Customer Reports page refreshes 200 scans at a time, newest first. Load older
scans continues with a timestamp/UUID cursor. The local `customer_reports` table
is a display cache of scan ID, meat type, mobile classification, score, source
timestamp, and last refresh time. Existing cached reports remain available when
the external app is unreachable. Remote edits are reflected when the relevant
batch is refreshed; remote deletions are not automatically purged locally.
Customer profiles, credentials, and image URLs are not stored in this cache.

`customer_report_assignments` stores the local inspector assignment and optional
inspection link. Authenticated clients have read access only; the restricted
`manage_customer_report` RPC handles writes, locks claims, checks stale versions,
and restricts assignment to administrators and active inspector targets.
Inspectors can claim unassigned reports. Only the assignee or an administrator
can link an assigned report to an existing inspection. The link is one-to-one
and cannot be edited through this workflow. Reassignments update the inspector
shown on the linked inspection. Assignee names/IDs are snapshots at assignment.

Claim, assignment, reassignment, and link events append to the administrator's
Activity Log. Opening a report and successfully loading its image are app-reported
inspector viewing events with retry notices. Linking does **not** create an
`image_submissions` row, copy a photo, or run fusion; that integration remains a
separate task. Classification and original submission guards remain in place.

Photos are requested on demand through the external inspector session using the
`scan-photos` bucket, with short-lived signed URLs. Existing public scan-photo
URLs from that project are also supported. At implementation time the external
storage SELECT policy permitted owners only. Their team must authorize inspector
photo reads for private images to work; this function never bypasses that policy.

## Inspection notifications

### Organization

- Inspectors: **Notifications → My notifications / Email preferences**. Profile
  also links to preferences. Email uses the account's registered address, including
  Gmail; no separate email address or Gmail credentials are needed.
- Administrators: **Notification management → Delivery log / Delivery settings /
  Inspector preferences / Management history**. Personal opt-outs cannot be
  overridden by administrators. Global settings can pause all delivery or disable
  individual categories. Global pause holds pending mail; disabling a category
  skips it. Login codes, recovery, and email-change verification are unaffected.

Email and four categories default on for new preferences: assignments, remarks,
case status, and results/linked reports. Notification history is retained in the
portal even when email is off. Saving preferences affects subsequent events and
mail still awaiting processing; mail already accepted by Brevo cannot be recalled.

### Events and recipients

Triggers enqueue notifications in the same transaction as the change. No event
is created for rolled-back changes, ordinary viewing, or unchanged refresh data.

| Event | Recipient | Category |
|---|---|---|
| Assign or claim a report | New assigned inspector | Assignments |
| Reassign a report | Previous and new assigned inspectors | Assignments |
| Link a report to an inspection | Assigned inspector | Results |
| Add a remark | Currently assigned inspector | Remarks |
| Append case status | Currently assigned inspector | Case status |
| Receive gas/image submission | Currently assigned inspector | Results |
| Write final classification | Currently assigned inspector | Results |
| Refresh changed mobile meat type, result, score, or scan time | Assigned inspector | Results |

Assignments currently come from `customer_report_assignments`; standalone
inspections without an assigned linked report have no recipient. Mobile changes
are detected when those scans are refreshed, not by subscribing to the external
database. Inspectors receive events for their own actions too. Existing records
are not backfilled. Immutable submissions, append-only remarks/status, and
write-once classification remain enforced. Notification email does not introduce
inspection editing or weaken any existing guard.

### Delivery and deployment

1. Apply `014_inspection_notifications.sql` after 013.
2. Set a random `NOTIFICATION_WORKER_SECRET` in the project's Edge Function
   secrets; store the same value in Supabase Vault as `notification_worker_secret`.
   Never commit the value. The scheduler uses this scoped credential, not a
   browser key. It authenticates only the notification worker.
3. Deploy `send-inspection-notifications --no-verify-jwt`. The worker checks its
   own shared secret. It reuses `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`,
   `SERVICE_KEY`, and `SUPABASE_URL` from existing configuration.
4. Apply `015_notification_schedule.sql` to enable pg_cron/pg_net and schedule
   `meatscentinel-inspection-email` once a minute. It calls the worker only when
   delivery is enabled and mail is due. Each call processes up to five emails.
5. Publish the frontend to make `/notifications` and its preference links available
   on the public site. `NOTIFICATION_APP_URL` defaults to
   `https://meatscentinel.vercel.app`; override only for another supported frontend.

The queue uses row locks and leases to prevent concurrent duplicate sends. Brevo
receives the notification UUID as its idempotency key. Rate-limit responses retry
with backoff, up to five automatic attempts. Network timeouts, server errors, and
expired worker leases become **Uncertain** instead of blindly retrying. Admins
must review Brevo's transactional log before explicitly retrying an uncertain
message; provider idempotency expires, so a duplicate remains possible.

Delivery statuses are **Queued**, **Sending**, **Accepted by email provider**,
**Failed**, **Uncertain**, and **Email skipped**. Accepted does not mean delivered
to a Gmail inbox; bounce/delivery webhooks are not implemented. Queued messages
older than seven days are skipped. Deactivated accounts, opt-outs, and obsolete
assignments are checked again before sending. Emails include a concise event
summary, a reference, and authenticated portal links; remark contents and images
are not embedded. Notification settings changes and manual retries are recorded
in append-only `notification_management_history`.

Implementation references: [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[Brevo transactional email](https://developers.brevo.com/reference/send-transac-email),
[Brevo idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).

## Why the logic is in the database

AD-03, AD-04, and AD-05 put fusion, validation, and access control at
the data layer rather than in application code. Three consequences worth
being able to state in defence:

- **Fusion cannot be bypassed or skipped.** It fires on insert, inside
  the same transaction, whether or not anyone is logged in.
- **Append-only is structural.** No update or delete permission on
  `remarks` or `status_entries` exists for any caller. The guarantee does
  not depend on the UI omitting a button.
- **Role permissions are enforced in the database.** Both roles can use
  inspections after migration 011; only administrators manage accounts. The
  records view uses `security_invoker` to preserve the caller's access checks.

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
| U-C Original no-action-logging requirement | Superseded for inspector activity by migration 012 and the October 24, 2026 decision |
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
- **Administrator inspection actions** remain in the original remarks/status
  history. The new activity log focuses on inspectors and changes to their accounts.
