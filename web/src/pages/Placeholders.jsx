import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { landingPathFor } from '../components/RouteGuard.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function NotFoundPage() {
  const { account } = useAuth();

  return (
    <PublicLayout title="Page not found">
      <h1 className="mb-1">Page not found</h1>
      <p className="text-sm text-ink-muted mb-6">
        That page does not exist in the inspection portal.
      </p>
      <div className="card p-6">
        {account ? (
          <Link to={landingPathFor(account.role)} className="btn-primary w-full">
            Go to {account.role === 'administrator' ? 'accounts' : 'dashboard'}
          </Link>
        ) : (
          <Link to="/login" className="btn-primary w-full">
            Go to sign in
          </Link>
        )}
      </div>
    </PublicLayout>
  );
}
