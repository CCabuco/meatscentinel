import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Route guards are user experience, not security.
//
// The real boundary is Row Level Security (AD-05): an administrator's
// token reads nothing from the inspection tables regardless of what the
// client requests. These guards exist so people do not land on screens
// that would render empty for them.
//
// One state needs care: a session that exists while its account row is
// still being fetched. Supabase fires several auth events in quick
// succession on sign-in and on refresh, and the account load resolves a
// beat after the session does. Treating that beat as "not logged in"
// flashed the login page on every refresh. Session-without-account is a
// LOADING state, not a logged-out one — unless the load concluded the
// account is deactivated, which signs out and clears the session anyway.

function stillResolving({ loading, session, account, deactivated }) {
  if (loading) return true;
  if (session && !account && !deactivated) return true;
  return false;
}

export function RequireAuth({ children }) {
  const auth = useAuth();
  const location = useLocation();

  if (stillResolving(auth)) return <FullPageLoading />;
  if (!auth.session || !auth.account) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

export function RequireRole({ role, children }) {
  const auth = useAuth();

  if (stillResolving(auth)) return <FullPageLoading />;
  if (!auth.session || !auth.account) return <Navigate to="/login" replace />;

  if (auth.account.role !== role) {
    return <Navigate to={landingPathFor(auth.account.role)} replace />;
  }
  return children;
}

export function RedirectIfAuthenticated({ children }) {
  const auth = useAuth();

  if (stillResolving(auth)) return <FullPageLoading />;
  if (auth.account) return <Navigate to={landingPathFor(auth.account.role)} replace />;
  return children;
}

// A-05 — administrators land directly on the account list. There is no
// administrator dashboard.
export function landingPathFor(role) {
  return role === 'administrator' ? '/accounts' : '/dashboard';
}

export function FullPageLoading() {
  return (
    <div className="min-h-screen grid place-items-center bg-surface-sunken">
      <p className="text-sm text-ink-faint">Loading…</p>
    </div>
  );
}
