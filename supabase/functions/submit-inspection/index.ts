// MeatScentinel — submit-inspection Edge Function
//
// The kiosk's only way to write to the database. The kiosk holds a
// DEVICE_SECRET, not the service key. This function checks that secret,
// validates the gas result, then calls submit_device_inspection()
// (migration 016), which is executable by service_role only.
//
// Deploy:
//   npx.cmd supabase functions deploy submit-inspection --no-verify-jwt
// Secret (pick a long random value, put the same one in kiosk/.env):
//   npx.cmd supabase secrets set DEVICE_SECRET=<long-random-value>
//
// The kiosk sends the secret in the x-device-secret header, not in
// Authorization, because the gateway can replace Authorization when the
// project uses publishable keys.
//
// Responses:
//   201 { status: 'created' }    stored
//   200 { status: 'duplicate' }  this submission_id was already stored (a retry). Success.
//   409 { status: 'conflict' }   the inspection already has a gas result. Do not retry.
//   400 / 422                    bad payload. Do not retry.
//   401                          wrong or missing device secret
//   5xx                          server problem. Retry later.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SAMPLE_TYPES = ['chicken', 'pork', 'beef'];
const RESULTS = ['Fresh', 'Spoiled'];
const INSPECTION_ID = /^[A-Za-z0-9-]{6,40}$/;
const DEVICE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PPM = 999999.99; // numeric(8,2)
const MAX_BODY_BYTES = 8192;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Same key lookup order as manage-account: SERVICE_KEY first, then the
// new-format bundle, then the legacy key.
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

// Constant-time comparison: hash both sides so lengths match, then
// compare every byte instead of stopping at the first difference.
async function secretMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function ppm(value: unknown, field: string, errors: string[]): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_PPM) {
    errors.push(`${field} must be a number from 0 to ${MAX_PPM}, or null.`);
    return null;
  }
  return Math.round(value * 100) / 100;
}

function optionalNonNegative(value: unknown, field: string, errors: string[], integer = false): number | null {
  if (value === null || value === undefined) return null;
  const ok = typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    (!integer || Number.isInteger(value)) && value <= (integer ? 10000 : 99999.999);
  if (!ok) {
    errors.push(`${field} is out of range.`);
    return null;
  }
  return value;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const deviceSecret = Deno.env.get('DEVICE_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = resolveSecretKey();
  if (!deviceSecret || deviceSecret.length < 32 || !url || !secretKey) {
    // Server misconfiguration. Do not leak which part is missing.
    console.error('submit-inspection: DEVICE_SECRET (32+ chars), SUPABASE_URL or service key missing');
    return json({ error: 'Device uploads are not configured on the server.' }, 503);
  }

  const given = req.headers.get('x-device-secret') ?? '';
  if (!given || !(await secretMatches(given, deviceSecret))) {
    return json({ error: 'Device not authorised.' }, 401);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: 'Body must be a JSON object.' }, 400);
  }

  const errors: string[] = [];
  const submissionId = body.submission_id;
  const deviceId = body.device_id;
  const inspectionId = body.inspection_id;
  const sampleType = body.sample_type;
  const gasResult = body.gas_result ?? null;
  const isValid = body.is_valid;

  if (typeof submissionId !== 'string' || !UUID.test(submissionId)) errors.push('submission_id must be a UUID.');
  if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) errors.push('device_id is missing or has invalid characters.');
  if (typeof inspectionId !== 'string' || !INSPECTION_ID.test(inspectionId)) errors.push('inspection_id must be 6-40 letters, numbers or dashes.');
  if (typeof sampleType !== 'string' || !SAMPLE_TYPES.includes(sampleType)) errors.push('sample_type must be chicken, pork or beef.');
  if (gasResult !== null && (typeof gasResult !== 'string' || !RESULTS.includes(gasResult))) errors.push('gas_result must be Fresh, Spoiled or null.');
  if (typeof isValid !== 'boolean') errors.push('is_valid must be true or false.');

  const nh3 = ppm(body.nh3_ppm, 'nh3_ppm', errors);
  const h2s = ppm(body.h2s_ppm, 'h2s_ppm', errors);
  const readingCount = optionalNonNegative(body.reading_count, 'reading_count', errors, true);
  const nh3Sd = optionalNonNegative(body.nh3_stddev, 'nh3_stddev', errors);
  const h2sSd = optionalNonNegative(body.h2s_stddev, 'h2s_stddev', errors);

  let detectedAt: string | null = null;
  if (typeof body.detected_at !== 'string' || Number.isNaN(Date.parse(body.detected_at))) {
    errors.push('detected_at must be an ISO 8601 timestamp.');
  } else {
    detectedAt = new Date(body.detected_at).toISOString();
  }

  // Mirrors the valid_submission_complete check constraint, so the
  // device gets a clear message instead of a raw database error.
  if (isValid === true && (gasResult === null || nh3 === null || h2s === null)) {
    errors.push('A valid reading needs gas_result, nh3_ppm and h2s_ppm.');
  }
  if (isValid === false && gasResult !== null) {
    errors.push('An invalid reading must not carry a gas_result.');
  }

  if (errors.length > 0) return json({ error: 'Invalid payload.', details: errors }, 422);

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.rpc('submit_device_inspection', {
    p_submission_id: submissionId,
    p_device_id: deviceId,
    p_inspection_id: inspectionId,
    p_sample_type: sampleType,
    p_nh3_ppm: nh3,
    p_h2s_ppm: h2s,
    p_gas_result: gasResult,
    p_is_valid: isValid,
    p_detected_at: detectedAt,
    p_reading_count: readingCount,
    p_nh3_stddev: nh3Sd,
    p_h2s_stddev: h2sSd,
  });

  if (error) {
    console.error('submit-inspection rpc error', error.code, error.message);
    // 22023 = our own "bad input" raise, 23xxx = constraint violations.
    // Both are permanent: retrying the same payload will fail the same way.
    if (error.code === '22023' || error.code?.startsWith('23')) {
      return json({ error: 'Rejected by the database.', details: [error.message] }, 422);
    }
    return json({ error: 'Could not store the reading. Try again later.' }, 500);
  }

  if (data === 'created') return json({ status: 'created', inspection_id: inspectionId }, 201);
  if (data === 'duplicate') return json({ status: 'duplicate', inspection_id: inspectionId }, 200);
  if (data === 'conflict') {
    return json({ status: 'conflict', error: 'This inspection already has a gas result.' }, 409);
  }
  console.error('submit-inspection: unexpected rpc result', data);
  return json({ error: 'Unexpected server response.' }, 500);
});
