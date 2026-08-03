import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

// Where the email-change confirmation link lands.
//
// Two things to communicate. First, with "Secure email change" enabled,
// Supabase asks for confirmation from BOTH addresses — the first click is
// not the end, and it says so in a message on the URL. Second, once both
// are confirmed the auth email has changed, which ends the session; the
// user signs in again with the same User ID.

export default function EmailChangedPage() {
  const [phase, setPhase] = useState('checking');
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash ?? '';
    const search = window.location.search ?? '';
    const blob = `${hash} ${search}`;

    // Supabase puts a "confirm the other link" message on the URL after the
    // first of two confirmations.
    if (/proceed to confirm|other email/i.test(decodeURIComponent(blob))) {
      setPhase('one_done');
      return;
    }

    if (/error/i.test(blob)) {
      setPhase('error');
      return;
    }

    // If a session is still present the change is fully applied and the user
    // is still signed in (single-confirmation projects). If not, the session
    // ended with the email change and they need to sign in again.
    supabase.auth.getSession().then(({ data }) => {
      setPhase(data.session ? 'complete_session' : 'complete_signin');
    });
  }, []);

  return (
    <div className="min-h-screen grid place-items-center px-6 py-12 bg-surface-sunken">
      <div className="w-full max-w-sm card p-6 text-center">
        {phase === 'checking' && (
          <p className="text-sm text-ink-faint">Confirming…</p>
        )}

        {phase === 'one_done' && (
          <>
            <h1 className="mb-2">One more step</h1>
            <p className="text-sm text-ink-muted mb-4">
              This address is confirmed. To finish, open the link sent to your
              other email address as well.
            </p>
            <p className="text-xs text-ink-faint">
              The change takes effect once both are confirmed.
            </p>
          </>
        )}

        {phase === 'complete_session' && (
          <>
            <h1 className="mb-2">Email updated</h1>
            <p className="text-sm text-ink-muted mb-5">
              Your recovery email address has been changed. Reset links will now
              go to the new address.
            </p>
            <button
              className="btn-primary w-full"
              onClick={() => navigate('/profile', { replace: true })}
            >
              Back to profile
            </button>
          </>
        )}

        {phase === 'complete_signin' && (
          <>
            <h1 className="mb-2">Email updated</h1>
            <p className="text-sm text-ink-muted mb-5">
              Your recovery email address has been changed. For security you
              have been signed out — sign in again with your User ID.
            </p>
            <button
              className="btn-primary w-full"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1 className="mb-2">Link could not be confirmed</h1>
            <p className="text-sm text-ink-muted mb-5">
              This confirmation link is invalid or has expired. You can request
              the change again from your profile.
            </p>
            <button
              className="btn-secondary w-full"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
