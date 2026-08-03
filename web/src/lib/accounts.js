import { supabase } from './supabase.js';

// Administrator account management — A-01 through A-06, U-B, U-F.
//
// Reads and deactivation go straight to the table: the administrator
// policies in 003 allow them, and the guards in 002 enforce U-B on the
// way through. Account creation and password resets cannot, because both
// need the Auth admin API, which requires a secret key. That key bypasses
// every Row Level Security policy, so it must never reach the browser —
// those two operations go through an Edge Function instead.

export const ROLES = [
  { id: 'inspector', label: 'Meat Inspector' },
  { id: 'administrator', label: 'Administrator' },
];

export const ROLE_LABEL = {
  inspector: 'Meat Inspector',
  administrator: 'Administrator',
};

export async function listAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, user_id, email, display_name, role, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) return { accounts: [], error: error.message };
  return { accounts: data ?? [], error: null };
}

// U-B — the guards live in the database, not here. An administrator
// deactivating themselves, or the last active administrator, is refused
// by guard_account_deactivation() and surfaces as an error message.
export async function setAccountActive(accountId, isActive) {
  const { error } = await supabase
    .from('accounts')
    .update({ is_active: isActive })
    .eq('id', accountId);

  if (error) return { error: cleanDbError(error.message) };
  return { error: null };
}

export async function updateAccountDetails(accountId, { display_name, email }) {
  const { error } = await supabase
    .from('accounts')
    .update({ display_name, email })
    .eq('id', accountId);

  if (error) return { error: cleanDbError(error.message) };
  return { error: null };
}

// A-01, A-06 — administrators create both inspector and administrator
// accounts. Goes through the Edge Function because it needs to create an
// auth user first.
export async function createAccount({ userId, email, displayName, role, password }) {
  return invokeManageAccount({
    action: 'create',
    user_id: userId,
    email,
    display_name: displayName,
    role,
    password,
  });
}

// A-04 — the fallback for an inspector who cannot use self-service
// recovery, typically because the registered email is wrong or
// unreachable.
export async function resetAccountPassword(accountId, newPassword) {
  return invokeManageAccount({
    action: 'reset_password',
    account_id: accountId,
    password: newPassword,
  });
}

// The session token travels in the request body, not a custom header.
//
// With publishable keys the API gateway can rewrite Authorization on the way
// through, substituting an API key for the session token — so relying on that
// header alone fails. A custom header would work, but it triggers a CORS
// preflight, which means the client and the deployed function must agree on
// the header name or every request dies before it arrives. The body avoids
// both problems.
//
// The token is still verified server-side against the auth service. Sending
// it in the body does not make it trusted.
async function invokeManageAccountRaw(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) return { data: null, error: 'No session.' };

  const { data, error } = await supabase.functions.invoke('manage-account', {
    body: { ...body, access_token: token },
  });

  if (error) return { data: null, error: await readFunctionError(error) };
  return { data, error: null };
}

async function invokeManageAccount(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    return { error: 'Your session has expired. Sign in again.' };
  }

  const { data, error } = await supabase.functions.invoke('manage-account', {
    body: { ...body, access_token: token },
  });

  if (error) return { error: await readFunctionError(error) };
  if (data?.error) return { error: data.error };
  return { error: null };
}

// Postgres raises the U-B guards as exceptions. Surface the message
// rather than a generic failure, since the guard text already explains
// what happened.
function cleanDbError(message) {
  if (!message) return 'That change could not be saved.';
  return message.replace(/^.*?:\s*/, '');
}

async function readFunctionError(error) {
  try {
    const body = await error.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    // fall through
  }
  return error.message ?? 'That request could not be completed.';
}

// Pre-flight availability check, run before the confirmation step so the
// administrator is not asked to confirm something that cannot succeed.
//
// This goes through the function rather than querying accounts directly: an
// auth user can exist without a matching accounts row, left by an earlier
// partial failure, and the browser cannot see auth.users. Only the server
// can check both.
export async function checkAvailability({ userId, email }) {
  const { data, error } = await invokeManageAccountRaw({
    action: 'check',
    user_id: (userId ?? '').trim(),
    email: (email ?? '').trim(),
  });

  // Do not block on a failed lookup — let the create attempt decide.
  if (error) return { error: null };

  return { error: data?.error ?? null };
}
