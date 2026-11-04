import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import NotificationPreferences from '../components/NotificationPreferences.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { formatActivityTime } from '../lib/activity.js';
import { DEFAULT_OPTIONS, DELIVERY_LABELS, NOTIFICATION_CATEGORIES, NOTIFICATION_PAGE_SIZE, listNotifications, markNotificationRead, retryNotification } from '../lib/notifications.js';

export default function NotificationsPage() {
  const { account } = useAuth();
  const admin = account.role === 'administrator';
  const [params, setParams] = useSearchParams();
  const tabs = admin ? [['history', 'Delivery log'], ['settings', 'Delivery settings'], ['inspectors', 'Inspector preferences'], ['management', 'Management history']]
    : [['history', 'My notifications'], ['settings', 'Email preferences']];
  const tab = tabs.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'history';
  return <AppShell>
    <PageHeader title={admin ? 'Notification management' : 'Notifications'} description={admin
      ? 'Manage inspection email delivery and review notification activity.' : 'Updates for your assigned reports and inspections, with email choices you control.'} />
    <div className="flex flex-wrap gap-2 mb-5" aria-label="Notification sections">
      {tabs.map(([id, label]) => <button key={id} className={id === tab ? 'btn-primary' : 'btn-secondary'} aria-pressed={id === tab} onClick={() => setParams({ tab: id })}>{label}</button>)}
    </div>
    {tab === 'settings' ? <NotificationPreferences account={account} global={admin} />
      : tab === 'inspectors' ? <InspectorPreferences /> : tab === 'management' ? <ManagementHistory />
        : <NotificationHistory admin={admin} />}
  </AppShell>;
}

function NotificationHistory({ admin }) {
  const [filters, setFilters] = useState({ status: '', category: '', inspector: '', unread: false });
  const [inspectorDraft, setInspectorDraft] = useState('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(null);
  const [uncertain, setUncertain] = useState(null);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    listNotifications(JSON.parse(filterKey), page).then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filterKey, page, revision]);
  function filter(key, value) { setFilters((current) => ({ ...current, [key]: value })); setPage(0); }
  async function action(item, retry, allowUnknown = false) {
    setBusy(item.id); setActionError('');
    try {
      if (retry) await retryNotification(item.id, allowUnknown); else await markNotificationRead(item.id);
      setUncertain(null); setRevision((v) => v + 1);
    } catch (err) { setActionError(err.message); }
    finally { setBusy(null); }
  }
  return <div className="space-y-4">
    <div className="card p-4 flex flex-wrap gap-3 items-end">
      <label className="text-xs text-ink-muted">Email status<select className="input mt-1" value={filters.status} onChange={(e) => filter('status', e.target.value)}>
        <option value="">All statuses</option>{Object.entries(DELIVERY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="text-xs text-ink-muted">Category<select className="input mt-1" value={filters.category} onChange={(e) => filter('category', e.target.value)}>
        <option value="">All categories</option>{Object.entries(NOTIFICATION_CATEGORIES).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {admin ? <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); filter('inspector', inspectorDraft); }}>
        <label className="text-xs text-ink-muted">Inspector ID<input className="input mt-1" placeholder="e.g. INSP-002" value={inspectorDraft} onChange={(e) => setInspectorDraft(e.target.value)} /></label><button className="btn-secondary">Filter</button>
      </form> : <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={filters.unread} onChange={(e) => filter('unread', e.target.checked)} />Unread only</label>}
      <button className="btn-secondary" disabled={loading} onClick={() => setRevision((v) => v + 1)}>Refresh</button>
    </div>
    <p className="text-xs text-ink-muted">New events only. Emails are processed every minute. “Accepted” means the email provider accepted the request; it does not confirm Gmail inbox delivery.</p>
    {actionError && <p role="alert" className="alert-error">{actionError}</p>}
    {error ? <p role="alert" className="alert-error">{error}</p> : loading ? <p role="status">Loading notifications…</p>
      : data.rows.length === 0 ? <div className="card p-8 text-center text-ink-muted">No notifications match this view.</div>
        : <ol className="card divide-y divide-surface-line">{data.rows.map((item) => <li key={item.id} className="p-5">
          <div className="flex flex-wrap gap-2 items-start justify-between"><h2 className="flex gap-2 items-center">{!admin && !item.read_at && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}{item.title}</h2><time className="text-xs text-ink-muted">{formatActivityTime(item.created_at)}</time></div>
          {admin && <p className="text-xs text-ink-muted mt-1">To {item.recipient_name} ({item.recipient_user_id}){item.sent_to ? ` · ${item.sent_to}` : ''}</p>}
          <p className="text-sm mt-3">{item.message}</p>
          <p className="text-xs font-mono text-ink-muted mt-2 break-all">{item.msafe_report_id ? `MSafe report: ${item.msafe_report_id}` : item.inspection_id ?? `Mobile report: ${item.scan_id}`}</p>
          <div className="flex flex-wrap gap-3 items-center mt-3">
            <span className={`text-xs rounded-md px-2 py-1 ${['failed','unknown'].includes(item.status) ? 'bg-state-reviewBg text-state-review' : 'bg-surface-sunken text-ink-muted'}`}>{DELIVERY_LABELS[item.status]}</span>
            <Link className="text-sm text-brand-700 underline" to={item.inspection_id ? `/records/${encodeURIComponent(item.inspection_id)}` : '/msafe-reports'}>Open {item.inspection_id ? 'inspection' : 'reports'}</Link>
            {!admin && !item.read_at && <button className="btn-secondary" disabled={busy !== null} onClick={() => action(item, false)}>Mark as read</button>}
            {admin && item.status === 'failed' && <button className="btn-secondary" disabled={busy !== null} onClick={() => action(item, true)}>Retry email</button>}
            {admin && item.status === 'unknown' && <button className="btn-secondary" disabled={busy !== null} onClick={() => setUncertain(item.id)}>Review retry</button>}
          </div>
          {item.reason && <p className="text-xs text-ink-muted mt-2">{item.reason}</p>}
          {uncertain === item.id && <div className="alert-notice mt-3 text-sm"><p>This email may already have been sent. Check Brevo’s transactional log first. Retrying can create a duplicate.</p><div className="flex gap-2 mt-3"><button className="btn-secondary" disabled={busy !== null} onClick={() => action(item, true, true)}>Retry anyway</button><button className="btn-secondary" disabled={busy !== null} onClick={() => setUncertain(null)}>Cancel</button></div></div>}
        </li>)}</ol>}
    <Pagination page={page} total={data.total} loading={loading} setPage={setPage} />
  </div>;
}

