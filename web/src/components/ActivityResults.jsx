import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACTIVITY_ACTIONS, ACTIVITY_PAGE_SIZE, activityDetail, formatActivityTime, listActivity } from '../lib/activity.js';

export default function ActivityResults({ filters, refreshKey = 0, compact = false }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({ entries: [], total: 0, error: null });
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listActivity(JSON.parse(filterKey), page).then((data) => {
      if (!active) return;
      setResult(data);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setResult({ entries: [], total: 0, error: 'Activity could not be loaded. Please retry.' });
      setLoading(false);
    });
    return () => { active = false; };
  }, [filterKey, page, refreshKey, retry]);

  if (loading) return <p className="p-5 text-sm text-ink-faint" role="status">Loading activity…</p>;
  if (result.error) return (
    <div className="p-5 space-y-3">
      <p className="alert-error" role="alert">{result.error}</p>
      <button className="btn-secondary" onClick={() => setRetry((n) => n + 1)}>Retry</button>
    </div>
  );

  return (
    <div>
      {result.entries.length === 0 ? (
        <div className="p-6 text-sm text-ink-muted">
          <p>No activity matches this view.</p>
          <p className="text-xs text-ink-faint mt-2">Activity is recorded from when logging was enabled. Earlier remarks and statuses remain in inspection history.</p>
        </div>
      ) : (
        <ol className="divide-y divide-surface-line">
          {result.entries.map((entry) => (
            <li key={entry.id} className="p-5 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{ACTIVITY_ACTIONS[entry.action] ?? entry.action}</p>
                <time dateTime={entry.occurred_at} className="text-xs text-ink-faint">{formatActivityTime(entry.occurred_at)}</time>
              </div>
              <p className="text-sm text-ink-muted mt-1 break-words">
                {entry.inspector_name} <span className="font-mono text-xs">({entry.inspector_user_id})</span>
              </p>
              {entry.actor_user_id !== entry.inspector_user_id && (
                <p className="text-xs text-ink-faint mt-1">Recorded actor: {entry.actor_name ?? 'System / authentication service'}{entry.actor_user_id ? ` (${entry.actor_user_id})` : ''}</p>
              )}
              {activityDetail(entry) && <p className="text-sm mt-3 whitespace-pre-wrap break-words text-ink">{activityDetail(entry)}</p>}
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {entry.inspection_id && !compact && (
                  <Link to={`/records/${encodeURIComponent(entry.inspection_id)}`} className="text-xs font-mono text-brand-600 hover:text-brand-700 break-all">{entry.inspection_id}</Link>
                )}
                <span className="text-xs rounded-md bg-surface-sunken px-2 py-1 text-ink-muted">
                  {entry.source === 'app' ? 'Reported by app' : 'Recorded by system'}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-line px-5 py-3">
        <p className="text-xs text-ink-faint">{result.total === 0 ? '0 events' : `${page * ACTIVITY_PAGE_SIZE + 1}–${Math.min((page + 1) * ACTIVITY_PAGE_SIZE, result.total)} of ${result.total} events`}</p>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Previous</button>
          <button className="btn-secondary text-xs" disabled={(page + 1) * ACTIVITY_PAGE_SIZE >= result.total} onClick={() => setPage((n) => n + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
