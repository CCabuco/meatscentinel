import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { ClassificationBadge, StatusPill, SourceMarks } from '../components/Badge.jsx';
import { formatDateTime, formatPpm, titleCaseSample } from '../lib/format.js';
import {
  listRecords,
  PAGE_SIZE,
  TABS,
  SAMPLE_TYPES,
  CLASSIFICATIONS,
  CASE_STATUSES,
  SOURCE_TYPES,
} from '../lib/records.js';

const EMPTY_FILTERS = {
  sampleType: '',
  sourceType: '',
  classification: '',
  caseStatus: '',
  dateFrom: '',
  dateTo: '',
};

export default function RecordsPage() {
  const [tab, setTab] = useState('all');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { records: rows, total: count, error: loadError } = await listRecords({
      tab,
      filters,
      page,
    });
    setRecords(rows);
    setTotal(count);
    setError(loadError);
    setLoading(false);
  }, [tab, filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  function selectTab(next) {
    setTab(next);
    setPage(0);
  }

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters]
  );

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AppShell>
      <PageHeader
        title="Inspection records"
        description="All inspection records, including those still waiting for a counterpart."
      />

      <div className="card overflow-hidden">
        <TabBar tab={tab} onSelect={selectTab} />

        <Filters
          filters={filters}
          onChange={updateFilter}
          onClear={() => {
            setFilters(EMPTY_FILTERS);
            setPage(0);
          }}
          activeCount={activeFilterCount}
        />

        {/*
          DB-03 — sample type lives on the gas submission, so an unpaired
          mobile submission carries none and cannot match this filter.
          Saying so beats leaving someone to wonder where the records went.
        */}
        {filters.sampleType && (
          <div className="px-5 py-2.5 border-b border-surface-line bg-state-reviewBg/40">
            <p className="text-xs text-state-review">
              Sample type is recorded on the gas submission. Unpaired mobile app
              submissions have no sample type and are not shown while this filter
              is applied.
            </p>
          </div>
        )}

        {error && (
          <div className="p-5">
            <div className="alert-error">{error}</div>
          </div>
        )}

        {loading ? (
          <p className="p-8 text-sm text-ink-faint text-center">Loading records…</p>
        ) : records.length === 0 ? (
          <EmptyState hasFilters={activeFilterCount > 0 || tab !== 'all'} />
        ) : (
          <RecordTable records={records} />
        )}

        <Pagination
          page={page}
          lastPage={lastPage}
          total={total}
          shown={records.length}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(lastPage, p + 1))}
        />
      </div>
    </AppShell>
  );
}

function TabBar({ tab, onSelect }) {
  return (
    <div className="flex gap-1 px-3 pt-3 pb-0 border-b border-surface-line overflow-x-auto">
      {TABS.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={[
            'whitespace-nowrap rounded-t-lg px-3 py-2 text-sm transition-colors border-b-2 -mb-px',
            tab === item.id
              ? 'border-brand-600 text-brand-700 font-medium'
              : 'border-transparent text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Filters({ filters, onChange, onClear, activeCount }) {
  return (
    <div className="px-5 py-4 border-b border-surface-line bg-surface-sunken/40">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Sample type"
          value={filters.sampleType}
          onChange={(v) => onChange('sampleType', v)}
          options={SAMPLE_TYPES.map((s) => ({ value: s, label: titleCaseSample(s) }))}
        />
        <Select
          label="Source type"
          value={filters.sourceType}
          onChange={(v) => onChange('sourceType', v)}
          options={SOURCE_TYPES.map((s) => ({ value: s.id, label: s.label }))}
        />
        <Select
          label="Final classification"
          value={filters.classification}
          onChange={(v) => onChange('classification', v)}
          options={[
            ...CLASSIFICATIONS.map((c) => ({ value: c, label: c })),
            { value: '__pending', label: 'Pending (not yet classified)' },
          ]}
        />
        <Select
          label="Case status"
          value={filters.caseStatus}
          onChange={(v) => onChange('caseStatus', v)}
          options={CASE_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <div>
          <label className="label" htmlFor="dateFrom">From date</label>
          <input
            id="dateFrom"
            type="date"
            className="input"
            value={filters.dateFrom}
            onChange={(e) => onChange('dateFrom', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="dateTo">To date</label>
          <input
            id="dateTo"
            type="date"
            className="input"
            value={filters.dateTo}
            onChange={(e) => onChange('dateTo', e.target.value)}
          />
        </div>
      </div>

      {activeCount > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-ink-muted">
            {activeCount} filter{activeCount === 1 ? '' : 's'} applied
          </span>
          <button onClick={onClear} className="text-xs text-brand-600 hover:text-brand-700">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  const id = `filter-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Any</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function RecordTable({ records }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-line text-left">
            <Th>Inspection ID</Th>
            <Th>Sample</Th>
            <Th>Sources</Th>
            <Th>NH₃</Th>
            <Th>H₂S</Th>
            <Th>Image result</Th>
            <Th>Classification</Th>
            <Th>Case status</Th>
            <Th>Recorded</Th>
          </tr>
        </thead>
        <tbody>
          {records.map((row) => (
            <tr
              key={row.inspection_id}
              className="border-b border-surface-line last:border-0 hover:bg-surface-sunken/60"
            >
              <Td>
                <Link
                  to={`/records/${encodeURIComponent(row.inspection_id)}`}
                  className="font-mono text-brand-600 hover:text-brand-700"
                >
                  {row.inspection_id}
                </Link>
              </Td>
              <Td>{titleCaseSample(row.sample_type)}</Td>
              <Td>
                <SourceMarks
                  hasGas={row.has_gas_submission}
                  hasImage={row.has_image_submission}
                />
              </Td>
              <Td className="tabular-nums">{formatPpm(row.nh3_ppm)}</Td>
              <Td className="tabular-nums">{formatPpm(row.h2s_ppm)}</Td>
              <Td>{row.image_result ?? '—'}</Td>
              <Td><ClassificationBadge value={row.final_classification} /></Td>
              <Td><StatusPill value={row.current_case_status} /></Td>
              <Td className="text-ink-muted whitespace-nowrap">
                {formatDateTime(row.created_at)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-xs font-medium text-ink-muted whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function EmptyState({ hasFilters }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm text-ink">No records match this view.</p>
      {hasFilters && (
        <p className="text-sm text-ink-muted mt-1">
          Try clearing a filter or switching tabs.
        </p>
      )}
    </div>
  );
}

function Pagination({ page, lastPage, total, shown, onPrev, onNext }) {
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = page * PAGE_SIZE + shown;

  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-surface-line">
      <p className="text-xs text-ink-muted">
        {total === 0 ? 'No records' : `Showing ${first}–${last} of ${total}`}
      </p>
      <div className="flex gap-2">
        <button className="btn-secondary text-xs py-1.5" onClick={onPrev} disabled={page === 0}>
          Previous
        </button>
        <button
          className="btn-secondary text-xs py-1.5"
          onClick={onNext}
          disabled={page >= lastPage}
        >
          Next
        </button>
      </div>
    </div>
  );
}
