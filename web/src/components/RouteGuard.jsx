import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Route guards are user experience, not security.
//
// The real boundary is Row Level Security (AD-05): an administrator's
// token reads nothing from the inspection tables regardless of what the
// client requests. These guards exist so people do not land on screens
// that would render empty for them.

export function RequireAuth({ children }) {
  const { session, account, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoading />;
  if (!session || !account) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

export function RequireRole({ role, children }) {
  const { account, loading } = useAuth();

  if (loading) return <FullPageLoading />;
  if (!account) return <Navigate to="/login" replace />;

  if (account.role !== role) {
    return <Navigate to={landingPathFor(account.role)} replace />;
  }
  return children;
}

export function RedirectIfAuthenticated({ children }) {
  const { account, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (account) return <Navigate to={landingPathFor(account.role)} replace />;
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