function InspectorPreferences() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      supabase.from('accounts').select('id,user_id,display_name,email,is_active').eq('role', 'inspector').order('user_id'),
      supabase.from('notification_preferences').select('*'),
    ]).then(([accounts, prefs]) => {
      if (accounts.error || prefs.error) throw new Error(accounts.error?.message || prefs.error.message);
      const options = new Map((prefs.data ?? []).map((row) => [row.account_id, row]));
      if (active) setRows((accounts.data ?? []).map((row) => ({ ...row, preferences: { ...DEFAULT_OPTIONS, ...options.get(row.id) } })));
    }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <div className="space-y-4">
    <div className="flex justify-between gap-3"><p className="text-sm text-ink-muted">Personal choices are read-only for administrators. Delivery also requires an active account and enabled organization settings.</p><button className="btn-secondary" disabled={loading} onClick={() => setRevision((v) => v + 1)}>Refresh</button></div>
    {error ? <p role="alert" className="alert-error">{error}</p> : loading ? <p role="status">Loading inspectors…</p> : rows.length === 0 ? <p>No inspectors found.</p>
      : rows.map((row) => <section className="card p-5" key={row.id}>
        <h2>{row.display_name} <span className="text-xs font-mono text-ink-muted">{row.user_id}</span></h2>
        <p className="text-sm text-ink-muted mt-1 break-all">{row.email} · {row.is_active ? 'Active account' : 'Inactive account'}</p>
        <p className="text-sm mt-3 font-medium">{row.preferences.email_enabled ? 'Email enabled' : 'All inspection emails turned off'}</p>
        <dl className="grid sm:grid-cols-2 gap-2 text-sm mt-3">{Object.entries(NOTIFICATION_CATEGORIES).map(([key, [label]]) => <div key={key} className="flex justify-between gap-3"><dt>{label}</dt><dd>{row.preferences.email_enabled && row.preferences[key] ? 'On' : 'Off'}</dd></div>)}</dl>
      </section>)}
  </div>;
}

function ManagementHistory() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      supabase.from('notification_management_history').select('*', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * 20, page * 20 + 19),
      supabase.from('accounts').select('id,user_id,display_name'),
    ]).then(([history, accounts]) => {
      if (history.error || accounts.error) throw new Error(history.error?.message || accounts.error.message);
      const names = new Map((accounts.data ?? []).map((row) => [row.id, `${row.display_name} (${row.user_id})`]));
      if (active) setData({ rows: (history.data ?? []).map((row) => ({ ...row, actor: names.get(row.actor_id) ?? 'System' })), total: history.count ?? 0 });
    }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);
  return <div className="space-y-4"><button className="btn-secondary" disabled={loading} onClick={() => setRevision((v) => v + 1)}>Refresh history</button>
    {error ? <p role="alert" className="alert-error">{error}</p> : loading ? <p role="status">Loading management history…</p> : data.rows.length === 0 ? <p>No notification settings have changed yet.</p>
      : <ol className="card divide-y divide-surface-line">{data.rows.map((row) => <li key={row.id} className="p-5 text-sm">
        <p className="font-medium">{{ global_settings_changed: 'Organization settings updated', personal_preferences_changed: 'Personal preferences updated', email_retry_requested: 'Email retry requested' }[row.action] ?? row.action}</p>
        <p className="text-xs text-ink-muted mt-1">{row.actor} · {formatActivityTime(row.created_at)}</p>
        {row.details.after && <p className="text-xs mt-3">{Object.entries(row.details.after).map(([key, value]) => `${key === 'email_enabled' ? 'Email' : NOTIFICATION_CATEGORIES[key]?.[0] ?? key}: ${value ? 'On' : 'Off'}`).join(' · ')}</p>}
        {row.details.notification_id && <p className="text-xs mt-3 break-all">Notification {row.details.notification_id} · Previous status: {DELIVERY_LABELS[row.details.previous_status]}</p>}
      </li>)}</ol>}
    <Pagination page={page} total={data.total} loading={loading} setPage={setPage} />
  </div>;
}
function Pagination({ page, total, loading, setPage }) {
  return <div className="flex gap-3 items-center justify-between text-sm"><span>{total} notifications · Page {page + 1}</span><div className="flex gap-2"><button className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><button className="btn-secondary" disabled={loading || (page + 1) * NOTIFICATION_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button></div></div>;
}
