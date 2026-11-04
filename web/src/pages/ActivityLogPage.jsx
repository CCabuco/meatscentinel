import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import ActivityResults from '../components/ActivityResults.jsx';
import FilterBar from '../components/FilterBar.jsx';
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
    setParams(Object.fromEntries(Object.entries({ ...draft, inspector: filters.inspector })
      .map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)));
  }

  const remove = (key) => setParams(Object.fromEntries(Object.entries(filters).filter(([k, v]) => k !== key && v)));
  const chips = [
    filters.inspectionId && { key: 'inspectionId', label: `Inspection ${filters.inspectionId.slice(0, 12)}${filters.inspectionId.length > 12 ? '…' : ''}` },
    filters.action && { key: 'action', label: ACTIVITY_ACTIONS[filters.action] },
    filters.from && { key: 'from', label: `From ${filters.from}` },
    filters.to && { key: 'to', label: `To ${filters.to}` },
  ].filter(Boolean).map((chip) => ({ ...chip, onRemove: () => remove(chip.key) }));

  return (
    <AppShell>
      <PageHeader title="Activity Log" description="Inspector actions, assignments, account changes and inspection viewing. Newest first, Philippine time." />
      <div className="card overflow-hidden">
        <FilterBar
          search={filters.inspector}
          onSearch={(text) => setParams(Object.fromEntries(Object.entries({ ...filters, inspector: text }).filter(([, v]) => v)))}
          searchPlaceholder="Inspector ID, e.g. INSP-001"
          searchLabel="Inspector ID"
          chips={chips}
          onClearAll={() => setParams(filters.inspector ? { inspector: filters.inspector } : {})}
          actions={<button className="btn-secondary" onClick={() => setRefresh((n) => n + 1)}>Refresh</button>}
        >
          <form onSubmit={apply} className="contents">
            <div><label className="label" htmlFor="activityInspection">Inspection ID</label>
              <input id="activityInspection" className="input" placeholder="Full inspection ID" maxLength={40} value={draft.inspectionId} onChange={(e) => set('inspectionId', e.target.value)} /></div>
            <div><label className="label" htmlFor="activityAction">Action</label>
              <select id="activityAction" className="input" value={draft.action} onChange={(e) => set('action', e.target.value)}>
                <option value="">All actions</option>
                {Object.entries(ACTIVITY_ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="activityFrom">From</label>
                <input id="activityFrom" type="date" className="input" value={draft.from} onChange={(e) => set('from', e.target.value)} /></div>
              <div><label className="label" htmlFor="activityTo">To</label>
                <input id="activityTo" type="date" className="input" value={draft.to} min={draft.from || undefined} onChange={(e) => set('to', e.target.value)} /></div>
            </div>
            {error && <p className="alert-error sm:col-span-2 lg:col-span-3" role="alert">{error}</p>}
            <div className="sm:col-span-2 lg:col-span-3"><button className="btn-primary" type="submit">Apply filters</button></div>
          </form>
        </FilterBar>
        <ActivityResults key={JSON.stringify(filters)} filters={filters} refreshKey={refresh} />
      </div>
      <p className="text-xs text-ink-faint mt-4 leading-relaxed">
        Entries cannot be edited or deleted. "app" means the portal reported the event (for example opening a record);
        "system" means the database recorded it. Closing a browser is not a sign-out.
        Full MSafe report history is also on each report in <Link className="text-brand-700 underline" to="/msafe-reports">MSafe reports</Link>.
      </p>
    </AppShell>
  );
}
