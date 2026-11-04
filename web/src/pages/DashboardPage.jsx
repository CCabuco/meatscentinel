import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { getDashboardCounts, getMyInspectionCount } from '../lib/records.js';
import useAutoRefresh from '../lib/useAutoRefresh.js';
import { getMsafeCounts } from '../lib/msafe.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function DashboardPage() {
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { account } = useAuth();
  const admin = account?.role === 'administrator';
  const [msafe, setMsafe] = useState(null);
  const [msafeError, setMsafeError] = useState(null);

  const [mine, setMine] = useState(null);

  // Loads every counter. Runs on open and then automatically, so new
  // gas readings, mobile results and pairings show up without a reload.
  const load = useCallback(async (isActive = () => true) => {
    const [result, msafeResult, mineResult] = await Promise.all([
      getDashboardCounts(),
      getMsafeCounts({ accountId: account.id, admin }).then((r) => ({ r }), (err) => ({ err })),
      admin ? Promise.resolve(null) : getMyInspectionCount(account.id),
    ]);
    if (!isActive()) return;
    // A failed refresh keeps the last good numbers on screen.
    setCounts((prev) => result.counts ?? prev);
    setError(result.error);
    if (msafeResult.r) { setMsafe(msafeResult.r); setMsafeError(null); }
    else setMsafeError(msafeResult.err.message);
    if (mineResult && mineResult.count !== null) setMine(mineResult.count);
    setLoading(false);
  }, [account.id, admin]);

  useEffect(() => {
    let active = true;
    load(() => active);
    return () => { active = false; };
  }, [load]);

  useAutoRefresh(() => load());

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description="Overview of inspection outcomes."
      />

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* V-08 — alert banner for records awaiting review. */}
      {!loading && counts?.forReview > 0 && (
        <Link
          to="/records?classification=For+Review"
          className="block alert-notice mb-6 hover:bg-state-reviewBg"
        >
          {counts.forReview} record{counts.forReview === 1 ? '' : 's'} awaiting
          review. A required input was missing, invalid, or incomplete.
        </Link>
      )}

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <CountCard label="Fresh" value={counts?.fresh} loading={loading} tone="fresh" />
        <CountCard label="Spoiled" value={counts?.spoiled} loading={loading} tone="spoiled" />
        <CountCard label="For review" value={counts?.forReview} loading={loading} tone="review" />
      </div>

      {!admin && (
        <section className="card p-5 mb-6">
          <h2 className="mb-1">My inspections</h2>
          <p className="text-sm text-ink-muted mb-4">Inspection records an administrator assigned to you, or linked to your MSafe reports.</p>
          <MsafeCounter
            label="Assigned to me"
            hint="Open the list to see gas readings, mobile results and case status."
            value={mine}
            to="/records?assigned=mine"
          />
        </section>
      )}

      <section className="card p-5 mb-6">
        <h2 className="mb-1">MSafe reports</h2>
        <p className="text-sm text-ink-muted mb-4">Reports from MSafe users and suppliers that need someone.</p>
        {msafeError ? <p className="alert-error">{msafeError}</p> : (
          <div className="grid sm:grid-cols-2 gap-4">
            <MsafeCounter
              label="Unassigned"
              hint="No inspector yet. Claim or assign one."
              value={msafe?.unassigned}
              to="/msafe-reports?view=unassigned"
            />
            <MsafeCounter
              label={admin ? 'Assigned, not yet answered' : 'Assigned to me, not yet answered'}
              hint="Nothing has been sent to the reporter yet."
              value={msafe?.waiting}
              to={admin ? '/msafe-reports?view=assigned&status=new' : '/msafe-reports?view=mine&status=new'}
            />
          </div>
        )}
      </section>

      {/*
        V-06 — these are all-time totals, not today's activity.
        V-09 — pending records are deliberately not counted here. They have
        no classification yet, so there is nothing to count them as. They
        remain visible in Records Management.
      */}
      <section className="card p-5">
        <h2 className="mb-1">Not shown here</h2>
        <p className="text-sm text-ink-muted mb-4">
          Records still waiting for their counterpart have no classification
          yet, so they are not counted above.
        </p>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-surface-line bg-surface-sunken px-4 py-3">
          <div>
            <p className="text-sm text-ink">
              {loading ? '—' : counts?.pending} pending or unmatched
              {counts?.pending === 1 ? ' record' : ' records'}
            </p>
            <p className="text-xs text-ink-faint mt-0.5">
              Awaiting a gas submission or a mobile app submission.
            </p>
          </div>
          <Link to="/records" className="btn-secondary text-xs py-1.5 whitespace-nowrap">
            View records
          </Link>
        </div>
      </section>

      <p className="text-xs text-ink-faint mt-4">
        Counts cover all inspection records to date.
      </p>
    </AppShell>
  );
}

function CountCard({ label, value, loading, tone }) {
  const toneClasses = {
    fresh: 'text-state-fresh',
    spoiled: 'text-state-spoiled',
    review: 'text-state-review',
  };

  return (
    <div className="card p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`text-3xl font-medium mt-1 tabular-nums ${toneClasses[tone]}`}>
        {loading ? '—' : value}
      </p>
    </div>
  );
}

function MsafeCounter({ label, hint, value, to }) {
  return (
    <Link to={to} className="flex items-center justify-between gap-4 rounded-lg border border-surface-line bg-surface-sunken px-4 py-3 hover:border-brand-500">
      <div>
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-ink-faint mt-0.5">{hint}</p>
      </div>
      <span className="text-2xl font-medium tabular-nums text-brand-700">{value ?? '—'}</span>
    </Link>
  );
}
