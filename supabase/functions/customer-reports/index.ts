import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXTERNAL_URL = 'https://flurlbxydnnpmccsashm.supabase.co';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  let external: ReturnType<typeof createClient> | undefined;
  try {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return json({ error: 'Report service is not configured.' }, 503);
    const token = body.access_token || req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (typeof token !== 'string') return json({ error: 'Sign in to continue.' }, 401);
    const admin = createClient(url, key, options);
    const { data: identity, error: authError } = await admin.auth.getUser(token);
    if (authError || !identity.user) return json({ error: 'Sign in to continue.' }, 401);
    // Use the caller's JWT for the same active-account + verified-session gate as RLS.
    const caller = createClient(url, key, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: role, error: roleError } = await caller.rpc('current_account_role');
    if (roleError || !['inspector', 'administrator'].includes(role)) {
      return json({ error: 'A verified staff session is required.' }, 403);
    }
    if (!['sync', 'image'].includes(body.action)) return json({ error: 'Unknown action.' }, 400);
    const externalKey = Deno.env.get('CHECKMEAT_PUBLISHABLE_KEY');
    const email = Deno.env.get('CHECKMEAT_INSPECTOR_EMAIL');
    const password = Deno.env.get('CHECKMEAT_INSPECTOR_PASSWORD');
    if (!externalKey || !email || !password) {
      return json({ error: 'CheckMeat connection is awaiting its inspector credentials. Saved reports remain available.' }, 503);
    }
    // Reject privileged external keys: all reads must pass CheckMeat's own RLS.
    let keyRole = '';
    if (externalKey.split('.').length === 3) {
      try {
        const part = externalKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        keyRole = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))).role;
      } catch { return json({ error: 'Invalid CheckMeat public key configuration.' }, 503); }
    }
    if (!externalKey.startsWith('sb_publishable_') && keyRole !== 'anon') {
      return json({ error: 'Configure a CheckMeat publishable or anon key.' }, 503);
    }
    external = createClient(EXTERNAL_URL, externalKey, options);
    const { error: signInError } = await external.auth.signInWithPassword({ email, password });
    if (signInError) return json({ error: 'CheckMeat inspector sign-in failed. Check the configured credentials.' }, 502);
    const { data: remoteRole, error: remoteRoleError } = await external.rpc('get_my_role');
    if (remoteRoleError) {
      return json({ error: 'Could not verify the CheckMeat connection account role. Check access to get_my_role in the external project.' }, 502);
    }
    // Match CheckMeat's scans_select_staff policy; all reads still use its RLS.
    if (!['inspector', 'admin'].includes(remoteRole)) {
      return json({ error: 'The configured CheckMeat connection account must have the inspector or admin role in CheckMeat.' }, 403);
    }
    if (body.action === 'image') {
      if (typeof body.scan_id !== 'string' || !UUID.test(body.scan_id)) return json({ error: 'Invalid scan ID.' }, 400);
      const { data: scan, error } = await external.from('scans').select('image_path,image_url').eq('scan_id', body.scan_id).maybeSingle();
      if (error || !scan) return json({ error: 'The scan is unavailable to the CheckMeat inspector account.' }, 404);
      if (scan.image_path) {
        const { data } = await external.storage.from('scan-photos').createSignedUrl(scan.image_path, 300);
        if (data?.signedUrl) return json({ url: data.signedUrl });
      }
      // Only public scan-photo URLs from the known project are accepted.
      // Stored signed URLs may expire; generate fresh ones above using the inspector session.
      if (typeof scan.image_url === 'string') {
        try {
          const image = new URL(scan.image_url);
          if (image.origin === EXTERNAL_URL && image.pathname.startsWith('/storage/v1/object/public/scan-photos/')) {
            return json({ url: image.href });
          }
        } catch { /* No usable image URL. */ }
      }
      return json({ error: 'Image unavailable. CheckMeat must allow its inspector account to read this scan photo.' }, 403);
    }
    let query = external.from('scans').select('scan_id,meat_type_id,classification,confidence_score,scanned_at')
      .order('scanned_at', { ascending: false }).order('scan_id', { ascending: false }).limit(200);
    if (body.before) {
      const { at, id } = body.before;
      if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(at)
        || !Number.isFinite(Date.parse(at)) || typeof id !== 'string' || !UUID.test(id)) {
        return json({ error: 'Invalid report cursor.' }, 400);
      }
      // Preserve Postgres microseconds: Date.toISOString would truncate the cursor.
      const time = at;
      query = query.or(`scanned_at.lt.${time},and(scanned_at.eq.${time},scan_id.lt.${id})`);
    }
    const [{ data: scans, error }, { data: types, error: typesError }] = await Promise.all([
      query, external.from('meat_types').select('meat_type_id,name'),
    ]);
    if (error || typesError) return json({ error: 'CheckMeat denied or could not complete the scan read.' }, 502);
    const names = new Map((types ?? []).map((type) => [type.meat_type_id, type.name]));
    if (scans?.length) {
      const rows = scans.map((scan) => ({
        scan_id: scan.scan_id, meat_type: names.get(scan.meat_type_id) ?? 'Unknown',
        classification: scan.classification, confidence_score: scan.confidence_score,
        scanned_at: scan.scanned_at, synced_at: new Date().toISOString(),
      }));
      const { error: saveError } = await admin.from('customer_reports').upsert(rows, { onConflict: 'scan_id' });
      if (saveError) return json({ error: 'Could not save the mobile reports.' }, 500);
    }
    const last = scans?.at(-1);
    return json({ imported: scans?.length ?? 0, next: scans?.length === 200 && last ? { at: last.scanned_at, id: last.scan_id } : null });
  } catch {
    return json({ error: 'Customer report service is temporarily unavailable.' }, 500);
  } finally {
    // Revoke only this short-lived remote session, never other inspector sessions.
    if (external) await external.auth.signOut({ scope: 'local' }).catch(() => {});
  }
});
