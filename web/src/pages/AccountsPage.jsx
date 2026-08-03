import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import PasswordStrength from '../components/PasswordStrength.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import Modal from '../components/Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { evaluatePassword } from '../lib/passwordPolicy.js';
import { validateEmail } from '../lib/auth.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import {
  listAccounts,
  setAccountActive,
  createAccount,
  resetAccountPassword,
  checkAvailability,
  ROLES,
  ROLE_LABEL,
} from '../lib/accounts.js';

// A-05 — administrators land here directly. There is no administrator
// dashboard, and this page shows no inspection data of any kind.

const TABS = [
  { id: 'all', label: 'All accounts' },
  { id: 'inspector', label: 'Meat inspectors' },
  { id: 'administrator', label: 'Administrators' },
];

export default function AccountsPage() {
  const { account } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState(null);

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { accounts: rows, error } = await listAccounts();
    setAccounts(rows);
    if (error) setFeedback({ tone: 'error', message: error });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(target) {
    setFeedback(null);
    const { error } = await setAccountActive(target.id, !target.is_active);
    if (error) return setFeedback({ tone: 'error', message: error });
    setFeedback({
      tone: 'success',
      message: `${target.display_name} ${target.is_active ? 'deactivated' : 'reactivated'}.`,
    });
    setViewing(null);
    load();
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((row) => {
      if (tab !== 'all' && row.role !== tab) return false;
      if (!term) return true;
      return (
        row.user_id.toLowerCase().includes(term) ||
        row.display_name.toLowerCase().includes(term)
      );
    });
  }, [accounts, tab, search]);

  const counts = useMemo(
    () => ({
      all: accounts.length,
      inspector: accounts.filter((a) => a.role === 'inspector').length,
      administrator: accounts.filter((a) => a.role === 'administrator').length,
    }),
    [accounts]
  );

  return (
    <AppShell>
      <PageHeader
        title="Accounts"
        description="Create and manage meat inspector and administrator accounts."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New account
          </button>
        }
      />

      {feedback && (
        <div className={`${feedback.tone === 'error' ? 'alert-error' : 'alert-success'} mb-4`}>
          {feedback.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex gap-1 px-3 pt-3 border-b border-surface-line overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={[
                'whitespace-nowrap rounded-t-lg px-3 py-2 text-sm transition-colors border-b-2 -mb-px',
                tab === item.id
                  ? 'border-brand-600 text-brand-700 font-medium'
                  : 'border-transparent text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {item.label}
              <span className="ml-2 text-xs text-ink-faint">{counts[item.id]}</span>
            </button>
          ))}
        </div>

        <div className="px-5 py-3 border-b border-surface-line bg-surface-sunken/40">
          <label className="sr-only" htmlFor="accountSearch">
            Search accounts
          </label>
          <input
            id="accountSearch"
            className="input max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by User ID or name"
          />
        </div>

        {loading ? (
          <p className="p-8 text-sm text-ink-faint text-center">Loading accounts…</p>
        ) : visible.length === 0 ? (
          <p className="p-10 text-sm text-ink-muted text-center">
            No accounts match this view.
          </p>
        ) : (
          <AccountTable
            accounts={visible}
            currentId={account?.id}
            onView={setViewing}
            onToggle={toggleActive}
          />
        )}

        <div className="px-5 py-3 border-t border-surface-line">
          <p className="text-xs text-ink-muted">
            Showing {visible.length} of {accounts.length} accounts
          </p>
        </div>
      </div>

      <p className="text-xs text-ink-faint mt-4">
        Accounts are never deleted. Deactivating an account ends its session
        immediately and blocks sign-in, and can be reversed.
      </p>

      <CreateAccountModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(message) => {
          setCreating(false);
          setFeedback({ tone: 'success', message });
          load();
        }}
      />

      <ViewAccountModal
        target={viewing}
        currentId={account?.id}
        onClose={() => setViewing(null)}
        onToggle={toggleActive}
        onReset={(row) => {
          setViewing(null);
          setResetting(row);
        }}
      />

      <ResetPasswordModal
        target={resetting}
        onClose={() => setResetting(null)}
        onDone={(message) => {
          setResetting(null);
          setFeedback({ tone: 'success', message });
        }}
      />
    </AppShell>
  );
}

