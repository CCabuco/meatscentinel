import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordRecovery } from '../lib/auth.js';

// V-12b — the user enters their User ID. The system resolves the mapped
// email and sends the recovery link there. The email address is never
// entered here.

export default function RecoveryPage() {
  const [userId, setUserId] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const { error: recoveryError } = await requestPasswordRecovery(userId);
    setBusy(false);

    if (recoveryError) {
      setError(recoveryError);
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen grid place-items-center px-6 py-12 bg-surface-sunken">
      <div className="w-full max-w-sm">
        <h1 className="mb-1">Reset your password</h1>
        <p className="text-sm text-ink-muted mb-6">
          Enter your User ID and we will send a reset link to the email
          address registered on your account.
        </p>

        {sent ? (
          <div className="card p-6 space-y-4">
            {/*
              The confirmation is deliberately identical whether or not the
              User ID exists, and does not name the destination address.
              Showing it would help someone who has forgotten which address
              is registered, but would also disclose an address to anyone
              who guessed a valid User ID.
            */}
            <div className="alert-success">
              If that User ID is registered, a reset link has been sent to the
              email address on file.
            </div>
            <Link to="/login" className="btn-secondary w-full">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            {error && (
              <div className="alert-error" role="alert">
                {error}
              </div>
            )}

            <div>
              <label className="label" htmlFor="recoverUserId">
                User ID
              </label>
              <input
                id="recoverUserId"
                className="input font-mono"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                autoFocus
                required
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>

            <div className="pt-1 text-center">
              <Link to="/login" className="text-sm text-brand-600 hover:text-brand-700">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
