import { useEffect, useState } from 'react';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import PasswordStrength from '../components/PasswordStrength.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  changePassword,
  requestEmailChange,
  validateEmail,
  getPendingEmail,
  resendEmailChange,
  cancelPendingEmailChange,
} from '../lib/auth.js';
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
  // readonly -> editing -> pending, driven by whether Supabase reports a
  // pending address awaiting confirmation.
  const [pending, setPending] = useState(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    getPendingEmail().then(setPending);
  }, []);

  // Client-side resend cooldown. Supabase enforces the real limit
  // server-side; this keeps the button honest about it.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const trimmed = email.trim();
  const formatError = trimmed ? validateEmail(trimmed) : null;
  const sameAsCurrent = trimmed.toLowerCase() === account.email.toLowerCase();
  const canSave =
    trimmed && !formatError && !sameAsCurrent && password.length > 0;

  function startEditing() {
    setEmail('');
    setPassword('');
    setStatus(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEmail('');
    setPassword('');
    setStatus(null);
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    const { error } = await requestEmailChange(account.email, password, trimmed);
    setBusy(false);

    if (error) {
      setStatus({ tone: 'error', message: error });
      return;
    }

    setPending(trimmed);
    setEditing(false);
    setPassword('');
    setCooldown(60);
    setStatus({
      tone: 'success',
      message: `A confirmation link has been sent to ${trimmed}.`,
    });
  }

  async function resend() {
    setBusy(true);
    setStatus(null);
    const { error } = await resendEmailChange(pending);
    setBusy(false);

    if (error) {
      setStatus({ tone: 'error', message: error });
      return;
    }
    setCooldown(60);
    setStatus({ tone: 'success', message: `Confirmation link resent to ${pending}.` });
  }

  async function cancelChange() {
    setBusy(true);
    setStatus(null);
    const { error } = await cancelPendingEmailChange();
    setBusy(false);

    if (error) {
      setStatus({ tone: 'error', message: error });
      return;
    }
    setPending(null);
    setStatus({
      tone: 'success',
      message: 'Email change cancelled. Your current address is unchanged.',
    });
  }

  return (
    <section className="card p-6">
      <h2 className="mb-1">Recovery email</h2>
      <p className="text-sm text-ink-muted mb-4">
        Password reset links are sent to this address. Changing it requires
        your password and confirmation from the new address.
      </p>

      <div className="max-w-md space-y-4">
        {status && (
          <div className={status.tone === 'error' ? 'alert-error' : 'alert-success'}>
            {status.message}
          </div>
        )}

        {!editing && (
          <div>
            <p className="label">Email address</p>
            <div className="flex items-center gap-3">
              <p className="readonly-value flex-1">{account.email}</p>
              {!pending && (
                <button type="button" className="btn-secondary" onClick={startEditing}>
                  Change email
                </button>
              )}
            </div>
          </div>
        )}

        {pending && !editing && (
          <div className="rounded-lg border border-state-review/25 bg-state-reviewBg px-4 py-3 space-y-3">
            <div>
              <p className="text-sm text-state-review font-medium">
                Awaiting confirmation
              </p>
              <p className="text-sm text-state-review mt-0.5">
                A link was sent to {pending}. Your address changes once it is
                opened. Until then, reset emails go to {account.email}.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs py-1.5"
                onClick={resend}
                disabled={busy || cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs py-1.5"
                onClick={cancelChange}
                disabled={busy}
              >
                Cancel email change
              </button>
            </div>
          </div>
        )}

        {editing && (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="label" htmlFor="newEmailAddress">
                New email address
              </label>
              <input
                id="newEmailAddress"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
              {formatError && (
                <p className="text-xs text-state-spoiled mt-1.5">{formatError}</p>
              )}
              {sameAsCurrent && trimmed && (
                <p className="text-xs text-state-spoiled mt-1.5">
                  That is already your current address.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="confirmWithPassword">
                Current password
              </label>
              <input
                id="confirmWithPassword"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <p className="text-xs text-ink-faint mt-1.5">
                Your email address is how this account is recovered, so
                changing it requires your password.
              </p>
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy || !canSave}>
                {busy ? 'Sending…' : 'Save'}
              </button>
              <button type="button" className="btn-secondary" onClick={cancelEditing}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
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
