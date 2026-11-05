import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import PublicLayout from '../components/PublicLayout.jsx';

// Where the email-change confirmation link (from Gmail etc.) lands.
//
// Supabase tells us what happened in the URL:
//   * "...proceed to confirm link sent to the other email" — with "Secure
//     email change" on, both the old and the new address must confirm.
//     This was the first of the two.
//   * error / error_description — the link was expired, already used, or
//     cancelled.
//   * otherwise — the change is done, and the link signed this browser in.
//
// That link sign-in has not passed the login code check, so the portal
// cannot use it. It is ended here and the user signs in again normally,
// which also shows them the new address works.

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams((window.location.hash ?? '').replace(/^#/, ''));
  for (const [key, value] of hash) params.set(key, value);
  return params;
}

export default function EmailChangedPage() {
  const [phase, setPhase] = useState('checking');
  const [detail, setDetail] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const params = readParams();
    const message = params.get('message') ?? '';
    const error = params.get('error_description') ?? params.get('error') ?? '';
    const errorCode = params.get('error_code') ?? '';

    async function finish() {
      // Let the Supabase client finish reading the link before we look.
      const { data } = await supabase.auth.getSession();
      const newEmail = data.session?.user?.email ?? '';
      if (data.session) await supabase.auth.signOut({ scope: 'local' });
      // Keep the tokens out of the address bar and browser history.
      window.history.replaceState(null, '', window.location.pathname);
      if (!active) return;
      setDetail(newEmail);
      setPhase('complete');
    }

    if (/proceed to confirm|other email/i.test(message)) {
      window.history.replaceState(null, '', window.location.pathname);
      setPhase('one_done');
    } else if (error || errorCode) {
      window.history.replaceState(null, '', window.location.pathname);
      setDetail(/expired|invalid/i.test(`${error} ${errorCode}`) ? 'expired' : error);
      setPhase('error');
    } else {
      finish();
    }
    return () => { active = false; };
  }, []);

  return (
    <PublicLayout title="Email change">
      <div className="card p-6 text-center">
        {phase === 'checking' && (
          <p className="text-sm text-ink-faint" role="status">Confirming your new email address…</p>
        )}

        {phase === 'one_done' && (
          <>
            <h1 className="mb-2">One more link to open</h1>
            <p className="text-sm text-ink-muted mb-4">
              This address is confirmed. A second confirmation link was sent to your
              other email address (the old or the new one). Open that link too.
            </p>
            <p className="text-xs text-ink-faint">
              Your email changes only after both links are opened. Until then, keep
              signing in with your current address's codes.
            </p>
          </>
        )}

        {phase === 'complete' && (
          <>
            <h1 className="mb-2">Email updated</h1>
            <p className="text-sm text-ink-muted mb-5">
              {detail ? <>Your email is now <strong className="text-ink">{detail}</strong>. </> : 'Your email has been changed. '}
              Sign-in codes and password reset links will go there from now on.
              For security, sign in again with your User ID.
            </p>
            <button className="btn-primary w-full" onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1 className="mb-2">This link did not work</h1>
            <p className="text-sm text-ink-muted mb-5">
              {detail === 'expired'
                ? 'The link has expired, was already used, or the change was cancelled.'
                : `Supabase said: ${detail}`}
              {' '}Your email has not changed. Sign in and request the change again from your Profile.
            </p>
            <button className="btn-secondary w-full" onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </button>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
