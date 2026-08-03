// MeatScentinel — resolve-login Edge Function
//
// Turns a User ID into the mapped email address, with a rate limit.
//
// This endpoint is unauthenticated by necessity — it runs before sign-in.
// That makes it the one place in the system an anonymous caller can learn
// something, so it is throttled and deliberately quiet about what it knows.
//
// Deploy:
//   supabase functions deploy resolve-login --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Ten lookups per client per fifteen minutes. A real inspector who has
// forgotten their User ID will not exceed this; someone working through a
// list will, quickly.
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function resolveSecretKey(): string | null {
  const explicit = Deno.env.get('SERVICE_KEY');
  if (explicit) return explicit;

  const bundle = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle);
      const key = parsed.default ?? Object.values(parsed)[0];
      if (typeof key === 'string' && key) return key;
    } catch {
      // fall through
    }
  }

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null;
}

// x-forwarded-for is client-supplied and can be spoofed, so this is a speed
// bump rather than a wall. It stops casual enumeration from one machine,
// which is the realistic threat here. Stopping a distributed attempt would
// need infrastructure beyond what this project has.
function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim();
  return first || req.headers.get('cf-connecting-ip') || 'unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = resolveSecretKey();

  if (!url || !secretKey) {
    return json({ error: 'The function is not configured with a secret key.' }, 500);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const userId = String(body.user_id ?? '').trim();

  // Reject anything that could not be a User ID before spending a lookup on
  // it. This costs an attempt too — otherwise malformed input would be a free
  // way to probe timing.
  const plausible = /^[A-Za-z0-9-]{4,32}$/.test(userId);

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const key = clientKey(req);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count } = await admin
    .from('login_lookup_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('client_key', key)
    .gte('attempted_at', since);

  if ((count ?? 0) >= MAX_ATTEMPTS) {
    return json(
      {
        error:
          'Too many attempts. Wait a few minutes before trying again.',
        retry_after_minutes: WINDOW_MINUTES,
      },
      429,
    );
  }

  await admin.from('login_lookup_attempts').insert({ client_key: key });

  // Opportunistic cleanup, so no scheduled job is needed.
  if (Math.random() < 0.05) {
    await admin.rpc('prune_login_lookup_attempts');
  }

  if (!plausible) {
    return json({ email: null });
  }

  const { data, error } = await admin.rpc('resolve_login_email', {
    p_user_id: userId,
  });

  if (error) {
    return json({ error: 'Lookup failed. Try again.' }, 500);
  }

  // A null email means unknown or deactivated. The caller cannot tell which,
  // and cannot tell an unknown User ID from a known one with a wrong
  // password — the sign-in form reports the same message either way.
  return json({ email: data ?? null });
});
