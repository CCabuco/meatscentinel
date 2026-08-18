import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { beginSignIn, verifyLoginCode, resendLoginCode } from '../lib/auth.js';
import { useAuth } from '../context/AuthContext.jsx';

// Sign-in is two steps (LV). Credentials, then a code sent to the
// registered email address.
//
// The two steps are one page rather than two routes on purpose: a route
// would be bookmarkable and reloadable, and the challenge only exists in
// memory. A reload must send the user back to the start, which is what
// happens here for free.

const RESEND_COOLDOWN = 60; // LV-04, mirrored from the server

export default function LoginPage() {
  const [step, setStep] = useState('credentials');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { deactivated, clearDeactivated } = useAuth();

  // Held in memory only. Never persisted — a challenge that survived a
  // reload would outlive the browser state it is bound to (LV-06).
  const [challenge, setChallenge] = useState(null);

  function restart(message) {
    setChallenge(null);
    setStep('credentials');
    setPassword('');
    setError(message ?? null);
  }

  async function handleCredentials(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    clearDeactivated();

    const result = await beginSignIn(userId, password);
    setBusy(false);

    if (result.status === 'error') {
      setError(result.error);
      setPassword('');
      return;
    }

    if (result.status === 'challenge') {
      setChallenge({
        challengeId: result.challengeId,
        clientSecret: result.clientSecret,
      });
      setPassword('');
      setStep('code');
      return;
    }

    // status === 'authenticated' — a trusted device skipped the code
    // (LV-08). No navigate here; RedirectIfAuthenticated on this route
    // sends the user to the landing path for their role (A-05).
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
          {step === 'credentials' ? (
            <CredentialStep
              userId={userId}
              setUserId={setUserId}
              password={password}
              setPassword={setPassword}
              onSubmit={handleCredentials}
              busy={busy}
              error={error}
              deactivated={deactivated}
            />
          ) : (
            <CodeStep
              challenge={challenge}
              onRestart={restart}
              error={error}
              setError={setError}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function CredentialStep({
  userId,
  setUserId,
  password,
  setPassword,
  onSubmit,
  busy,
  error,
  deactivated,
}) {
  return (
    <>
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

      <form onSubmit={onSubmit} className="card p-6 space-y-4">
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
    </>
  );
}

function CodeStep({ challenge, onRestart, error, setError }) {
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [resendsLeft, setResendsLeft] = useState(3);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The cooldown is a courtesy, not the control — the server enforces it
  // against the challenge row regardless of what this timer says.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function handleVerify(event) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    const result = await verifyLoginCode({
      ...challenge,
      code,
      rememberDevice: remember,
    });
    setBusy(false);

    if (result.error) {
      if (result.restart) {
        onRestart(result.error);
        return;
      }
      setError(result.error);
      setCode('');
      inputRef.current?.focus();
      return;
    }

    // Signed in. RedirectIfAuthenticated takes it from here (A-05).
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    setBusy(true);

    const result = await resendLoginCode(challenge);
    setBusy(false);

    if (result.error) {
      if (result.restart) {
        onRestart(result.error);
        return;
      }
      setError(result.error);
      if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
      return;
    }

    setResendsLeft(result.resendsRemaining ?? 0);
    setCooldown(RESEND_COOLDOWN);
    setCode('');
    setNotice('A new code has been sent. The previous code no longer works.');
    inputRef.current?.focus();
  }

  return (
    <>
      <h1 className="mb-1">Enter verification code</h1>
      {/*
        The destination address is never shown. Naming it would help a
        user who has forgotten which address is registered, but would
        also disclose it to anyone holding a stolen password — the exact
        person this step exists to stop. Same reasoning as the recovery
        page confirmation.
      */}
      <p className="text-sm text-ink-muted mb-6">
        We sent a six-digit code to the email address registered on this
        account. It expires in five minutes.
      </p>

      {error && (
        <div className="alert-error mb-4" role="alert">
          {error}
        </div>
      )}

      {notice && <div className="alert-success mb-4">{notice}</div>}

      <form onSubmit={handleVerify} className="card p-6 space-y-4">
        <div>
          <label className="label" htmlFor="verificationCode">
            Verification code
          </label>
          <input
            id="verificationCode"
            ref={inputRef}
            className="input font-mono text-center text-lg tracking-[0.4em]"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
        </div>

        {/*
          LV-08 — opt-in, off by default. NMIS workstations are shared,
          and a box that ticked itself would quietly remove the code step
          on a machine other people use.
        */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span className="text-sm text-ink-muted">
            Remember this device for 7 days
            <span className="block text-xs text-ink-faint mt-0.5">
              Only on a device that is yours. Your password is still required
              every time.
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={busy || code.length !== 6}
        >
          {busy ? 'Verifying…' : 'Verify and sign in'}
        </button>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            className="text-sm text-brand-600 hover:text-brand-700 disabled:text-ink-faint disabled:cursor-not-allowed"
            onClick={handleResend}
            disabled={busy || cooldown > 0 || resendsLeft <= 0}
          >
            {resendsLeft <= 0
              ? 'No codes remaining'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend code'}
          </button>

          <button
            type="button"
            className="text-sm text-ink-muted hover:text-ink"
            onClick={() => onRestart(null)}
          >
            Start over
          </button>
        </div>
      </form>

      <p className="text-xs text-ink-faint mt-4 text-center">
        Not receiving the code? Contact an administrator to confirm the email
        address registered on your account.
      </p>
    </>
  );
}
