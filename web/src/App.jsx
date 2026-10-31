import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RequireRole, RedirectIfAuthenticated } from './components/RouteGuard.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RecoveryPage from './pages/RecoveryPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import EmailChangedPage from './pages/EmailChangedPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import RecordsPage from './pages/RecordsPage.jsx';
import RecordDetailPage from './pages/RecordDetailPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import ActivityLogPage from './pages/ActivityLogPage.jsx';
import CustomerReportsPage from './pages/CustomerReportsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import { NotFoundPage } from './pages/Placeholders.jsx';

// Both roles can use the inspection modules. Account management is
// restricted to administrators.
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

      {/*
        Deliberately unguarded. The recovery link creates a short-lived
        session, so RedirectIfAuthenticated would bounce the user straight
        past the form they came here to use.
      */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/email-changed" element={<EmailChangedPage />} />

      <Route
        path="/dashboard"
        element={
          <RequireRole roles={['inspector', 'administrator']}>
            <DashboardPage />
          </RequireRole>
        }
      />
      <Route
        path="/records"
        element={
          <RequireRole roles={['inspector', 'administrator']}>
            <RecordsPage />
          </RequireRole>
        }
      />
      <Route
        path="/records/:inspectionId"
        element={
          <RequireRole roles={['inspector', 'administrator']}>
            <RecordDetailPage />
          </RequireRole>
        }
      />

      <Route
        path="/accounts"
        element={
          <RequireRole roles={['administrator']}>
            <AccountsPage />
          </RequireRole>
        }
      />

      <Route
        path="/activity"
        element={
          <RequireRole roles={['administrator']}>
            <ActivityLogPage />
          </RequireRole>
        }
      />

      <Route path="/customer-reports" element={
        <RequireRole roles={['inspector', 'administrator']}><CustomerReportsPage /></RequireRole>
      } />
      <Route path="/notifications" element={
        <RequireRole roles={['inspector', 'administrator']}><NotificationsPage /></RequireRole>
      } />

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
