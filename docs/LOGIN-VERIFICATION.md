# Login verification — deployment and design notes

Sign-in is two steps: User ID and password, then a six-digit code sent to
the email address registered on the account.

---

## What to claim, and what not to claim

This **supports** the authenticity and confidentiality sub-characteristics
of ISO/IEC 25010. Use that wording, in the same way the password policy is
framed as supporting 25010 rather than complying with it — 25010 is a
software quality model, not a credential standard.

Do **not** describe it as multi-factor authentication in the NIST sense.
NIST SP 800-63B does not accept email as an out-of-band authentication
channel, because a mailbox is another account rather than a possessed
device. In this system that objection is concrete: password recovery
already sends a reset link to the same mailbox, so a compromised mailbox
defeats both controls at once.

What it does defend against — and this is the attack that actually
happens — is a password that has been leaked, guessed, shared, or reused
from another site. That is worth stating plainly and is defensible.

If a panel member asks whether this is true MFA, the answer is no, and
saying so first is stronger than being corrected.

---

## Why the code cannot be enforced in the login page

The publishable key permits `auth.signInWithPassword` from any browser
console. A login form that "requires" a code is bypassed by one direct
call, and the code becomes decoration.

So enforcement lives in the database. `login-verify` mints the session
server-side and records its `session_id` in `verified_sessions`.
`current_account_role()` — which every policy in `003` already funnels
through — now additionally requires that row. A session obtained any
other way resolves to a null role and matches no policy on any table:
the password grant still works, it just produces a session that can read
nothing.

That is why the change to `003`'s helper is one function rather than a
new condition on each policy. A policy written later cannot forget the
check.

---

## Deployment

**1. Run the migration.** Supabase dashboard → SQL editor:

```
supabase/migrations/010_login_verification.sql
```

**2. Create a Brevo API key.** This is *not* the SMTP password already
configured in Supabase Auth. Supabase Auth's SMTP settings only send
Supabase's own emails; the verification code is sent by our edge
function, which needs Brevo's HTTP API.

Brevo dashboard → **SMTP & API** → **API Keys** → Generate a new key.

**3. Set the secrets.** From the repository root:

```
npx.cmd supabase secrets set BREVO_API_KEY=xkeysib-...
npx.cmd supabase secrets set MAIL_FROM_EMAIL=noreply@yourdomain
npx.cmd supabase secrets set MAIL_FROM_NAME=MeatScentinel
```

`MAIL_FROM_EMAIL` must be a sender Brevo has verified, or every send is
rejected with a 401 and no code ever arrives.

**4. Deploy both functions**, from the repository root, not from `web/`:

```
npx.cmd supabase functions deploy login-begin --no-verify-jwt
npx.cmd supabase functions deploy login-verify --no-verify-jwt
```

`--no-verify-jwt` is correct: both are reached before any session exists.

**5. Deploy the web app.** No new environment variables are needed in
Vercel.

---

## Verifying it works

Sign in normally, confirm the code arrives and is accepted. Then check
the part that matters — that the gate is real, not cosmetic. In the
browser console on the deployed site, before signing in:

```js
const { data } = await supabase.auth.signInWithPassword({
  email: 'a-known-account@example.com', password: 'the-real-password'
});
// A session is returned. Now try to use it:
await supabase.from('accounts').select('*');   // → zero rows
await supabase.rpc('login_session_state');     // → 'unverified'
```

A session that skipped the code reads nothing. That demonstration is
worth keeping for the defense; it is the difference between a security
control and a form field.

Also confirm password recovery still works end to end. A recovery link
produces an unverified session on purpose, and `login_session_state()`
returning `unverified` is what stops `AuthContext` from mistaking it for
a deactivated account and signing the user out mid-reset.

---

## The controls, and why each number

| Control | Value | Reasoning |
|---|---|---|
| Code length | 6 digits | 1 in 1,000,000 per guess, against a 5-attempt budget |
| Generation | CSPRNG, rejection sampled | `Math.random` is predictable; a plain modulus biases low digits |
| Storage | salted SHA-256 only | A dump of `login_challenges` is not a set of working codes |
| Expiry | 5 minutes | Long enough for Brevo delivery, short enough to limit exposure |
| Attempts | 5 per challenge | Then consumed; recovery is to start again with the password |
| Resends | 3, 60s apart | Limits mailbox flooding and Brevo quota burn |
| Resend behaviour | new code, attempts NOT reset | Otherwise resending refills the guess budget without limit |
| Per-IP throttle | 20 begins / 30 verifies per 15 min | Blunts distributed guessing |
| Per-account throttle | 5 challenges per 15 min | Stops using someone's inbox as a target |
| Challenge binding | random client secret | A code cannot be redeemed from another browser |
| Single use | consumed atomically | A double submit cannot mint two sessions |
| `is_active` | re-checked at verification | Deactivation mid-login cannot be outrun |
| Response shape | identical for all failures | The code screen is not an enumeration oracle |
| Trusted device | 7 days, opt-in, off by default | NMIS workstations are shared |
| Revocation | password change, email change, deactivation | All three are credential events |

---

## Known limitations, recorded rather than hidden

**The trusted-device token lives in `localStorage`.** The edge functions
are on `supabase.co` and the app is on `vercel.app`, so an httpOnly
cookie cannot be shared between them. An XSS bug in the application could
read the token. It is accepted because the token grants nothing without
the password, is bound to one account, expires in seven days, and is
revoked on any credential change — but it is a real trade-off, not an
oversight.

**No login audit log.** Consistent with U-C, which declined audit logging
for account administration. The throttle and challenge tables record
recent activity incidentally, but there is no retained record of who
signed in when. If this is ever wanted it is a deliberate reversal, not
an oversight to be quietly filled in.

**Email delivery is now on the critical path for every login.** If Brevo
is down or an account's registered address is wrong, that user cannot
sign in and there is no bypass — by decision. An administrator correcting
the address, or resetting the password, is the only recovery. Watch the
Brevo sending quota: every login now costs one email.

**Sign-out does not clear the trusted device.** "Remember this device for
7 days" would otherwise mean "until you log out", which is not what the
checkbox says.
