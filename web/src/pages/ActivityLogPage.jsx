import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import ActivityResults from '../components/ActivityResults.jsx';
import { ACTIVITY_ACTIONS } from '../lib/activity.js';

const EMPTY_FILTERS = { inspector: '', inspectionId: '', action: '', from: '', to: '' };
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00+08:00`).getTime());

export default function ActivityLogPage() {
  const [params, setParams] = useSearchParams();
  const queryKey = params.toString();
  const filters = Object.fromEntries(Object.keys(EMPTY_FILTERS).map((key) => [key, params.get(key) ?? '']));
  if (!ACTIVITY_ACTIONS[filters.action]) filters.action = '';
  if (!validDate(filters.from)) filters.from = '';
  if (!validDate(filters.to)) filters.to = '';
  const [draft, setDraft] = useState(filters);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(null);
  useEffect(() => { setDraft(filters); setError(null); }, [queryKey]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  function apply(event) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('The end date must be on or after the start date.');
      return;
    }
    setError(null);
    setParams(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)));
  }

  return (
    <AppShell>
      <PageHeader title="Activity Log" description="Inspector actions, account changes, and inspection viewing."
        actions={<button className="btn-secondary" onClick={() => setRefresh((n) => n + 1)}>Refresh</button>} />
      <div className="card overflow-hidden">
        <form onSubmit={apply} className="p-5 border-b border-surface-line bg-surface-sunken/40">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><label className="label" htmlFor="activityInspector">Inspector ID</label>
              <input id="activityInspector" className="input" placeholder="e.g. INSP-001" maxLength={32} value={draft.inspector} onChange={(e) => set('inspector', e.target.value)} /></div>
            <div><label className="label" htmlFor="activityInspection">Inspection ID</label>
              <input id="activityInspection" className="input" placeholder="Full inspection ID" maxLength={40} value={draft.inspectionId} onChange={(e) => set('inspectionId', e.target.value)} /></div>
            <div><label className="label" htmlFor="activityAction">Action</label>
              <select id="activityAction" className="input" value={draft.action} onChange={(e) => set('action', e.target.value)}>
                <option value="">All actions</option>
                {Object.entries(ACTIVITY_ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></div>
            <div><label className="label" htmlFor="activityFrom">From date</label>
              <input id="activityFrom" type="date" className="input" value={draft.from} onChange={(e) => set('from', e.target.value)} /></div>
            <div><label className="label" htmlFor="activityTo">To date</label>
              <input id="activityTo" type="date" className="input" value={draft.to} min={draft.from || undefined} onChange={(e) => set('to', e.target.value)} /></div>
          </div>
          {error && <p className="alert-error mt-3" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-3 items-center mt-4">
            <button className="btn-primary" type="submit">Apply filters</button>
            <button className="btn-secondary" type="button" onClick={() => { setDraft(EMPTY_FILTERS); setParams({}); setError(null); }}>Clear</button>
            <span className="text-xs text-ink-faint">Newest first · Philippine time (UTC+8)</span>
          </div>
        </form>
        <ActivityResults key={JSON.stringify(filters)} filters={filters} refreshKey={refresh} />
      </div>
      <p className="text-xs text-ink-faint mt-4 leading-relaxed">System records confirm completed changes. Viewing events are reported when the app displays a record or loads its image. Closing a browser is not a sign-out event. Activity entries cannot be edited or deleted. MSafe report actions (claims, assignments, linked inspections and sent responses) are recorded in each report's History on the <Link className="text-brand-700 underline" to="/msafe-reports">MSafe reports</Link> page.</p>
    </AppShell>
  );
}
