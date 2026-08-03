import { supabase } from './supabase.js';

// Authentication — V-12, V-12b, AD-01, AD-02, D-05, D-06.
//
// Users authenticate with a User ID. The auth layer is email-based, so
// the User ID is resolved to the mapped email first via the restricted
// resolve_login_email function. The email is never entered on the login
// or recovery screens.

const GENERIC_SIGN_IN_ERROR = 'That User ID or password is not correct.';

// Resolution goes through the resolve-login Edge Function, not a direct RPC.
//
// The lookup has to be callable before sign-in, which makes it the one
// endpoint an anonymous caller can learn anything from. Behind the function
// it is rate limited; the database grant for anon was revoked so it cannot
// be reached any other way.
//
// Throws RateLimited so the caller can say something more useful than
// "wrong password".
class RateLimited extends Error {}

async function resolveEmail(userId) {
  const { data, error } = await supabase.functions.invoke('resolve-login', {
    body: { user_id: userId },
  });

  if (error) {
    let payload = null;
    try {
      payload = await error.context?.json?.();
    } catch {
      // fall through
    }
    if (payload?.retry_after_minutes) throw new RateLimited(payload.error);
    throw error;
  }

  if (data?.retry_after_minutes) throw new RateLimited(data.error);

  return data?.email ?? null;
}

export async function signInWithUserId(userId, password) {
  const trimmed = (userId ?? '').trim();
  if (!trimmed || !password) {
    return { error: GENERIC_SIGN_IN_ERROR };
  }

  let email;
  try {
    email = await resolveEmail(trimmed);
  } catch (err) {
    if (err instanceof RateLimited) return { error: err.message };
    return { error: 'Unable to reach the authentication service. Try again.' };
  }

  // A deactivated or unknown User ID resolves to null. Both return the
  // same message so the form does not reveal which User IDs exist.
  if (!email) {
    return { error: GENERIC_SIGN_IN_ERROR };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: GENERIC_SIGN_IN_ERROR };
  }

  return { error: null };
}

// V-12b — the user enters their User ID; the recovery link goes to the
// mapped email. The response is deliberately identical whether or not
// the User ID exists.
export async function requestPasswordRecovery(userId) {
  const trimmed = (userId ?? '').trim();
  if (!trimmed) return { error: 'Enter your User ID.' };

  let email;
  try {
    email = await resolveEmail(trimmed);
  } catch (err) {
    if (err instanceof RateLimited) return { error: err.message };
    return { error: 'Unable to reach the authentication service. Try again.' };
  }

  if (email) {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  }

  return { error: null };
}

// D-05 — the current password is required for confirmation. Supabase's
// updateUser does not verify it, so we re-authenticate first. This also
// protects against an unattended logged-in session being taken over.
export async function changePassword(email, currentPassword, newPassword) {
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (reauthError) {
    return { error: 'Your current password is not correct.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

// Changing an email is a two-step operation, and the order matters.
//
// Supabase requires the holder to confirm an email change before
// auth.users.email actually moves. Writing the accounts row first meant the
// two could sit permanently out of step if the confirmation was never
// clicked. Auth goes first now: if it refuses, nothing is written at all.
//
// The accounts row still updates immediately, so the page shows what the
// holder asked for. Sign-in resolves against auth.users.email, so a pending
// change cannot lock anyone out.
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function validateEmail(email) {
  const value = (email ?? '').trim();

  if (!value) return 'Enter an email address.';
  if (value.length > 254) return 'That email address is too long.';
  if (/[\s<>"';()\\]/.test(value)) {
    return 'That email address contains characters that are not allowed.';
  }
  if (!EMAIL_PATTERN.test(value)) {
    return 'Enter a valid email address, for example name@example.com.';
  }
  return null;
}

// Requesting an email change does NOT change it yet.
//
// Supabase sends a confirmation link to the new address and only updates the
// auth email once that link is used. A database trigger then mirrors it into
// accounts.email. Writing accounts.email here instead would break the User ID
// mapping: resolve_login_email would return an address auth does not yet
// accept, and the account could not sign in until confirmation.
export async function requestEmailChange(email) {
  const value = (email ?? '').trim();

  const formatError = validateEmail(value);
  if (formatError) return { error: formatError };

  const { error } = await supabase.auth.updateUser({ email: value });

  if (error) {
    if (/already been registered|already exists|already in use/i.test(error.message)) {
      return { error: 'That email address is already registered to another account.' };
    }
    return { error: error.message };
  }

  return { error: null };
}

export async function signOut() {
  await supabase.auth.signOut();
}
