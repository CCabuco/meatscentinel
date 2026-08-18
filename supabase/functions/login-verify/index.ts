// MeatScentinel — login-verify  (LV-01 … LV-09)
//
// Step two of two. Checks the emailed code and, only on success, mints
// the session and records it in verified_sessions — which is what makes
// it usable against the policies in 003 (see the header of 010).
//
// Also handles resends, so the resend budget is enforced server-side
// against the same challenge row rather than by a disabled button.
//
// Deploy from the repository root:
//   npx.cmd supabase functions deploy login-verify --no-verify-jwt
//
// Same secrets as login-begin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!;
const MAIL_FROM_EMAIL = Deno.env.get('MAIL_FROM_EMAIL')!;
const MAIL_FROM_NAME = Deno.env.get('MAIL_FROM_NAME') ?? 'MeatScentinel';

const MAX_ATTEMPTS = 5;              // LV-03
const MAX_RESENDS = 3;               // LV-04
const RESEND_COOLDOWN_SECONDS = 60;  // LV-04
const CODE_TTL_SECONDS = 5 * 60;     // LV-02
const TRUSTED_DAYS = 7;              // LV-08
const SESSION_RECORD_DAYS = 30;
const IP_LIMIT = 30;
const IP_WINDOW_SECONDS = 15 * 60;

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

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

// Both operands are fixed-length hex digests, so length never varies with
// the secret. Comparison is still constant-time: an early return on the
// first differing character is a timing oracle, and avoiding it costs
// nothing here.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || 'unknown';
}

async function sendCodeEmail(to: string, code: string) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
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
  if (!res.ok) throw new Error(`Brevo rejected the send: ${res.status}`);
}

