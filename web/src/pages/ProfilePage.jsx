import { useEffect, useState } from 'react';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import PasswordStrength from '../components/PasswordStrength.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
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

// Small inline icons rather than an icon library dependency — keeps this
// page from requiring a package that may not already be installed.
function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}
function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  );
}
function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}
function IconSmallLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function SectionIcon({ tone = 'brand', children }) {
  const toneClasses = {
    brand: 'bg-brand-50 text-brand-600',
    ink: 'bg-surface-sunken text-ink-muted',
  }[tone];
  return (
    <span
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${toneClasses}`}
    >
      {children}
    </span>
  );
}

function SectionHeading({ icon, title, description }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      {icon}
      <div>
        <h2 className="mb-0.5">{title}</h2>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { account } = useAuth();

  if (!account) return null;

  const initial = (account.display_name || account.user_id || '?').trim().charAt(0).toUpperCase();

  return (
    <AppShell>
      <PageHeader
        title="Profile and account"
        description="View your account information and manage your basic account details."
      />

      <div className="space-y-6">
        {/* Identity header — orients the page around the person, not just a
            stack of forms. Purely presentational; no new state or logic. */}
        <section className="card p-6 flex items-center gap-4">
          <span className="h-14 w-14 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-lg font-semibold shrink-0">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="text-base font-medium text-ink truncate">
              {account.display_name}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs font-mono text-ink-faint px-2 py-0.5 rounded-md bg-surface-sunken">
                {account.user_id}
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-brand-50 text-brand-700">
                {ROLE_LABEL[account.role] ?? account.role}
              </span>
            </div>
          </div>
        </section>

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
      <SectionHeading
        icon={
          <SectionIcon tone="ink">
            <IconUser className="h-4.5 w-4.5" />
          </SectionIcon>
        }
        title="Account information"
      />
      <div className="grid sm:grid-cols-3 gap-4">
        <ReadOnlyField label="User ID" value={account.user_id} mono />
        <ReadOnlyField label="Display name" value={account.display_name} />
        <ReadOnlyField
          label="Account type"
          value={ROLE_LABEL[account.role] ?? account.role}
        />
      </div>
      <p className="text-xs text-ink-faint mt-4 flex items-start gap-1.5">
        <IconSmallLock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-ink-faint" />
        <span>
          Your User ID, display name, and account type are managed by an
          administrator and cannot be changed here.
        </span>
      </p>
    </section>
  );
}

// A read-only field is visually distinct from an editable one at a glance —
// muted background, small lock mark — rather than only distinguishable by
// reading the helper text below the section.
function ReadOnlyField({ label, value, mono = false }) {
  return (
    <div>
      <p className="label flex items-center gap-1">
        {label}
        <IconSmallLock className="h-3 w-3 text-ink-faint" />
      </p>
      <p
        className={`readonly-value bg-surface-sunken rounded-md px-3 py-2 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </p>
    </div>
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
      <SectionHeading
        icon={
          <SectionIcon>
            <IconMail className="h-4.5 w-4.5" />
          </SectionIcon>
        }
        title="Recovery email"
        description="Password reset links are sent to this address. Changing it requires your password and confirmation from the new address."
      />

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
              <p className="readonly-value bg-surface-sunken rounded-md px-3 py-2 flex-1 truncate">
                {account.email}
              </p>
              {!pending && (
                <button type="button" className="btn-secondary shrink-0" onClick={startEditing}>
                  Change email
                </button>
              )}
            </div>
          </div>
        )}

        {pending && !editing && (
          <div className="rounded-lg border border-state-review/25 bg-state-reviewBg px-4 py-3 space-y-3">
            <div>
              <p className="text-sm text-state-review font-medium flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-state-review inline-block" />
                Awaiting confirmation
              </p>
              <p className="text-sm text-state-review mt-1">
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
//
// Collapsed behind a button by default. The fields sitting open on a page
// nobody came here to change their password on is noise; revealing them is
// an explicit act.
//
// This deliberately does NOT email a reset link. That mechanism already
// exists for people who have forgotten their password. Someone signed in who
// knows their current password should not have to leave the application, and
// routing this through email would make changing a password depend on mail
// delivery.
function ChangePassword({ account }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const { valid } = evaluatePassword(next, current);
  const matches = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && valid && matches;

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  function cancel() {
    reset();
    setStatus(null);
    setOpen(false);
  }

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

    reset();
    setOpen(false);
    setStatus({ tone: 'success', message: 'Your password has been changed.' });
  }

  return (
    <section className="card p-6">
      <SectionHeading
        icon={
          <SectionIcon tone="ink">
            <IconLock className="h-4.5 w-4.5" />
          </SectionIcon>
        }
        title="Password"
        description={
          open
            ? 'Your current password is required to confirm this change.'
            : 'Change the password you use to sign in.'
        }
      />

      <div className="max-w-md space-y-4">
        {status && (
          <div className={status.tone === 'error' ? 'alert-error' : 'alert-success'}>
            {status.message}
          </div>
        )}

        {!open ? (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            Change password
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="currentPassword">
                Current password
              </label>
              <PasswordInput
                id="currentPassword"
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="newPassword">
                New password
              </label>
              <PasswordInput
                id="newPassword"
                value={next}
                onChange={setNext}
                required
              />
              <PasswordStrength password={next} currentPassword={current} />
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

            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
                {busy ? 'Updating…' : 'Update password'}
              </button>
              <button type="button" className="btn-secondary" onClick={cancel}>
                Cancel
              </button>
            </div>

            <p className="text-xs text-ink-faint">
              Forgotten your current password? Sign out and use the reset link on
              the sign-in page instead.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
