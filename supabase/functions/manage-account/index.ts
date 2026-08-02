// MeatScentinel — manage-account Edge Function
//
// Account creation and password resets need the Auth admin API, which
// requires a secret key. That key bypasses every Row Level Security
// policy — and RLS is the boundary that keeps administrators out of
// inspection data. So the key stays here, on the server, and never
// reaches the browser.
//
// Deploy:
//   supabase functions deploy manage-account --no-verify-jwt
//
// The --no-verify-jwt flag is required because the project uses
// publishable keys; this function verifies the caller itself, below.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// D-06 — the same password policy the client enforces, restated here.
// Client-side validation is user experience; this is the actual rule.
function passwordFails(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a special character.';
  return null;
}

// Key resolution, newest format first.
//
// SUPABASE_SECRET_KEYS is auto-injected on projects using the new key format
// and holds a JSON object keyed by name. SUPABASE_SERVICE_ROLE_KEY is the
// legacy key, which new projects often have disabled — trying it last means a
// disabled legacy key never masks a working one.
function resolveSecretKey(): { key: string | null; source: string } {
  const explicit = Deno.env.get('SERVICE_KEY');
  if (explicit) return { key: explicit, source: 'SERVICE_KEY' };

  const bundle = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle);
      const key = parsed.default ?? Object.values(parsed)[0];
      if (typeof key === 'string' && key) {
        return { key, source: 'SUPABASE_SECRET_KEYS' };
      }
    } catch {
      // fall through
    }
  }

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return { key: legacy, source: 'SUPABASE_SERVICE_ROLE_KEY (legacy)' };

  return { key: null, source: 'none' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const { key: secretKey, source: keySource } = resolveSecretKey();

  if (!url || !secretKey) {
    return json(
      {
        error:
          'No secret key is configured. Run: ' +
          'npx supabase secrets set SERVICE_KEY=sb_secret_your-key',
      },
      500,
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  // The gateway can replace Authorization with an API key when the project
  // uses publishable keys, so the client sends the session token in the body.
  // Fall back to Authorization for anything that still supplies it, ignoring
  // values that start with sb_ — those are API keys, not user sessions.
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '');
  const token = body.access_token || (bearer.startsWith('sb_') ? '' : bearer);

  if (!token) {
    return json({ error: 'No session token reached the function.' }, 401);
  }

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the caller is a signed-in, active administrator. The client
  // cannot be trusted to assert its own role — anyone can call this
  // endpoint with any body.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    const reason = userError?.message ?? 'unknown reason';

    // "Invalid API key" here is about the function's own secret key, not the
    // caller's session. It usually means SERVICE_KEY was never set and the
    // function fell back to a legacy key the project no longer accepts.
    if (/invalid api key/i.test(reason)) {
      return json(
        {
          error:
            `The function's secret key was rejected (using ${keySource}). ` +
            'Set a current one: npx supabase secrets set SERVICE_KEY=sb_secret_your-key',
        },
        500,
      );
    }

    return json({ error: `Session token rejected: ${reason}` }, 401);
  }

  const { data: caller } = await admin
    .from('accounts')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!caller) {
    return json({ error: 'No account record found for this user.' }, 403);
  }
  if (!caller.is_active) {
    return json({ error: 'This account is not active.' }, 403);
  }
  if (caller.role !== 'administrator') {
    return json({ error: 'Administrator role required.' }, 403);
  }

  if (body.action === 'create') {
    const { user_id, email, display_name, role, password } = body;

    if (!user_id || !email || !display_name || !role) {
      return json({ error: 'All fields are required.' }, 400);
    }
    if (role !== 'inspector' && role !== 'administrator') {
      return json({ error: 'Role must be inspector or administrator.' }, 400);
    }

    const pwError = passwordFails(password);
    if (pwError) return json({ error: pwError }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) return json({ error: createError.message }, 400);

    const { error: rowError } = await admin.from('accounts').insert({
      id: created.user.id,
      user_id,
      email,
      display_name,
      role,
    });

    // The auth user and the accounts row must both exist or neither
    // should. An auth user with no accounts row could authenticate and
    // then match no policy at all — a session that loads nothing.
    if (rowError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: rowError.message }, 400);
    }

    return json({ ok: true });
  }

  if (body.action === 'reset_password') {
    const { account_id, password } = body;
    if (!account_id) return json({ error: 'No account specified.' }, 400);

    const pwError = passwordFails(password);
    if (pwError) return json({ error: pwError }, 400);

    const { error } = await admin.auth.admin.updateUserById(account_id, { password });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
