# MeatScentinel — start here

Two folders:

- `database/` — SQL files you paste into the Supabase SQL editor. Nothing to install.
- `web/` — the React application. This is the folder you open in a terminal.

Your Supabase URL and publishable key are already filled into `web/.env`.
That key is designed to be public — it grants nothing on its own, because every
table is protected by Row Level Security.

---

## Step 1 — Run the first five migrations

Supabase dashboard → SQL editor → New query.

Open each file in a text editor, copy all of it, paste, click Run.
**One file at a time, in this order:**

1. `database/001_schema.sql`
2. `database/002_functions_triggers.sql`
3. `database/003_rls_policies.sql`
4. `database/004_auth_helpers.sql`
5. `database/005_author_names.sql`

Do **not** run `000_local_test_stubs.sql` or `999_tests.sql`. Those exist only for
testing on a plain Postgres install. Supabase already provides what `000` creates,
so running it will fail.

Run them separately, not all pasted together. If one fails you want to know which.

---

## Step 2 — Create the storage bucket

Storage → New bucket.

- Name: `inspection-images` (exactly this)
- Public bucket: **leave unchecked**

Private matters. The app requests short-lived signed URLs. A public bucket would
make every inspection photo reachable by anyone who guesses the path.

Now go back to the SQL editor and run the sixth migration:

6. `database/006_storage_policies.sql`

It has to come after the bucket exists. Signed URLs need read permission on the
object, and storage has its own policies separate from the table policies in `003`.

---

## Step 3 — Create the first administrator

Two parts. The email must match between them or login will fail silently.

**3a.** Authentication → Users → Add user → Create new user.
Set an email you can actually receive mail at, and a password that meets the
policy (8+ characters, uppercase, lowercase, number, special character).
Copy the UUID it generates.

**3b.** SQL editor, new query:

```sql
insert into accounts (id, user_id, email, display_name, role)
values (
  'paste-the-uuid-from-step-3a',
  'ADMN-001',
  'the-exact-same-email@example.com',
  'Your Name',
  'administrator'
);
```

Why the email has to match: you log in with a User ID, and the system looks up
the mapped email to authenticate against. If they differ, it resolves an address
that does not exist in auth and the sign-in fails with no useful message.

---

## Step 4 — Run the web application

Open a terminal. Navigate into the `web` folder:

```
cd path/to/meatscentinel/web
npm install
npm run dev
```

On Windows PowerShell, if `npm` is blocked by the execution policy, use
`npm.cmd install` and `npm.cmd run dev` instead.

`npm install` takes a minute or two the first time and creates a `node_modules`
folder. That folder is generated — never edit it, never commit it.

The terminal will print a local address, usually `http://localhost:5173`.

---

## Step 5 — Confirm it works

Log in with `ADMN-001` and your password.

- You should land on the account list, **not** a dashboard
- Type `/dashboard` into the address bar — it should send you straight back

That one check proves authentication, the User ID lookup, role loading, and route
guarding are all working together.

---

## Step 6 — Deploy the account management function

Creating accounts and resetting passwords need the Auth admin API, which requires
a secret key. That key bypasses every Row Level Security policy — and RLS is what
keeps administrators out of inspection data — so it must never reach the browser.
It lives in a small server-side function instead.

```
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set SERVICE_KEY=sb_secret_your-secret-key
supabase functions deploy manage-account --no-verify-jwt
```

Get the secret key from Project Settings → API Keys → Secret keys.
It goes into that command only. Never into `.env`, never into any file in `web/`.

Until this is deployed the account list still loads, and deactivate and reactivate
still work — those go straight to the table. Only account creation and password
reset need the function.

---

## What is built

Every module: login and password recovery, dashboard, inspection records
management, record detail with remarks and status history, profile and account,
and administrator account management.

Create your first test inspector the same way as Step 3, using role `inspector`
and a User ID like `INSP-001`. After Step 6 you can create accounts from the
administrator account list instead.

To see the records list populate, insert test rows in the SQL editor:

```sql
insert into gas_submissions
  (inspection_id, sample_type, nh3_ppm, h2s_ppm, gas_result, is_valid, detected_at)
values ('MS-000001', 'chicken', 12.50, 3.10, 'Fresh', true, now());

insert into image_submissions
  (inspection_id, image_result, image_path, submitted_at)
values ('MS-000001', 'Fresh', 'img/sample1.jpg', now());
```

The second insert completes the pair, so fusion runs automatically and the record
gets its classification. Insert only the first and you get a Pending record
instead — worth seeing, since that is what an unpaired record looks like.

---

## If a page loads blank

With Row Level Security on, a mismatch returns no rows rather than an error, so
problems look like empty screens. Check in this order:

1. Does the signed-in user have a row in `accounts`?
   No row means every policy denies. That is the deactivation mechanism working,
   not a bug.
2. Is `is_active` true on that row?
3. Is `role` exactly `inspector` or `administrator`?

---

## Never put this in the web folder

The **secret key** (`sb_secret_...`) and the legacy `service_role` key bypass all
Row Level Security. RLS is the boundary that keeps administrators out of
inspection data — putting a secret key in the frontend would make that guarantee
false. Only the publishable key belongs in `.env`.

---

## Still open

**V-17** — how the collaborating mobile application writes to `image_submissions`
and uploads image files. Deferred pending coordination with that team. Until it is
resolved, insert image submissions and upload images through the Supabase
dashboard.

Nothing else in the system depends on the answer: validation and fusion fire on
insert, whatever performed the insert. Resolving V-17 adds one policy to
`003_rls_policies.sql` and one to `006_storage_policies.sql`.
