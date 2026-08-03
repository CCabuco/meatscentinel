import { useState } from 'react';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import PasswordStrength from '../components/PasswordStrength.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { changePassword, requestEmailChange, validateEmail } from '../lib/auth.js';
import { evaluatePassword } from '../lib/passwordPolicy.js';

const ROLE_LABEL = {
  inspector: 'Meat Inspector',
  administrator: 'Administrator',
};

export default function ProfilePage() {
  const { account } = useAuth();

  if (!account) return null;

  return (
    <AppShell>
      <PageHeader
        title="Profile and account"
        description="View your account information and manage your basic account details."
      />

      <div className="space-y-6">
        <AccountInformation account={account} />
        <RecoveryEmail account={account} />
        <ChangePassword account={account} />
      </div>
    </AppShell>
  );
}

// D-02 — read-only: User ID, display name, account type.
// D-01 / D-04 — display name is not editable by the account holder,
// which keeps attribution in the remarks and status history stable.
function AccountInformation({ account }) {
  return (
    <section className="card p-6">
      <h2 className="mb-4">Account information</h2>
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <p className="label">User ID</p>
          <p className="readonly-value font-mono">{account.user_id}</p>
        </div>
        <div>
          <p className="label">Display name</p>
          <p className="readonly-value">{account.display_name}</p>
        </div>
        <div>
          <p className="label">Account type</p>
          <p className="readonly-value">{ROLE_LABEL[account.role] ?? account.role}</p>
        </div>
      </div>
      <p className="text-xs text-ink-faint mt-4">
        Your User ID, display name, and account type are managed by an
        administrator and cannot be changed here.
      </p>
    </section>
  );
}

// D-07 / D-08 — the registered email is the account recovery contact.
function RecoveryEmail({ account }) {
  const [email, setEmail] = useState(account.email);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const trimmed = email.trim();
  const changed = trimmed !== account.email;
  const formatError = changed ? validateEmail(trimmed) : null;

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus(null);
    setBusy(true);

    const { error } = await requestEmailChange(trimmed);
    setBusy(false);

    if (error) {
      setStatus({ tone: 'error', message: error });
      return;
    }

    // The address on file has not changed yet, so the field is reset to the
    // current one. Showing the new address here would suggest the change had
    // already taken effect.
    setEmail(account.email);
    setStatus({
      tone: 'success',
      message:
        `A confirmation link has been sent to ${trimmed}. Your recovery ` +
        'address changes once you open it.',
    });
  }

  return (
    <section className="card p-6">
      <h2 className="mb-1">Recovery email</h2>
      <p className="text-sm text-ink-muted mb-4">
        Password reset links are sent to this address. Changing it requires
        confirming the new address first.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        {status && (
          <div className={status.tone === 'error' ? 'alert-error' : 'alert-success'}>
            {status.message}
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {formatError && (
            <p className="text-xs text-state-spoiled mt-1.5">{formatError}</p>
          )}
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !changed || Boolean(formatError)}
        >
          {busy ? 'Sending…' : 'Send confirmation link'}
        </button>

        <p className="text-xs text-ink-faint">
          Until the link is opened, reset emails continue going to your current
          address.
        </p>
      </form>
    </section>
  );
}

// D-05 — the current password is required for confirmation.
// D-06 — strength policy with live feedback.
function ChangePassword({ account }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const { valid } = evaluatePassword(next, current);
  const matches = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && valid && matches;

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus(null);
    setBusy(true);

    const { error } = await changePassword(account.email, current, next);
    setBusy(false);

    if (error) {
      setStatus({ tone: 'error', message: error });
      return;
    }

    setStatus({ tone: 'success', message: 'Your password has been changed.' });
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  return (
    <section className="card p-6">
      <h2 className="mb-1">Change password</h2>
      <p className="text-sm text-ink-muted mb-4">
        Your current password is required to confirm this change.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        {status && (
          <div className={status.tone === 'error' ? 'alert-error' : 'alert-success'}>
            {status.message}
          </div>
        )}

        <div>
          <label className="label" htmlFor="currentPassword">
            Current password
          </label>
          <input
            id="currentPassword"
            type="password"
            className="input"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="newPassword">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            className="input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
          <PasswordStrength password={next} currentPassword={current} />
        </div>

        <div>
          <label className="label" htmlFor="confirmPassword">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {confirm.length > 0 && !matches && (
            <p className="text-xs text-state-spoiled mt-1.5">
              Passwords do not match.
            </p>
          )}
        </div>

        <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
          {busy ? 'Updating…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
