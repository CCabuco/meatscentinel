import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACTIVITY_ACTIONS, ACTIVITY_PAGE_SIZE, activityDetail, formatActivityTime, listActivity } from '../lib/activity.js';

// One line per event: time · action · who · detail · inspection.
// Long details (account changes, remarks) are cut to one line; the full
// text is on hover and expands on click.
export default function ActivityResults({ filters, refreshKey = 0, compact = false }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({ entries: [], total: 0, error: null });
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [openId, setOpenId] = useState(null);
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
          {result.entries.map((entry) => {
            const detail = activityDetail(entry);
            const open = openId === entry.id;
            const byOther = entry.actor_user_id !== entry.inspector_user_id;
            return (
              <li key={entry.id} className="px-4 py-2 text-sm min-w-0">
                <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-3 gap-y-0.5">
                  <time dateTime={entry.occurred_at} className="text-xs text-ink-faint whitespace-nowrap tabular-nums sm:w-44 shrink-0">
                    {formatActivityTime(entry.occurred_at)}
                  </time>
                  <span className="font-medium text-ink whitespace-nowrap">{ACTIVITY_ACTIONS[entry.action] ?? entry.action}</span>
                  <span className="text-ink-muted whitespace-nowrap">
                    {entry.inspector_name} <span className="font-mono text-xs">({entry.inspector_user_id})</span>
                    {byOther && (
                      <span className="text-xs text-ink-faint"> · by {entry.actor_name ?? 'system'}{entry.actor_user_id ? ` (${entry.actor_user_id})` : ''}</span>
                    )}
                  </span>
                  {detail && (
                    <button type="button" title={detail} onClick={() => setOpenId(open ? null : entry.id)}
                      className={`text-left text-ink min-w-0 ${open ? 'whitespace-pre-wrap break-words' : 'truncate'} flex-1`}>
                      {detail}
                    </button>
                  )}
                  {entry.inspection_id && !compact && (
                    <Link to={`/records/${encodeURIComponent(entry.inspection_id)}`} title={entry.inspection_id}
                      className="text-xs font-mono text-brand-600 hover:text-brand-700 whitespace-nowrap ml-auto">
                      {entry.inspection_id.length > 14 ? `${entry.inspection_id.slice(0, 8)}…${entry.inspection_id.slice(-4)}` : entry.inspection_id}
                    </Link>
                  )}
                  <span className="text-[11px] text-ink-faint whitespace-nowrap" title={entry.source === 'app' ? 'Reported by app' : 'Recorded by system'}>
                    {entry.source === 'app' ? 'app' : 'system'}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-line px-5 py-3">
        <p className="text-xs text-ink-faint">{result.total === 0 ? '0 events' : `${page * ACTIVITY_PAGE_SIZE + 1}–${Math.min((page + 1) * ACTIVITY_PAGE_SIZE, result.total)} of ${result.total} ${result.total === 1 ? 'event' : 'events'}`}</p>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Previous</button>
          <button className="btn-secondary text-xs" disabled={(page + 1) * ACTIVITY_PAGE_SIZE >= result.total} onClick={() => setPage((n) => n + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
