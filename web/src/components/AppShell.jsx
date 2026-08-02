import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const INSPECTOR_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/records', label: 'Inspection records' },
  { to: '/profile', label: 'Profile' },
];

const ADMINISTRATOR_LINKS = [
  { to: '/accounts', label: 'Accounts' },
  { to: '/profile', label: 'Profile' },
];

export default function AppShell({ children }) {
  const { account, signOut } = useAuth();
  const navigate = useNavigate();

  const links = account?.role === 'administrator' ? ADMINISTRATOR_LINKS : INSPECTOR_LINKS;

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex bg-surface-sunken">
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
          <button onClick={handleSignOut} className="btn-secondary w-full">
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-5xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
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
