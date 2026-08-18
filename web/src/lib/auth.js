import { supabase } from './supabase.js';

// Authentication — V-12, V-12b, AD-01, AD-02, D-05, D-06, LV-01…LV-12.
//
// Users authenticate with a User ID. The auth layer is email-based, so
// the User ID is resolved to the mapped email first. The email is never
// entered on the login or recovery screens.
//
// Sign-in is now two steps (LV): credentials, then a code emailed to the
// registered address. Both steps run in edge functions, and the browser
// never receives a session until the code has been verified.
//
// Note what is NOT here: signInWithPassword. It was removed from the
// sign-in path deliberately. Calling it directly still works — the
// publishable key permits it — but the session it produces is not
// recorded in verified_sessions, so every RLS policy refuses it and the
// application is unusable with it. The gate is the database, not this
// file (see the header of 010).

const GENERIC_SIGN_IN_ERROR = 'That User ID or password is not correct.';
const UNREACHABLE = 'Unable to reach the authentication service. Try again.';

// LV-08 — the trusted device token. localStorage rather than an httpOnly
// cookie because the edge functions and the application are on different
// origins. It skips the code step only; the password is always required.
const TRUSTED_KEY = 'meatscentinel.trusted_device';

export function getTrustedToken() {
  try {
    return localStorage.getItem(TRUSTED_KEY);
  } catch {
    return null;
  }
}

function setTrustedToken(token) {
  try {
    if (token) localStorage.setItem(TRUSTED_KEY, token);
  } catch {
    // Private browsing or storage disabled. The code is simply required
    // every time, which is the safe direction to fail.
  }
}

export function clearTrustedToken() {
  try {
    localStorage.removeItem(TRUSTED_KEY);
  } catch {
    // nothing to do
  }
}

// Edge function errors arrive as a FunctionsHttpError whose body holds the
// message we actually want to show. Without this every throttle and every
// wrong code would surface as a generic network failure.
async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });

  if (error) {
    let payload = null;
    try {
      payload = await error.context?.json?.();
    } catch {
      // body was not JSON
    }
    if (payload?.error) return { data: payload, error: payload.error };
    return { data: null, error: UNREACHABLE };
  }

  if (data?.error) return { data, error: data.error };
  return { data, error: null };
}

// Step one. Returns one of:
//   { status: 'challenge', challengeId, clientSecret, expiresIn }
//   { status: 'authenticated' }              — trusted device, code skipped
//   { status: 'error', error }
export async function beginSignIn(userId, password) {
  const trimmed = (userId ?? '').trim();
  if (!trimmed || !password) {
    return { status: 'error', error: GENERIC_SIGN_IN_ERROR };
  }

  const { data, error } = await invoke('login-begin', {
    user_id: trimmed,
    password,
    trusted_token: getTrustedToken(),
  });

  if (error) return { status: 'error', error };

  if (data?.status === 'authenticated') {
    const applied = await applySession(data);
    if (applied.error) return { status: 'error', error: applied.error };
    return { status: 'authenticated' };
  }

  if (data?.status === 'challenge') {
    return {
      status: 'challenge',
      challengeId: data.challenge_id,
      clientSecret: data.client_secret,
      expiresIn: data.expires_in ?? 300,
    };
  }

  return { status: 'error', error: GENERIC_SIGN_IN_ERROR };
}

// Step two. `restart` tells the caller to send the user back to the
// credential form rather than letting them keep typing codes into a
// challenge that is already dead.
export async function verifyLoginCode({
  challengeId,
  clientSecret,
  code,
  rememberDevice,
}) {
  const { data, error } = await invoke('login-verify', {
    action: 'verify',
    challenge_id: challengeId,
    client_secret: clientSecret,
    code: (code ?? '').trim(),
    remember_device: rememberDevice === true,
  });

  if (error) return { error, restart: data?.restart === true };

  if (data?.status !== 'authenticated') {
    return { error: 'Unable to complete sign-in. Try again.', restart: true };
  }

  if (data.trusted_token) setTrustedToken(data.trusted_token);

  const applied = await applySession(data);
  if (applied.error) return { error: applied.error, restart: true };

  return { error: null, restart: false };
}

