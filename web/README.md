# MeatScentinel — Web Application

React + Vite frontend for the MeatScentinel inspection portal, wired to Supabase.

All modules built: authentication, Dashboard, Inspection Records Management,
Record Details, Profile and Account, Administrator account management.

## Setup

You need the database layer running first. The app will not sign anyone in
without `resolve_login_email` and the `accounts` table.

### 1. Create the Supabase project

Then run the migrations from the `meatscentinel-db` folder, in order, in the
SQL editor:

```
001_schema.sql
002_functions_triggers.sql
003_rls_policies.sql
004_auth_helpers.sql
005_author_names.sql
006_storage_policies.sql
```

`005` was added during Phase 2. V-14 requires every remark and status entry to
display who made it, but the account policies let an inspector read only their
own row — so a colleague's entries would show no author. It exposes a view of
`id` and `display_name` only, and nothing else.

Do **not** run `000_local_test_stubs.sql` or `999_tests.sql` — those are for
local Postgres only. Supabase already provides `auth.users`, `auth.uid()`, and
the `anon` / `authenticated` roles.

### 2. Create the first administrator

Per A-06, the first administrator is provisioned during deployment, not through
the application.

1. Authentication → Users → Add user. Set an email and password. Copy the UUID.
2. SQL editor:

```sql
insert into accounts (id, user_id, email, display_name, role)
values (
  '<uuid from step 1>',
  'ADMN-001',
  '<the same email>',
  'Your Name',
  'administrator'
);
```

The email in `accounts` must match the auth user's email — that mapping is what
`resolve_login_email` resolves at sign-in.

### 3. Create the image storage bucket

Storage → New bucket → name it `inspection-images`, keep it **private**. The app
requests short-lived signed URLs; a public bucket would make every inspection
photo reachable by anyone with the path.

If you rename it, update `IMAGE_BUCKET` in `src/lib/records.js`.

Run `006_storage_policies.sql` **after** creating the bucket. Signed URLs need
read permission on the object, and `storage.objects` has its own policies
separate from the table policies in `003` — without it, every image request
fails and the detail page reports that the image could not be loaded.

### 4. Configure the app

```
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
Project Settings → API.

The anon key is safe in the client: it grants nothing on its own. Every table is
protected by Row Level Security. Do not put the **service role** key here — that
key bypasses RLS entirely.

### 5. Run

```
npm install
npm run dev
```

Sign in with `ADMN-001` and the password from step 1. You should land on the
account list, not a dashboard (A-05).

## What Phase 1 implements

| Decision | Where |
|---|---|
| V-12 — User ID login, mapped internally to email | `src/lib/auth.js` |
| V-12b — recovery by User ID, link to mapped email | `src/pages/RecoveryPage.jsx` |
| V-13 / A-05 — role-based routing and landing | `src/components/RouteGuard.jsx` |
| AD-01 — resolution through `resolve_login_email` | `src/lib/auth.js` |
| AD-02 / U-F — deactivation ends the session immediately | `src/context/AuthContext.jsx` |
| D-01 / D-02 — read-only identity, editable email | `src/pages/ProfilePage.jsx` |
| D-03 — logout in the global side navigation | `src/components/AppShell.jsx` |
| D-05 — current password required to change it | `src/lib/auth.js` |
| D-06 — strength policy with live feedback | `src/lib/passwordPolicy.js` |
| D-07 / D-08 — email as recovery contact | `src/pages/ProfilePage.jsx` |

## What Phase 2 implements

| Decision | Where |
|---|---|
| V-10 — overlapping tabs, a paired record appears under three | `src/lib/records.js` |
| V-11 — source type filter kept alongside the tabs | `src/lib/records.js` |
| V-19 — newest first, with pagination | `src/lib/records.js` |
| V-02 / V-03 — classification and case status shown as distinct fields | `src/components/Badge.jsx` |
| V-14 — every entry carries its author and timestamp | `src/lib/records.js` |
| V-15 — one combined chronological timeline | `src/pages/RecordDetailPage.jsx` |
| V-16 — remark and status are two independent forms | `src/pages/RecordDetailPage.jsx` |
| DB-02 — the seeded Open entry displays as authored by "System" | `src/lib/records.js` |
| DB-03 — sample type filter caveat surfaced in the UI | `src/pages/RecordsPage.jsx` |

### How deactivation surfaces in the client

Every RLS policy requires `is_active`, including the one on `accounts`. So a
deactivated user's own row becomes unreadable the moment the flag flips, even
though their token has not expired. `AuthContext` treats "session exists but no
account row" as deactivated and signs out. That is AD-02 working end to end —
the client is not deciding anything, it is reacting to the data layer refusing.

## Two things to be aware of

**Password change re-authenticates.** Supabase's `updateUser` does not verify the
current password, so `changePassword` signs in again with the current password
first. Without that, anyone at an unattended logged-in screen could set a new
password without knowing the old one — which is what D-05 exists to prevent.

**Recovery does not reveal the destination address.** The confirmation reads the
same whether or not the User ID exists. Showing the address would help someone
who has forgotten which one is registered, but would also disclose it to anyone
who guessed a valid User ID. Flagged earlier as a UI decision; this is the
choice made, and it is easy to reverse in `RecoveryPage.jsx`.

## Deploying the account management function

Account creation and administrator-triggered password resets need the Auth
admin API, which requires a secret key. That key bypasses every Row Level
Security policy — and RLS is the boundary keeping administrators out of
inspection data — so it stays server-side.

```
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set SERVICE_KEY=sb_secret_your-secret-key
supabase functions deploy manage-account --no-verify-jwt
```

`--no-verify-jwt` is required because the project uses publishable keys. The
function verifies the caller itself: it reads the bearer token, resolves the
account, and refuses anything that is not an active administrator. The client
cannot assert its own role — anyone can call the endpoint with any body.

Until this is deployed, the account list still loads, and deactivate and
reactivate still work — those go straight to the table. Only creation and
password reset need the function.

## Two notes on the records module

**Filters combine rather than replace.** The requirements name the five filter
dimensions without stating whether they AND together or override each other.
AND is the reading taken here — applying sample type and case status narrows to
records matching both. Easy to change in `applyFilters` if you meant otherwise.

**Case status filtering is a correlated subquery.** `current_case_status` is
derived in the view as "the most recent status entry", so filtering on it
evaluates per row. It is indexed and fine at capstone scale. If record counts
grow into the tens of thousands, that filter is the first thing to feel slow.

## Still open

**V-17** — submission transport and external application authentication. It does
not affect this phase. It governs how the collaborating mobile application
writes to `image_submissions`, not how inspectors read from it.

**Rate limiting on `resolve_login_email`** must be applied at the edge, not in
Postgres. Without it the function is enumerable: valid User ID guesses return
registered email addresses. This is part of AD-01, not optional hardening.

## On the two administrator guards

`U-B` specifies two: an administrator cannot deactivate their own account, and
the last remaining active administrator cannot be deactivated. Both are database
triggers, so they hold regardless of what the client sends.

Worth knowing how they divide the work. Inside the application the second is
largely redundant — an administrator deactivating someone else is themselves
active, so the target is never the last one. Where it earns its place is the
SQL editor, where `auth.uid()` is null and the self-deactivation guard cannot
fire. That is the realistic lockout: someone tidying up accounts by hand and
switching off the wrong row.

## Next

Nothing outstanding except V-17.
