import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import NotificationPreferences from '../components/NotificationPreferences.jsx';
import FilterBar, { FilterSelect } from '../components/FilterBar.jsx';
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
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(null);
  const [uncertain, setUncertain] = useState(null);
  const [openId, setOpenId] = useState(null);
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
  const chips = [
    filters.status && { key: 'status', label: DELIVERY_LABELS[filters.status] },
    filters.category && { key: 'category', label: NOTIFICATION_CATEGORIES[filters.category]?.[0] },
    filters.unread && { key: 'unread', label: 'Unread only', value: false },
  ].filter(Boolean).map((chip) => ({ ...chip, onRemove: () => filter(chip.key, chip.value ?? '') }));
  return <div className="space-y-3">
    <div className="card overflow-hidden">
      <FilterBar
        search={admin ? filters.inspector : undefined}
        onSearch={admin ? (text) => filter('inspector', text) : undefined}
        searchPlaceholder="Inspector ID, e.g. INSP-002"
        searchLabel="Inspector ID"
        chips={chips}
        onClearAll={() => { setFilters((f) => ({ ...f, status: '', category: '', unread: false })); setPage(0); }}
        actions={<>
          {!admin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.unread} onChange={(e) => filter('unread', e.target.checked)} />Unread only</label>}
          <button className="btn-secondary" disabled={loading} onClick={() => setRevision((v) => v + 1)}>Refresh</button>
        </>}
      >
        <FilterSelect label="Email status" value={filters.status} onChange={(v) => filter('status', v)} anyLabel="All statuses"
          options={Object.entries(DELIVERY_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterSelect label="Category" value={filters.category} onChange={(v) => filter('category', v)} anyLabel="All categories"
          options={Object.entries(NOTIFICATION_CATEGORIES).map(([value, [label]]) => ({ value, label }))} />
      </FilterBar>

      {actionError && <p role="alert" className="alert-error m-4">{actionError}</p>}
      {error ? <p role="alert" className="alert-error m-4">{error}</p> : loading ? <p role="status" className="p-6 text-sm text-ink-faint">Loading notifications…</p>
        : data.rows.length === 0 ? <p className="p-8 text-center text-sm text-ink-muted">No notifications match this view.</p>
        : <ol className="divide-y divide-surface-line">{data.rows.map((item) => {
          const open = openId === item.id;
          const warn = ['failed', 'unknown'].includes(item.status);
          return <li key={item.id} className="px-4 py-2 text-sm">
            <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-3 gap-y-0.5">
              <time className="text-xs text-ink-faint whitespace-nowrap tabular-nums sm:w-44 shrink-0">{formatActivityTime(item.created_at)}</time>
              <button type="button" onClick={() => setOpenId(open ? null : item.id)} aria-expanded={open}
                className={`text-left font-medium flex items-center gap-2 min-w-0 flex-1 ${!admin && !item.read_at ? 'text-ink' : 'text-ink'}`}>
                {!admin && !item.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                <span className="truncate">{item.title}</span>
              </button>
              {admin && <span className="text-xs text-ink-muted whitespace-nowrap">{item.recipient_name} ({item.recipient_user_id})</span>}
              <span className={`text-[11px] rounded px-1.5 py-0.5 whitespace-nowrap ${warn ? 'bg-state-reviewBg text-state-review' : 'bg-surface-sunken text-ink-muted'}`}>{DELIVERY_LABELS[item.status]}</span>
              <Link className="text-xs text-brand-700 underline whitespace-nowrap"
                to={item.inspection_id ? `/records/${encodeURIComponent(item.inspection_id)}` : item.msafe_report_id ? `/msafe-reports?report=${item.msafe_report_id}` : '/msafe-reports'}>
                Open
              </Link>
            </div>
            {open && <div className="mt-2 sm:ml-[12.75rem] space-y-2">
              <p>{item.message}</p>
              <p className="text-xs font-mono text-ink-muted break-all">
                {item.msafe_report_id ? `MSafe report ${item.msafe_report_id}` : ''}{item.msafe_report_id && item.inspection_id ? ' · ' : ''}
                {item.inspection_id ? `Inspection ${item.inspection_id}` : ''}{!item.msafe_report_id && !item.inspection_id && item.scan_id ? `Mobile report ${item.scan_id}` : ''}
              </p>
              {admin && item.sent_to && <p className="text-xs text-ink-muted">Sent to {item.sent_to}</p>}
              {item.reason && <p className="text-xs text-ink-muted">{item.reason}</p>}
              <div className="flex flex-wrap gap-2">
                {!admin && !item.read_at && <button className="btn-secondary text-xs" disabled={busy !== null} onClick={() => action(item, false)}>Mark as read</button>}
                {admin && item.status === 'failed' && <button className="btn-secondary text-xs" disabled={busy !== null} onClick={() => action(item, true)}>Retry email</button>}
                {admin && item.status === 'unknown' && <button className="btn-secondary text-xs" disabled={busy !== null} onClick={() => setUncertain(item.id)}>Review retry</button>}
              </div>
              {uncertain === item.id && <div className="alert-notice text-sm"><p>This email may already have been sent. Check Brevo’s transactional log first. Retrying can create a duplicate.</p><div className="flex gap-2 mt-3"><button className="btn-secondary" disabled={busy !== null} onClick={() => action(item, true, true)}>Retry anyway</button><button className="btn-secondary" disabled={busy !== null} onClick={() => setUncertain(null)}>Cancel</button></div></div>}
            </div>}
          </li>;
        })}</ol>}
    </div>
    <p className="text-xs text-ink-faint">Select a notification to see the full message. Emails are sent within about a minute. “Accepted” means the email provider took the message; it does not confirm it reached the inbox.</p>
    <Pagination page={page} total={data.total} loading={loading} setPage={setPage} noun={['notification', 'notifications']} />
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
    <Pagination page={page} total={data.total} loading={loading} setPage={setPage} noun={['change', 'changes']} pageSize={20} />
  </div>;
}
function Pagination({ page, total, loading, setPage, noun, pageSize = NOTIFICATION_PAGE_SIZE }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex gap-3 items-center justify-between text-sm">
    <span className="text-ink-muted">{total} {total === 1 ? noun[0] : noun[1]} · Page {page + 1} of {pages}</span>
    <div className="flex gap-2">
      <button className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
      <button className="btn-secondary" disabled={loading || (page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
    </div>
  </div>;
}
