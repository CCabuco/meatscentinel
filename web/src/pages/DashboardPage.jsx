import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { getDashboardCounts } from '../lib/records.js';

export default function DashboardPage() {
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getDashboardCounts().then((result) => {
      if (!active) return;
      setCounts(result.counts);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

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
