import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { ClassificationBadge, StatusPill } from '../components/Badge.jsx';
import FilterBar, { FilterSelect } from '../components/FilterBar.jsx';
import useAutoRefresh from '../lib/useAutoRefresh.js';
import { useStaff, staffLabel } from '../lib/staff.js';
import { formatDate, titleCaseSample } from '../lib/format.js';
import {
  listRecords,
  claimInspection,
  pairingLabel,
  pairingShort,
  PAGE_SIZE,
  TABS,
  SAMPLE_TYPES,
  CLASSIFICATIONS,
  CASE_STATUSES,
  SOURCE_TYPES,
} from '../lib/records.js';

const EMPTY_FILTERS = {
  q: '',
  sampleType: '',
  sourceType: '',
  classification: '',
  caseStatus: '',
  assigned: '',
  dateFrom: '',
  dateTo: '',
};

const CLASSIFICATION_OPTIONS = [
  ...CLASSIFICATIONS.map((c) => ({ value: c, label: c })),
  { value: '__pending', label: 'Pending (not yet classified)' },
];
const ASSIGNED_OPTIONS = [
  { value: 'mine', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
];

// Links such as /records?classification=For+Review or /records?assigned=mine
// (from the Dashboard) open the list already filtered.
function filtersFromUrl(params) {
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS)) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

const labelFor = (options, value) => options.find((o) => o.value === value)?.label ?? value;