export async function resendLoginCode({ challengeId, clientSecret }) {
  const { data, error } = await invoke('login-verify', {
    action: 'resend',
    challenge_id: challengeId,
    client_secret: clientSecret,
  });

  if (error) {
    return {
      error,
      restart: data?.restart === true,
      retryAfterSeconds: data?.retry_after_seconds ?? null,
    };
  }

  return {
    error: null,
    restart: false,
    resendsRemaining: data?.resends_remaining ?? 0,
    expiresIn: data?.expires_in ?? 300,
  };
}

// The tokens were minted server-side after the code was accepted. Handing
// them to the client here is what starts the session locally; the auth
// listener in AuthContext picks it up from there.
async function applySession({ access_token, refresh_token }) {
  if (!access_token || !refresh_token) {
    return { error: 'Unable to complete sign-in. Try again.' };
  }
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) return { error: 'Unable to complete sign-in. Try again.' };
  return { error: null };
}

// V-12b — the user enters their User ID; the recovery link goes to the
// mapped email. The response is deliberately identical whether or not
// the User ID exists.
//
// This path is NOT gated by the verification code, and that is correct:
// a recovery link sent to the registered mailbox already proves control
// of that mailbox, which is the same thing the code proves. Requiring a
// code to reach the form would also be impossible — the user cannot
// receive a code for an account whose password they have lost, if the
// reason they lost it is that they never had one.
export async function requestPasswordRecovery(userId) {
  const trimmed = (userId ?? '').trim();
  if (!trimmed) return { error: 'Enter your User ID.' };

  const { data, error } = await supabase.functions.invoke('resolve-login', {
    body: { user_id: trimmed },
  });

  if (error) {
    let payload = null;
    try {
      payload = await error.context?.json?.();
    } catch {
      // not JSON
    }
    if (payload?.retry_after_minutes) return { error: payload.error };
    return { error: UNREACHABLE };
  }

  if (data?.retry_after_minutes) return { error: data.error };

  if (data?.email) {
    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  }

  return { error: null };
}

// D-05 — the current password is required for confirmation. Supabase's
// updateUser does not verify it, so we re-authenticate first.
//
// LV-09 — this also revokes every trusted device for the account, by a
// trigger on auth.users. The local token is cleared here so this browser
// does not keep presenting one the server has already revoked.
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

  clearTrustedToken();
  return { error: null };
}

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

// Requesting an email change does NOT change it yet. Supabase sends a
// confirmation link to the new address and only updates the auth email
// once that link is used; a trigger then mirrors it into accounts.email.
//
// The email is now doubly sensitive: it is both the recovery destination
// and where the verification code goes. Whoever controls it can complete
// a sign-in. The current-password requirement (D-07) matters more with
// LV in place, not less.
export async function requestEmailChange(currentEmail, currentPassword, newEmail) {
  const value = (newEmail ?? '').trim();

  const formatError = validateEmail(value);
  if (formatError) return { error: formatError };

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: currentEmail,
    password: currentPassword,
  });

  if (reauthError) {
    return { error: 'Your current password is not correct.' };
  }

  const { error } = await supabase.auth.updateUser(
    { email: value },
    { emailRedirectTo: `${window.location.origin}/email-changed` },
  );

  if (error) {
    if (/already been registered|already exists|already in use/i.test(error.message)) {
      return { error: 'That email address is already registered to another account.' };
    }
    return { error: error.message };
  }

  return { error: null };
}

export async function getPendingEmail() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.new_email ?? null;
}

export async function resendEmailChange(newEmail) {
  const { error } = await supabase.auth.resend({
    type: 'email_change',
    email: newEmail,
  });

  if (error) {
    if (/rate|too many|seconds/i.test(error.message)) {
      return { error: 'A link was sent recently. Wait a moment before resending.' };
    }
    return { error: error.message };
  }
  return { error: null };
}

export async function cancelPendingEmailChange() {
  const { error } = await supabase.rpc('cancel_my_pending_email_change');
  if (error) return { error: error.message };
  return { error: null };
}

// The trusted device token is intentionally NOT cleared on sign-out.
// Signing out is an ordinary end of session, not a statement that the
// device is no longer trusted — clearing it would make "remember this
// device for 7 days" mean "until you log out", which is not what the
// checkbox says. It is cleared on password change and revoked
// server-side on email change and deactivation (LV-09).
export async function signOut() {
  await supabase.auth.signOut();
}
