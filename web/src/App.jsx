import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RequireRole, RedirectIfAuthenticated } from './components/RouteGuard.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RecoveryPage from './pages/RecoveryPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import RecordsPage from './pages/RecordsPage.jsx';
import RecordDetailPage from './pages/RecordDetailPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import { NotFoundPage } from './pages/Placeholders.jsx';

// Two roles, routed separately (V-13). Inspectors reach the inspection
// modules; administrators reach account management and nothing else.
//
// These guards keep people off screens that would render empty for
// them. They are not the access boundary — that is Row Level Security
// (AD-05).

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/recover"
        element={
          <RedirectIfAuthenticated>
            <RecoveryPage />
          </RedirectIfAuthenticated>
        }
      />

      <Route
        path="/dashboard"
        element={
          <RequireRole role="inspector">
            <DashboardPage />
          </RequireRole>
        }
      />
      <Route
        path="/records"
        element={
          <RequireRole role="inspector">
            <RecordsPage />
          </RequireRole>
        }
      />
      <Route
        path="/records/:inspectionId"
        element={
          <RequireRole role="inspector">
            <RecordDetailPage />
          </RequireRole>
        }
      />

      <Route
        path="/accounts"
        element={
          <RequireRole role="administrator">
            <AccountsPage />
          </RequireRole>
        }
      />

      {/* Both roles have a Profile and Account page (A-02). */}
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />

      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