function AccountTable({ accounts, currentId, onView, onToggle }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-line text-left">
            <Th>User ID</Th>
            <Th>Display name</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th>Created</Th>
            <Th> </Th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((row) => {
            const isSelf = row.id === currentId;
            return (
              <tr
                key={row.id}
                className="border-b border-surface-line last:border-0 hover:bg-surface-sunken/60"
              >
                <Td className="font-mono">{row.user_id}</Td>
                <Td>
                  {row.display_name}
                  {isSelf && <span className="text-ink-faint text-xs ml-2">you</span>}
                </Td>
                <Td>{ROLE_LABEL[row.role] ?? row.role}</Td>
                <Td>
                  <StatusBadge active={row.is_active} />
                </Td>
                <Td className="text-ink-muted whitespace-nowrap">
                  {formatDate(row.created_at)}
                </Td>
                <Td>
                  <div className="flex gap-2 justify-end whitespace-nowrap">
                    <button className="btn-secondary text-xs py-1" onClick={() => onView(row)}>
                      View
                    </button>
                    {/*
                      U-B — an administrator cannot deactivate their own
                      account. Disabled here, and refused by the database
                      trigger regardless of what the client sends.
                    */}
                    <button
                      className="btn-secondary text-xs py-1"
                      onClick={() => onToggle(row)}
                      disabled={isSelf}
                      title={isSelf ? 'You cannot deactivate your own account' : undefined}
                    >
                      {row.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ active }) {
  return active ? (
    <span className="inline-flex items-center rounded-md border border-state-fresh/25 bg-state-freshBg px-2 py-0.5 text-xs font-medium text-state-fresh">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center rounded-md border border-state-pending/25 bg-state-pendingBg px-2 py-0.5 text-xs font-medium text-state-pending">
      Inactive
    </span>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-xs font-medium text-ink-muted whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted mb-1">{label}</dt>
      <dd className={`text-sm text-ink break-words ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function ViewAccountModal({ target, currentId, onClose, onToggle, onReset }) {
  if (!target) return null;
  const isSelf = target.id === currentId;

  return (
    <Modal
      open={Boolean(target)}
      title={target.display_name}
      description={`Account details for ${target.user_id}.`}
      onClose={onClose}
      footer={
        <>
          {target.role === 'inspector' && (
            <button className="btn-secondary" onClick={() => onReset(target)}>
              Reset password
            </button>
          )}
          <button
            className="btn-secondary"
            onClick={() => onToggle(target)}
            disabled={isSelf}
            title={isSelf ? 'You cannot deactivate your own account' : undefined}
          >
            {target.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        <Field label="User ID" value={target.user_id} mono />
        <Field label="Display name" value={target.display_name} />
        <Field label="Email address" value={target.email} />
        <Field label="Account type" value={ROLE_LABEL[target.role] ?? target.role} />
        <div>
          <dt className="text-xs font-medium text-ink-muted mb-1">Status</dt>
          <dd>
            <StatusBadge active={target.is_active} />
          </dd>
        </div>
        <Field label="Created" value={formatDateTime(target.created_at)} />
      </dl>

      {!target.is_active && (
        <p className="text-xs text-ink-faint mt-5">
          This account cannot sign in. Any session it had was ended when it was
          deactivated.
        </p>
      )}
    </Modal>
  );
}

function CreateAccountModal({ open, onClose, onCreated }) {
  const empty = {
    userId: '',
    displayName: '',
    email: '',
    role: 'inspector',
    password: '',
  };

  const [form, setForm] = useState(empty);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const { valid } = evaluatePassword(form.password);
  const emailError = form.email.trim() ? validateEmail(form.email) : null;
  const complete =
    form.userId.trim() && form.displayName.trim() && !emailError &&
    form.email.trim() && valid;

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'userId' || key === 'email') setError(null);
  }

  function close() {
    setForm(empty);
    setConfirming(false);
    setError(null);
    onClose();
  }

  // Verify the User ID and email are free before showing the confirmation.
  // Advancing first and failing afterwards asks the administrator to confirm
  // something that was never going to work.
  async function proceedToConfirm() {
    setChecking(true);
    setError(null);

    const { error: clash } = await checkAvailability({
      userId: form.userId,
      email: form.email,
    });

    setChecking(false);

    if (clash) {
      setError(clash);
      return;
    }

    setConfirming(true);
  }

  async function confirmCreate() {
    setBusy(true);
    setError(null);

    const { error: createError } = await createAccount({
      userId: form.userId.trim(),
      email: form.email.trim(),
      displayName: form.displayName.trim(),
      role: form.role,
      password: form.password,
    });

    setBusy(false);

    if (createError) {
      setConfirming(false);
      setError(createError);
      return;
    }

    const created = form.userId.trim();
    setForm(empty);
    onCreated(`Account ${created} created.`);
  }

  return (
    <>
      <Modal
        open={open && !confirming}
        title="New account"
        description="The account holder signs in with the User ID you set here."
        onClose={close}
        footer={
          <>
            <button className="btn-secondary" onClick={close}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={proceedToConfirm}
              disabled={!complete || checking}
            >
              {checking ? 'Checking…' : 'Create account'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="newUserId">
                User ID
              </label>
              <input
                id="newUserId"
                className="input font-mono"
                value={form.userId}
                onChange={(e) => set('userId', e.target.value)}
                placeholder="INSP-002"
              />
              <p className="text-xs text-ink-faint mt-1">
                Letters, numbers and hyphens. Cannot be changed later.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="newRole">
                Account type
              </label>
              <select
                id="newRole"
                className="input"
                value={form.role}
                onChange={(e) => set('role', e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="newDisplayName">
                Display name
              </label>
              <input
                id="newDisplayName"
                className="input"
                value={form.displayName}
                onChange={(e) => set('displayName', e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="newEmail">
                Email address
              </label>
              <input
                id="newEmail"
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
              {emailError ? (
                <p className="text-xs text-state-spoiled mt-1">{emailError}</p>
              ) : (
                <p className="text-xs text-ink-faint mt-1">
                  Password reset links go here.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="newPassword">
              Initial password
            </label>
            <PasswordInput
              id="newPassword"
              value={form.password}
              onChange={(v) => set('password', v)}
            />
            <PasswordStrength password={form.password} />
            <p className="text-xs text-ink-faint mt-2">
              Use Show to read it back so you can pass it on. The account holder
              can change it from their profile page.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={open && confirming}
        title="Create this account?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Back
            </button>
            <button className="btn-primary" onClick={confirmCreate} disabled={busy}>
              {busy ? 'Creating…' : 'Yes, create account'}
            </button>
          </>
        }
      >
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
          <Field label="User ID" value={form.userId.trim()} mono />
          <Field label="Account type" value={ROLE_LABEL[form.role]} />
          <Field label="Display name" value={form.displayName.trim()} />
          <Field label="Email address" value={form.email.trim()} />
        </dl>

        {form.role === 'administrator' && (
          <div className="alert-notice mt-5">
            This account will be able to create and deactivate other accounts,
            including administrators.
          </div>
        )}

        <p className="text-xs text-ink-faint mt-5">
          The User ID cannot be changed afterwards. Accounts are never deleted —
          they can only be deactivated.
        </p>
      </Modal>
    </>
  );
}

// A-04 — the fallback when self-service recovery is not usable, typically
// because the registered email is wrong or unreachable.
function ResetPasswordModal({ target, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { valid } = evaluatePassword(password);

  if (!target) return null;

  function close() {
    setPassword('');
    setError(null);
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const { error: resetError } = await resetAccountPassword(target.id, password);
    setBusy(false);
    if (resetError) return setError(resetError);

    setPassword('');
    onDone(`Password reset for ${target.display_name}.`);
  }

  return (
    <Modal
      open={Boolean(target)}
      title="Reset password"
      description={`Setting a new password for ${target.user_id} — ${target.display_name}.`}
      onClose={close}
      footer={
        <>
          <button className="btn-secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !valid}>
            {busy ? 'Resetting…' : 'Set password'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="alert-error">{error}</div>}

        <div>
          <label className="label" htmlFor="resetPassword">
            New password
          </label>
          <PasswordInput id="resetPassword" value={password} onChange={setPassword} />
          <PasswordStrength password={password} />
        </div>

        <p className="text-xs text-ink-faint">
          Use this only when the account holder cannot use the self-service reset
          link sent to their registered email.
        </p>
      </div>
    </Modal>
  );
}
