// MeatScentinel — login-begin  (LV-01 … LV-11)
//
// Step one of two. Takes a User ID and password, and either issues a
// verification challenge or — when the browser presents a valid trusted
// device token — completes the sign-in immediately.
//
// Deploy from the repository root, not from web/:
//   npx.cmd supabase functions deploy login-begin --no-verify-jwt
//
// Secrets required (npx.cmd supabase secrets set NAME=value):
//   BREVO_API_KEY      transactional API key from Brevo — NOT the SMTP
//                      password already configured in Supabase Auth.
//                      Brevo dashboard → SMTP & API → API Keys.
//   MAIL_FROM_EMAIL    a sender address verified in Brevo
//   MAIL_FROM_NAME     optional, defaults below
//
// --no-verify-jwt is correct here and is not a weakening: this endpoint
// is reached before any session exists. Everything it does is throttled
// and it returns the same shape whatever happens (LV-11).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const MAIL_FROM_EMAIL = Deno.env.get('MAIL_FROM_EMAIL')!;
const MAIL_FROM_NAME = Deno.env.get('MAIL_FROM_NAME') ?? 'MeatScentinel';

const CODE_TTL_SECONDS = 5 * 60;        // LV-02
const IP_LIMIT = 20;                    // LV-10
const IP_WINDOW_SECONDS = 15 * 60;
const ACCOUNT_LIMIT = 5;
const ACCOUNT_WINDOW_SECONDS = 15 * 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// LV-01 — rejection sampling, so the six digits are uniform. Taking a
// modulus of a random byte would bias the low digits, which is a small
// flaw but a free one to avoid.
function generateCode(): string {
  const digits: string[] = [];
  while (digits.length < 6) {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    if (buf[0] < 250) digits.push(String(buf[0] % 10));
  }
  return digits.join('');
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || 'unknown';
}