function decodeSessionId(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded).session_id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json();
    const action = body.action === 'resend' ? 'resend' : 'verify';
    const { challenge_id, client_secret, code, remember_device } = body;

    if (typeof challenge_id !== 'string' || typeof client_secret !== 'string') {
      return json({ error: 'That code is not valid. Start again.' }, 400);
    }

    const { data: ipOk } = await admin.rpc('auth_throttle_hit', {
      p_key: `verify:ip:${await sha256(clientKey(req))}`,
      p_limit: IP_LIMIT,
      p_window_seconds: IP_WINDOW_SECONDS,
    });
    if (ipOk === false) {
      return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    }

    const { data: challenge } = await admin
      .from('login_challenges')
      .select(
        'id, account_id, code_hash, code_salt, client_secret_hash, expires_at, attempts, resends, last_sent_at, consumed_at',
      )
      .eq('id', challenge_id)
      .maybeSingle();

    if (!challenge || challenge.consumed_at) {
      return json({ error: 'That code has expired. Sign in again.', restart: true }, 401);
    }

    // LV-06 — the challenge belongs to the browser that started it.
    // Checked before anything else is revealed about the challenge.
    if (
      !constantTimeEqual(
        challenge.client_secret_hash,
        await sha256(client_secret),
      )
    ) {
      return json({ error: 'That code has expired. Sign in again.', restart: true }, 401);
    }

    if (new Date(challenge.expires_at) <= new Date()) {
      await admin
        .from('login_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challenge.id);
      return json({ error: 'That code has expired. Sign in again.', restart: true }, 401);
    }

    // LV-07 — re-checked here, not only at the password step. An account
    // deactivated in the last five minutes cannot finish signing in.
    const { data: account } = await admin
      .from('accounts')
      .select('id, email, is_active')
      .eq('id', challenge.account_id)
      .maybeSingle();

    if (!account?.is_active) {
      await admin
        .from('login_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challenge.id);
      return json({ error: 'That code has expired. Sign in again.', restart: true }, 401);
    }

    // ---- Resend (LV-04) --------------------------------------------
    if (action === 'resend') {
      if (challenge.resends >= MAX_RESENDS) {
        return json(
          {
            error:
              'No more codes can be sent for this attempt. Contact an administrator if the email is not arriving.',
          },
          429,
        );
      }

      const since =
        (Date.now() - new Date(challenge.last_sent_at).getTime()) / 1000;
      if (since < RESEND_COOLDOWN_SECONDS) {
        return json(
          {
            error: `Wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - since)} seconds before requesting another code.`,
            retry_after_seconds: Math.ceil(RESEND_COOLDOWN_SECONDS - since),
          },
          429,
        );
      }

      // A resend replaces the code rather than re-sending the old one, and
      // restarts the expiry. Attempts are NOT reset — otherwise resending
      // would be an unlimited way to refill the guess budget.
      const newCode = generateCode();
      const newSalt = randomToken(16);

      await admin
        .from('login_challenges')
        .update({
          code_hash: await sha256(newSalt + newCode),
          code_salt: newSalt,
          resends: challenge.resends + 1,
          last_sent_at: new Date().toISOString(),
          expires_at: new Date(
            Date.now() + CODE_TTL_SECONDS * 1000,
          ).toISOString(),
        })
        .eq('id', challenge.id);

      try {
        await sendCodeEmail(account.email, newCode);
      } catch {
        return json({ error: 'Could not send the code. Try again shortly.' }, 502);
      }

      return json({
        status: 'resent',
        resends_remaining: MAX_RESENDS - (challenge.resends + 1),
        expires_in: CODE_TTL_SECONDS,
      });
    }

    // ---- Verify (LV-01, LV-03) -------------------------------------
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      // Still counts as an attempt. A malformed code is a guess.
      await admin
        .from('login_challenges')
        .update({ attempts: challenge.attempts + 1 })
        .eq('id', challenge.id);
      return json({ error: 'That code is not correct.' }, 401);
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      await admin
        .from('login_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challenge.id);
      return json(
        { error: 'Too many incorrect codes. Sign in again.', restart: true },
        429,
      );
    }

    const supplied = await sha256(challenge.code_salt + code.trim());
    if (!constantTimeEqual(challenge.code_hash, supplied)) {
      const attempts = challenge.attempts + 1;
      await admin
        .from('login_challenges')
        .update({ attempts })
        .eq('id', challenge.id);

      const remaining = MAX_ATTEMPTS - attempts;
      if (remaining <= 0) {
        await admin
          .from('login_challenges')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', challenge.id);
        return json(
          { error: 'Too many incorrect codes. Sign in again.', restart: true },
          429,
        );
      }
      return json({
        error: `That code is not correct. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      }, 401);
    }

    // Correct. Consume first — a race that submitted the same code twice
    // must not produce two sessions.
    const { data: consumed } = await admin
      .from('login_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challenge.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle();

    if (!consumed) {
      return json({ error: 'That code has expired. Sign in again.', restart: true }, 401);
    }

    // Mint the session server-side. generateLink creates the token
    // without sending mail; verifying it here — not in the browser —
    // means the tokens only ever exist after the code was correct.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: account.email,
    });

    const hashedToken = link?.properties?.hashed_token;
    if (linkError || !hashedToken) {
      return json({ error: 'Unable to complete sign-in. Try again.' }, 500);
    }

    const pub = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await pub.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    });

    if (verifyError || !verified?.session) {
      return json({ error: 'Unable to complete sign-in. Try again.' }, 500);
    }

    const sessionId = decodeSessionId(verified.session.access_token);
    if (!sessionId) {
      return json({ error: 'Unable to complete sign-in. Try again.' }, 500);
    }

    // Without this row the session reads nothing anywhere (010).
    await admin.from('verified_sessions').insert({
      session_id: sessionId,
      account_id: account.id,
      expires_at: new Date(
        Date.now() + SESSION_RECORD_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    // ---- Trusted device (LV-08) ------------------------------------
    let trustedToken: string | null = null;
    if (remember_device === true) {
      trustedToken = randomToken(32);
      await admin.from('trusted_devices').insert({
        account_id: account.id,
        token_hash: await sha256(trustedToken),
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
        expires_at: new Date(
          Date.now() + TRUSTED_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
    }

    return json({
      status: 'authenticated',
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      trusted_token: trustedToken,
    });
  } catch (_err) {
    return json({ error: 'Unable to complete sign-in. Try again.' }, 500);
  }
});
