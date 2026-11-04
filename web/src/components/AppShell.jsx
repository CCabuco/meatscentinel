import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { usePageTitle } from './PublicLayout.jsx';

const INSPECTOR_LINKS = [
  { to: '/msafe-reports', label: 'MSafe reports' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/records', label: 'Inspection records' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/profile', label: 'Profile' },
];

const ADMINISTRATOR_LINKS = [
  { to: '/msafe-reports', label: 'MSafe reports' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/records', label: 'Inspection records' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/activity', label: 'Activity Log' },
  { to: '/notifications', label: 'Notification management' },
  { to: '/profile', label: 'Profile' },
];

export default function AppShell({ children }) {
  const { account, signOut } = useAuth();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  const links = account?.role === 'administrator' ? ADMINISTRATOR_LINKS : INSPECTOR_LINKS;

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      setSignOutError('Could not complete sign-out. Check your connection and retry.');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-surface-sunken">
      {/* First thing keyboard users reach: jump past the menu. */}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 btn-primary">
        Skip to main content
      </a>
      <aside className="w-60 shrink-0 border-r border-surface-line bg-surface flex flex-col">
        <div className="px-5 py-5 border-b border-surface-line">
          <p className="text-sm font-medium text-ink">MeatScentinel</p>
          <p className="text-xs text-ink-faint mt-0.5">Inspection portal</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                [
                  'block rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 font-medium'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                ].join(' ')
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-surface-line">
          {account && (
            <div className="px-3 pb-3">
              <p className="text-sm text-ink truncate">{account.display_name}</p>
              <p className="text-xs text-ink-faint font-mono truncate">{account.user_id}</p>
            </div>
          )}
          {/* D-03 — logout lives in the global side navigation panel. */}
          {signOutError && <p className="text-xs text-state-spoiled mb-2" role="alert">{signOutError}</p>}
          <button onClick={handleSignOut} className="btn-secondary w-full" disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="flex-1 min-w-0 focus:outline-none">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  usePageTitle(typeof title === 'string' ? title : undefined);
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1>{title}</h1>
        {description && <p className="text-sm text-ink-muted mt-1">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
