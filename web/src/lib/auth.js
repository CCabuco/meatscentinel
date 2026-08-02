import { supabase } from './supabase.js';

// Authentication — V-12, V-12b, AD-01, AD-02, D-05, D-06.
//
// Users authenticate with a User ID. The auth layer is email-based, so
// the User ID is resolved to the mapped email first via the restricted
// resolve_login_email function. The email is never entered on the login
// or recovery screens.

const GENERIC_SIGN_IN_ERROR = 'That User ID or password is not correct.';

async function resolveEmail(userId) {
  const { data, error } = await supabase.rpc('resolve_login_email', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data ?? null;
}

export async function signInWithUserId(userId, password) {
  const trimmed = (userId ?? '').trim();
  if (!trimmed || !password) {
    return { error: GENERIC_SIGN_IN_ERROR };
  }

  let email;
  try {
    email = await resolveEmail(trimmed);
  } catch {
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
  } catch {
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

export async function updateRecoveryEmail(accountId, email) {
  // The accounts row holds the recovery contact and the login mapping.
  const { error: rowError } = await supabase
    .from('accounts')
    .update({ email })
    .eq('id', accountId);

  if (rowError) {
    return { error: rowError.message };
  }

  // Keep the auth identity in step, or the next recovery link would go
  // to the old address.
  const { error: authError } = await supabase.auth.updateUser({ email });
  if (authError) {
    return { error: authError.message };
  }

  return { error: null };
}

export async function signOut() {
  await supabase.auth.signOut();
}
