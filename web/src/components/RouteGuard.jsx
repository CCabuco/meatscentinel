import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Route guards are user experience, not security.
//
// Row Level Security enforces inspection access for both roles and account
// management for administrators. The database also requires an active
// account and a verified session, regardless of what the client requests.
//
// One state needs care: a session that exists while its account row is
// still being fetched. Supabase fires several auth events in quick
// succession on sign-in and on refresh, and the account load resolves a
// beat after the session does. Treating that beat as "not logged in"
// flashed the login page on every refresh. Session-without-account is a
// LOADING state, not a logged-out one.
//
// LV — with the verification step there is now a second, permanent way
// to be session-without-account: an unverified session, which is what a
// recovery link and an email-change confirmation produce. That is NOT a
// loading state and never resolves into one. Without the sessionState
// check below, visiting /login while holding one would show a loading
// screen forever.

function stillResolving({ loading, session, account, deactivated, sessionState }) {
  if (loading) return true;
  if (sessionState === 'unverified') return false;
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

export function RequireRole({ roles, children }) {
  const auth = useAuth();
  const location = useLocation();

  if (stillResolving(auth)) return <FullPageLoading />;
  // Remember where the user was going (for example a notification email
  // link) so sign-in can send them back there.
  if (!auth.session || !auth.account) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!roles.includes(auth.account.role)) {
    return <Navigate to={landingPathFor(auth.account.role)} replace />;
  }
  return children;
}

// An unverified session is deliberately allowed to sit on /login rather
// than being redirected: the user holding one has not completed sign-in,
// so the login form is exactly where they belong.
export function RedirectIfAuthenticated({ children }) {
  const auth = useAuth();
  const location = useLocation();

  if (stillResolving(auth)) return <FullPageLoading />;
  if (auth.account) {
    const back = safeReturnPath(location.state?.from);
    return <Navigate to={back ?? landingPathFor(auth.account.role)} replace />;
  }
  return children;
}

// Only same-site app paths are followed. Anything else (another site,
// "//evil.example", or a public page) falls back to the role landing page.
// The role guard on the destination still decides whether the user may
// see it.
const PUBLIC_PATHS = ['/login', '/recover', '/reset-password', '/email-changed'];

export function safeReturnPath(from) {
  const pathname = from?.pathname;
  if (typeof pathname !== 'string') return null;
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) return null;
  if (pathname === '/' || PUBLIC_PATHS.includes(pathname)) return null;
  return `${pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

// Administrators land on account management and can navigate to inspections.
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