export default function RecordsPage() {
  const [searchParams] = useSearchParams();
  const { account } = useAuth();
  const staff = useStaff();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab');
    return TABS.some((x) => x.id === t) ? t : 'all';
  });
  const [filters, setFilters] = useState(() => filtersFromUrl(searchParams));
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // silent: refresh in place (auto refresh) without the loading state.
  const sequence = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    const mine = ++sequence.current;
    if (!silent) setLoading(true);
    const { records: rows, total: count, error: loadError } = await listRecords({
      tab, filters, page, accountId: account.id,
    });
    if (mine !== sequence.current) return; // a newer load replaced this one
    if (silent && loadError) return; // keep what is on screen; the next refresh retries
    setRecords(rows);
    setTotal(count);
    setError(loadError);
    setLoading(false);
  }, [tab, filters, page, account.id]);

  useEffect(() => { load(); }, [load]);

  // New gas readings, mobile results, pairings, status changes and
  // assignments appear without reloading the page.
  useAutoRefresh(() => load({ silent: true }));

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  function selectTab(next) {
    setTab(next);
    setPage(0);
  }

  const chips = [
    filters.sampleType && { key: 'sampleType', label: `Sample: ${titleCaseSample(filters.sampleType)}` },
    filters.sourceType && { key: 'sourceType', label: labelFor(SOURCE_TYPES.map((s) => ({ value: s.id, label: s.label })), filters.sourceType) },
    filters.classification && { key: 'classification', label: labelFor(CLASSIFICATION_OPTIONS, filters.classification) },
    filters.caseStatus && { key: 'caseStatus', label: `Case: ${filters.caseStatus}` },
    filters.assigned && { key: 'assigned', label: labelFor(ASSIGNED_OPTIONS, filters.assigned) },
    filters.dateFrom && { key: 'dateFrom', label: `From ${filters.dateFrom}` },
    filters.dateTo && { key: 'dateTo', label: `To ${filters.dateTo}` },
  ].filter(Boolean).map((chip) => ({ ...chip, onRemove: () => updateFilter(chip.key, '') }));

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AppShell>
      <PageHeader
        title="Inspection records"
        description="Every inspection, including those still waiting for their gas or mobile result."
      />

      <div className="card overflow-hidden">
        <TabBar tab={tab} onSelect={selectTab} />

        <FilterBar
          search={filters.q}
          onSearch={(text) => updateFilter('q', text)}
          searchPlaceholder="Search inspection ID…"
          searchLabel="Search inspection ID"
          chips={chips}
          onClearAll={() => { setFilters((prev) => ({ ...EMPTY_FILTERS, q: prev.q })); setPage(0); }}
        >
          <FilterSelect label="Final classification" value={filters.classification}
            onChange={(v) => updateFilter('classification', v)} options={CLASSIFICATION_OPTIONS} />
          <FilterSelect label="Case status" value={filters.caseStatus}
            onChange={(v) => updateFilter('caseStatus', v)} options={CASE_STATUSES.map((s) => ({ value: s, label: s }))} />
          <FilterSelect label="Assigned inspector" value={filters.assigned}
            onChange={(v) => updateFilter('assigned', v)} options={ASSIGNED_OPTIONS} />
          <FilterSelect label="Sample type" value={filters.sampleType}
            onChange={(v) => updateFilter('sampleType', v)}
            options={SAMPLE_TYPES.map((s) => ({ value: s, label: titleCaseSample(s) }))} />
          <FilterSelect label="Source type" value={filters.sourceType}
            onChange={(v) => updateFilter('sourceType', v)}
            options={SOURCE_TYPES.map((s) => ({ value: s.id, label: s.label }))} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="dateFrom">From</label>
              <input id="dateFrom" type="date" className="input" value={filters.dateFrom}
                onChange={(e) => updateFilter('dateFrom', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="dateTo">To</label>
              <input id="dateTo" type="date" className="input" value={filters.dateTo}
                onChange={(e) => updateFilter('dateTo', e.target.value)} />
            </div>
          </div>
        </FilterBar>

        {/*
          DB-03 — sample type lives on the gas submission, so an unpaired
          mobile submission carries none and cannot match this filter.
        */}
        {filters.sampleType && (
          <p className="px-5 py-2 border-b border-surface-line bg-state-reviewBg/40 text-xs text-state-review">
            Sample type comes from the gas reading, so mobile-only records are hidden while this filter is on.
          </p>
        )}

        {error && <div className="p-5"><div className="alert-error">{error}</div></div>}
        {notice && (
          <p role="status" className={`${notice.tone === 'error' ? 'alert-error' : 'alert-success'} m-4`}>{notice.text}</p>
        )}

        {loading ? (
          <p className="p-8 text-sm text-ink-faint text-center">Loading records…</p>
        ) : records.length === 0 ? (
          <EmptyState hasFilters={chips.length > 0 || Boolean(filters.q) || tab !== 'all'} />
        ) : (
          <RecordTable records={records} staff={staff}
            canClaim={account.role === 'inspector'}
            onClaim={async (id) => {
              const { error: claimError } = await claimInspection(id);
              setNotice(claimError ? { tone: 'error', text: claimError } : { tone: 'success', text: 'Claimed. It is now assigned to you.' });
              load({ silent: true });
            }} />
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
    <div className="flex gap-1 px-3 pt-3 pb-0 border-b border-surface-line overflow-x-auto" role="tablist">
      {TABS.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={tab === item.id}
          onClick={() => onSelect(item.id)}
          className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
            tab === item.id
              ? 'border-brand-600 text-brand-700 font-medium'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// One line per record. Gas readings and the image result are on the record
// page; the list shows only what is needed to decide what to open.
function RecordTable({ records, staff, canClaim, onClaim }) {
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-surface-line text-left">
            <Th>Inspection ID</Th>
            <Th>Sample</Th>
            <Th>Pairing</Th>
            <Th>Result</Th>
            <Th>Case</Th>
            <Th>Inspector</Th>
            <Th>Recorded</Th>
            <Th className="w-px"><span className="sr-only">Open</span></Th>
          </tr>
        </thead>
        <tbody>
          {records.map((row) => {
            const href = `/records/${encodeURIComponent(row.inspection_id)}`;
            const inspector = row.assignment
              ? staffLabel(staff, row.assignment.inspector_id, row.assignment.inspector_name ?? '—')
              : '—';
            const paired = row.has_gas_submission && row.has_image_submission;
            return (
              <tr
                key={row.inspection_id}
                onClick={(e) => { if (!e.target.closest('a, button')) navigate(href); }}
                className="border-b border-surface-line last:border-0 hover:bg-surface-sunken/60 cursor-pointer"
              >
                <Td><InspectionId value={row.inspection_id} /></Td>
                <Td>{titleCaseSample(row.sample_type)}</Td>
                <Td className={paired ? 'font-medium text-ink' : 'text-ink-muted'} title={pairingLabel(row)}>{pairingShort(row)}</Td>
                <Td><ClassificationBadge value={row.final_classification} /></Td>
                <Td><StatusPill value={row.current_case_status} /></Td>
                <Td className="max-w-[13rem] truncate" title={inspector}>
                  <span className={row.assignment ? 'text-ink' : 'text-ink-faint'}>{inspector}</span>
                </Td>
                <Td className="text-ink-muted">{formatDate(row.created_at)}</Td>
                <Td className="text-right space-x-2">
                  {canClaim && !row.assignment && (
                    <button type="button" className="btn-primary text-xs py-1 px-3" disabled={claiming !== null}
                      onClick={async () => { setClaiming(row.inspection_id); await onClaim(row.inspection_id); setClaiming(null); }}>
                      {claiming === row.inspection_id ? 'Claiming…' : 'Claim'}
                    </button>
                  )}
                  <Link to={href} className="btn-secondary text-xs py-1 px-3">View</Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }) {
  return (
    <th className={`px-3 py-2.5 text-xs font-medium text-ink-muted whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '', title }) {
  return <td title={title} className={`px-3 py-2.5 align-middle whitespace-nowrap ${className}`}>{children}</td>;
}

// The identifier is shown abbreviated; the full value is on hover and on
// the record page.
function InspectionId({ value }) {
  const text = String(value ?? '');
  const short = text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
  return <span title={text} className="font-mono text-xs text-ink">{short}</span>;
}

function EmptyState({ hasFilters }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm text-ink">No records match this view.</p>
      {hasFilters && (
        <p className="text-sm text-ink-muted mt-1">Try clearing a filter, the search, or switching tabs.</p>
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
        <button className="btn-secondary text-xs py-1.5" onClick={onPrev} disabled={page === 0}>Previous</button>
        <button className="btn-secondary text-xs py-1.5" onClick={onNext} disabled={page >= lastPage}>Next</button>
      </div>
    </div>
  );
}
