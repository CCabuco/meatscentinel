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

  const tiles = [
    { label: 'Fresh', value: counts?.fresh, tone: 'text-state-fresh', to: '/records?classification=Fresh' },
    { label: 'Spoiled', value: counts?.spoiled, tone: 'text-state-spoiled', to: '/records?classification=Spoiled' },
    { label: 'For review', value: counts?.forReview, tone: 'text-state-review', to: '/records?classification=For+Review' },
    { label: 'Waiting to pair', value: counts?.pending, tone: 'text-ink', to: '/records?tab=pending',
      hint: 'Gas or mobile result missing' },
    !admin && { label: 'My inspections', value: mine, tone: 'text-brand-700', to: '/records?assigned=mine' },
    { label: 'MSafe unassigned', value: msafe?.unassigned, tone: 'text-brand-700', to: '/msafe-reports?view=unassigned' },
    { label: admin ? 'MSafe not answered' : 'My MSafe, not answered', value: msafe?.waiting, tone: 'text-brand-700',
      to: admin ? '/msafe-reports?view=assigned&status=new' : '/msafe-reports?view=mine&status=new' },
  ].filter(Boolean);

  return (
    <AppShell>
      <PageHeader title="Dashboard" description="All-time totals. Select a number to open that list." />

      {error && <div className="alert-error mb-4">{error}</div>}
      {msafeError && <div className="alert-error mb-4">MSafe counts: {msafeError}</div>}

      {/* V-08 — alert banner for records awaiting review. */}
      {!loading && counts?.forReview > 0 && (
        <Link to="/records?classification=For+Review" className="block alert-notice mb-4 hover:bg-state-reviewBg">
          {counts.forReview} record{counts.forReview === 1 ? '' : 's'} need{counts.forReview === 1 ? 's' : ''} review:
          a gas or mobile result was missing, invalid or incomplete.
        </Link>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {tiles.map((tile) => (
          <Link key={tile.label} to={tile.to}
            title={tile.hint}
            className="card px-4 py-3 hover:border-brand-500 transition-colors flex flex-col">
            <span className="text-xs text-ink-muted leading-tight min-h-[2rem]">{tile.label}</span>
            <span className={`text-2xl font-medium tabular-nums ${tile.tone}`}>
              {loading || tile.value == null ? '—' : tile.value}
            </span>
          </Link>
        ))}
      </div>

      <p className="text-xs text-ink-faint mt-4">
        Fresh, Spoiled and For review count classified records only. Records waiting to pair have no classification yet.
        Numbers update automatically.
      </p>
    </AppShell>
  );
}
