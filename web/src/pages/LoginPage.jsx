import { useState } from 'react';
import { Link } from 'react-router-dom';
import { signInWithUserId } from '../lib/auth.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { deactivated, clearDeactivated } = useAuth();

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    clearDeactivated();

    const { error: signInError } = await signInWithUserId(userId, password);
    setBusy(false);

    if (signInError) {
      setError(signInError);
      setPassword('');
    }

    // No navigate here. Once the auth listener loads the account, the
    // RedirectIfAuthenticated wrapper on this route sends the user to
    // the landing path for their role — dashboard for inspectors,
    // account list for administrators (A-05). Navigating manually would
    // flash the wrong page for one of the two roles.
  }

  return (
    <div className="min-h-screen flex">
      <aside className="hidden lg:flex w-80 shrink-0 bg-surface border-r border-surface-line flex-col justify-between p-8">
        <div>
          <p className="text-sm font-medium text-ink">MeatScentinel</p>
          <p className="text-xs text-ink-faint mt-0.5">Inspection portal</p>
        </div>
        <p className="text-xs text-ink-faint leading-relaxed">
          An assistive inspection support tool. MeatScentinel does not replace
          official inspection procedures, laboratory testing, or professional
          judgment.
        </p>
      </aside>

      <main className="flex-1 grid place-items-center px-6 py-12 bg-surface-sunken">
        <div className="w-full max-w-sm">
          <h1 className="mb-1">Sign in</h1>
          <p className="text-sm text-ink-muted mb-6">
            Access is restricted to authorized personnel.
          </p>

          {deactivated && (
            <div className="alert-notice mb-4">
              This account is no longer active. Contact an administrator.
            </div>
          )}

          {error && (
            <div className="alert-error mb-4" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            <div>
              <label className="label" htmlFor="userId">
                User ID
              </label>
              <input
                id="userId"
                className="input font-mono"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="pt-1 text-center">
              <Link to="/recover" className="text-sm text-brand-600 hover:text-brand-700">
                Forgot your password?
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
