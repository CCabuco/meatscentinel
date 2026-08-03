import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import PasswordInput from '../components/PasswordInput.jsx';
import PasswordStrength from '../components/PasswordStrength.jsx';
import { evaluatePassword } from '../lib/passwordPolicy.js';

// Landing page for the recovery link sent to the registered email (V-12b).
//
// Supabase puts the recovery tokens in the URL fragment. The client is
// configured with detectSessionInUrl, so it exchanges them for a short-lived
// recovery session automatically — this page waits for that to happen before
// showing the form.

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const { valid } = evaluatePassword(password);
  const matches = password.length > 0 && password === confirm;

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true);
      }
    });

    // The link may already have been exchanged before this component
    // mounted, so check for an existing session too.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setReady(true);
      } else {
        // Give the client a moment to process the URL fragment before
        // deciding the link is unusable.
        setTimeout(() => {
          if (!active) return;
          supabase.auth.getSession().then(({ data: retry }) => {
            if (!active) return;
            if (retry.session) setReady(true);
            else setInvalid(true);
          });
        }, 1200);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Sign out so the new password is used deliberately on the next sign-in
    // rather than the recovery session carrying straight through.
    await supabase.auth.signOut();
    setDone(true);
  }

  return (
    <div className="min-h-screen grid place-items-center px-6 py-12 bg-surface-sunken">
      <div className="w-full max-w-sm">
        <h1 className="mb-1">Set a new password</h1>
        <p className="text-sm text-ink-muted mb-6">
          Choose a password that meets the requirements below.
        </p>

        {done ? (
          <div className="card p-6 space-y-4">
            <div className="alert-success">
              Your password has been changed. Sign in with your User ID and the
              new password.
            </div>
            <button
              className="btn-primary w-full"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          </div>
        ) : invalid ? (
          <div className="card p-6 space-y-4">
            <div className="alert-error">
              This reset link is invalid or has expired. Request a new one.
            </div>
            <Link to="/recover" className="btn-secondary w-full">
              Request a new link
            </Link>
          </div>
        ) : !ready ? (
          <div className="card p-6">
            <p className="text-sm text-ink-faint text-center">Checking your link…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4">
            {error && <div className="alert-error">{error}</div>}

            <div>
              <label className="label" htmlFor="newPassword">
                New password
              </label>
              <PasswordInput
                id="newPassword"
                value={password}
                onChange={setPassword}
                required
              />
              <PasswordStrength password={password} />
            </div>

            <div>
              <label className="label" htmlFor="confirmPassword">
                Confirm new password
              </label>
              <PasswordInput
                id="confirmPassword"
                value={confirm}
                onChange={setConfirm}
                required
              />
              {confirm.length > 0 && !matches && (
                <p className="text-xs text-state-spoiled mt-1.5">
                  Passwords do not match.
                </p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy || !valid || !matches}
            >
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