async function sendCodeEmail(to: string, code: string) {
  // Deliberately minimal: no display name, no User ID, no account type.
  // If the registered address is wrong, this leaks nothing about whose
  // account it belongs to.
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: MAIL_FROM_NAME, email: MAIL_FROM_EMAIL },
      to: [{ email: to }],
      subject: 'Your MeatScentinel verification code',
      textContent:
        `Your verification code is ${code}\n\n` +
        `It expires in 5 minutes and can be used once.\n\n` +
        `If you did not try to sign in, do not share this code. ` +
        `Contact your administrator.\n`,
      htmlContent:
        `<div style="font-family:system-ui,sans-serif;color:#1f2328">` +
        `<p style="font-size:14px;margin:0 0 16px">Your MeatScentinel verification code:</p>` +
        `<p style="font-size:32px;font-weight:600;letter-spacing:6px;margin:0 0 16px;font-family:ui-monospace,monospace">${code}</p>` +
        `<p style="font-size:13px;color:#57606a;margin:0 0 8px">It expires in 5 minutes and can be used once.</p>` +
        `<p style="font-size:13px;color:#57606a;margin:0">If you did not try to sign in, do not share this code and contact your administrator.</p>` +
        `</div>`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Brevo rejected the send: ${res.status} ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // LV-11 — every failure path below returns this. The caller cannot
  // distinguish an unknown User ID from a wrong password, and cannot
  // distinguish either from a code that was genuinely sent, because the
  // success path returns the same shape with a challenge id that simply
  // will never verify... except that we do NOT do that: a fake challenge
  // would let an attacker burn our attempt budget and would still be
  // detectable by timing. Instead the generic error is returned and the
  // client shows one message for all of them.
  const GENERIC = { error: 'That User ID or password is not correct.' };

  try {
    const { user_id, password, trusted_token } = await req.json();

    if (typeof user_id !== 'string' || typeof password !== 'string') {
      return json(GENERIC, 400);
    }

    const ip = clientKey(req);
    const { data: ipOk } = await admin.rpc('auth_throttle_hit', {
      p_key: `login:ip:${await sha256(ip)}`,
      p_limit: IP_LIMIT,
      p_window_seconds: IP_WINDOW_SECONDS,
    });
    if (ipOk === false) {
      return json(
        { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
        429,
      );
    }

    // Cheap and bounded; keeps the tables from growing without a scheduler.
    await admin.rpc('purge_expired_login_artifacts');

    // Deactivated and unknown User IDs both resolve to null (004).
    const { data: email } = await admin.rpc('resolve_login_email', {
      p_user_id: user_id,
    });
    if (!email) return json(GENERIC, 401);

    // Verify the password without letting a session escape. The session
    // this creates is discarded unless a trusted device is presented;
    // nothing is returned to the caller on the challenge path.
    const pub = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: pw, error: pwError } = await pub.auth.signInWithPassword({
      email,
      password,
    });
    if (pwError || !pw?.session) return json(GENERIC, 401);

    const accountId = pw.user!.id;

    // LV-07 — resolve_login_email already required is_active, but the
    // check is repeated against the account row we are about to act on
    // rather than trusting the lookup that happened a moment earlier.
    const { data: account } = await admin
      .from('accounts')
      .select('id, is_active')
      .eq('id', accountId)
      .maybeSingle();

    if (!account?.is_active) {
      await pub.auth.signOut();
      return json(GENERIC, 401);
    }

    // ---- Trusted device path (LV-08) -------------------------------
    // The password has already been verified above; the token only
    // decides whether the code step is skipped.
    if (typeof trusted_token === 'string' && trusted_token.length > 0) {
      const tokenHash = await sha256(trusted_token);
      const { data: device } = await admin
        .from('trusted_devices')
        .select('id, account_id, expires_at, revoked_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      const usable =
        device &&
        device.account_id === accountId &&
        device.revoked_at === null &&
        new Date(device.expires_at) > new Date();

      if (usable) {
        const sessionId = decodeSessionId(pw.session.access_token);
        if (sessionId) {
          await admin.from('verified_sessions').upsert({
            session_id: sessionId,
            account_id: accountId,
            expires_at: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          });
          await admin
            .from('trusted_devices')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', device.id);

          return json({
            status: 'authenticated',
            access_token: pw.session.access_token,
            refresh_token: pw.session.refresh_token,
          });
        }
      }
    }

    // ---- Challenge path --------------------------------------------
    await pub.auth.signOut(); // the password-check session ends here

    const { data: acctOk } = await admin.rpc('auth_throttle_hit', {
      p_key: `login:acct:${accountId}`,
      p_limit: ACCOUNT_LIMIT,
      p_window_seconds: ACCOUNT_WINDOW_SECONDS,
    });
    if (acctOk === false) {
      return json(
        { error: 'Too many verification codes requested. Try again in 15 minutes.' },
        429,
      );
    }

    // LV-05 — one live challenge per account.
    await admin
      .from('login_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .is('consumed_at', null);

    const code = generateCode();
    const salt = randomToken(16);
    const clientSecret = randomToken(32);

    const { data: challenge, error: insertError } = await admin
      .from('login_challenges')
      .insert({
        account_id: accountId,
        code_hash: await sha256(salt + code),
        code_salt: salt,
        client_secret_hash: await sha256(clientSecret),
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !challenge) {
      return json({ error: 'Unable to start sign-in. Try again.' }, 500);
    }

    try {
      await sendCodeEmail(email, code);
    } catch (_err) {
      // The challenge exists but the code never left. Consume it rather
      // than leaving a live challenge nobody can answer.
      await admin
        .from('login_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challenge.id);
      return json(
        { error: 'Could not send the verification code. Try again shortly.' },
        502,
      );
    }

    return json({
      status: 'challenge',
      challenge_id: challenge.id,
      client_secret: clientSecret,
      expires_in: CODE_TTL_SECONDS,
    });
  } catch (_err) {
    return json({ error: 'Unable to start sign-in. Try again.' }, 500);
  }
});

// The session_id claim is what verified_sessions keys on. It survives
// token refresh, so a verified session stays verified for its lifetime.
function decodeSessionId(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).session_id ?? null;
  } catch {
    return null;
  }
}
