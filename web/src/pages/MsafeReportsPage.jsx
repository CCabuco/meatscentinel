import { useEffect, useRef, useState } from 'react';
import useAutoRefresh from '../lib/useAutoRefresh.js';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatActivityTime } from '../lib/activity.js';
import { formatDate } from '../lib/format.js';
import FilterBar, { FilterSelect } from '../components/FilterBar.jsx';
import { useStaff, staffLabel } from '../lib/staff.js';
import {
  assignMsafeReport, claimMsafeReport, deleteMsafeDraft, getMsafeReport, linkMsafeInspection, listActiveInspectors,
  listMsafeDrafts, listMsafeHistory, listMsafeReports, listMsafeResponses, MSAFE_PAGE_SIZE, MSAFE_STATUSES,
  msafeStatusLabel, saveMsafeDraft, sendMsafeDraft,
} from '../lib/msafe.js';

const TYPE_FILTERS = [['all', 'All types'], ['consumer', 'Consumer'], ['supplier', 'Supplier']];
const EMPTY_FORM = { status: 'under_review', findings: '', actionTaken: '', inspectionDate: '', letterUrl: '', internalNotes: '' };
const EVENT_LABEL = { claimed: 'claimed the report', assigned: 'assigned', reassigned: 'reassigned to', linked: 'linked inspection', response_sent: 'sent a response' };

function StatusTag({ status }) {
  const tone = !status ? 'bg-brand-50 text-brand-700'
    : status === 'resolved' ? 'bg-state-freshBg text-state-fresh'
    : status === 'not_substantiated' ? 'bg-state-pendingBg text-state-pending'
    : 'bg-state-reviewBg text-state-review';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{msafeStatusLabel(status)}</span>;
}

function Field({ label, children }) {
  return <div><dt className="text-ink-muted">{label}</dt><dd className="break-words">{children ?? '—'}</dd></div>;
}

function mapLink(lat, lng) {
  return lat == null || lng == null ? null : `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

const STATUS_FILTERS = [['all', 'All statuses'], ['new', 'New'], ...MSAFE_STATUSES.map((st) => [st.id, st.label])];
const pick = (value, options, fallback) => (options.some(([id]) => id === value) ? value : fallback);

export default function MsafeReportsPage() {
  const { account } = useAuth();
  const staff = useStaff();
  const admin = account?.role === 'administrator';
  const views = [['all', 'All reports'], ['unassigned', 'Unassigned'], ...(!admin ? [['mine', 'Assigned to me']] : [['assigned', 'Assigned']])];

  // Filters live in the URL so Dashboard counters and record links can
  // open this page already filtered (?view=unassigned, ?status=new,
  // ?report=<id>).
  const [params, setParams] = useSearchParams();
  const view = pick(params.get('view'), views, 'all');
  const type = pick(params.get('type'), TYPE_FILTERS, 'all');
  const status = pick(params.get('status'), STATUS_FILTERS, 'all');
  const selectedId = params.get('report');

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === 'all') next.delete(key); else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => { setPage(0); }, [type, view, status]);

  // Auto refresh reloads the list quietly (no loading state, and a failed
  // refresh keeps the current list).
  const quiet = useRef(false);
  useAutoRefresh(() => { quiet.current = true; setRevision((r) => r + 1); });

  useEffect(() => {
    let cancelled = false;
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) { setLoading(true); setError(''); }
    listMsafeReports({ type, view, status, accountId: account.id, page })
      .then((r) => { if (!cancelled) { setRows(r.rows); setTotal(r.total); setError(''); } })
      .catch((err) => { if (!cancelled && !silent) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, view, status, page, account.id, revision]);

  const filtered = view !== 'all' || type !== 'all' || status !== 'all';

  return <AppShell>
    <PageHeader title="MSafe reports" description="Spoiled-meat reports sent by MSafe users and suppliers." />
    <details className="mb-4 text-sm text-ink-muted">
      <summary className="cursor-pointer text-brand-700 w-fit">How MSafe reports work</summary>
      <p className="mt-2 max-w-3xl">
        Claim a report (or have an administrator assign it), then write a response. Responses are saved as drafts first.
        When you choose Send to reporter, the response is locked and the reporter sees it from "MeatScentinel Inspector".
        Internal notes are never sent. Linking a report to an inspection uses its scan as that inspection's mobile result.
      </p>
    </details>

    <div className="card overflow-hidden">
      <div className="flex gap-1 px-3 pt-3 border-b border-surface-line overflow-x-auto" role="tablist" aria-label="Report view">
        {views.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => update({ view: id })}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${view === id
              ? 'border-brand-600 text-brand-700 font-medium' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      <FilterBar
        chips={[
          status !== 'all' && { key: 'status', label: `Status: ${STATUS_FILTERS.find(([id]) => id === status)?.[1]}`, onRemove: () => update({ status: null }) },
          type !== 'all' && { key: 'type', label: TYPE_FILTERS.find(([id]) => id === type)?.[1], onRemove: () => update({ type: null }) },
        ].filter(Boolean)}
        onClearAll={() => update({ status: null, type: null })}
        actions={<button className="btn-secondary" disabled={loading} onClick={() => setRevision((v) => v + 1)}>Refresh</button>}
      >
        <FilterSelect label="Status" value={status === 'all' ? '' : status} onChange={(v) => update({ status: v })}
          options={STATUS_FILTERS.filter(([id]) => id !== 'all').map(([value, label]) => ({ value, label }))} anyLabel="All statuses" />
        <FilterSelect label="Type" value={type === 'all' ? '' : type} onChange={(v) => update({ type: v })}
          options={TYPE_FILTERS.filter(([id]) => id !== 'all').map(([value, label]) => ({ value, label }))} anyLabel="All types" />
      </FilterBar>

      {error ? <div role="alert" className="alert-error m-4"><p>{error}</p><button className="btn-secondary mt-3" onClick={() => setRevision((v) => v + 1)}>Retry</button></div>
        : loading ? <p role="status" className="p-8 text-center text-sm text-ink-faint">Loading reports…</p>
        : rows.length === 0 ? <div className="p-8 text-center text-sm text-ink-muted">
            No MSafe reports match this view.
            {filtered && <div className="mt-3"><button className="btn-secondary" onClick={() => setParams({}, { replace: true })}>Clear filters</button></div>}
          </div>
        : <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
          <thead><tr className="border-b border-surface-line text-left">
            {['Report', 'Scan', 'From', 'Inspector', 'Status', 'Sent', 'Received'].map((h) => (
              <th key={h} className="px-3 py-2.5 text-xs font-medium text-ink-muted whitespace-nowrap">{h}</th>))}
            <th className="w-px"><span className="sr-only">Open</span></th>
          </tr></thead>
          <tbody>{rows.map((report) => {
            const from = report.report_type === 'supplier' ? report.supplier_name : report.purchase_location;
            const inspector = report.inspector_id ? staffLabel(staff, report.inspector_id, report.inspector_name) : 'Unassigned';
            return <tr key={report.msafe_report_id} onClick={(e) => { if (!e.target.closest('button')) update({ report: report.msafe_report_id }); }}
              className="border-b border-surface-line last:border-0 hover:bg-surface-sunken/60 cursor-pointer">
              <td className="px-3 py-2.5 whitespace-nowrap">
                <span className="capitalize">{report.report_type}</span>{' '}
                <span className="font-mono text-xs text-ink-faint" title={report.msafe_report_id}>{report.msafe_report_id.slice(0, 8)}…</span>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap capitalize">{[report.meat_type, report.scan_result].filter(Boolean).join(' · ') || '—'}</td>
              <td className="px-3 py-2.5 max-w-[12rem] truncate" title={from ?? ''}>{from || '—'}</td>
              <td className={`px-3 py-2.5 max-w-[14rem] truncate ${report.inspector_id ? '' : 'text-ink-faint'}`} title={inspector}>{inspector}</td>
              <td className="px-3 py-2.5 whitespace-nowrap"><StatusTag status={report.latest_status} /></td>
              <td className="px-3 py-2.5 tabular-nums">{report.response_count}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{formatDate(report.received_at)}</td>
              <td className="px-3 py-2.5 text-right"><button className="btn-secondary text-xs py-1 px-3"
                onClick={() => update({ report: report.msafe_report_id })}>View</button></td>
            </tr>;
          })}</tbody>
        </table></div>}
    </div>

    <div className="flex justify-between items-center mt-5 text-sm">
      <span className="text-ink-muted">{total} {total === 1 ? 'report' : 'reports'} · Page {page + 1} of {Math.max(1, Math.ceil(total / MSAFE_PAGE_SIZE))}</span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <button className="btn-secondary" disabled={loading || (page + 1) * MSAFE_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>

    {selectedId && <ReportDialog key={selectedId} reportId={selectedId} account={account}
      onClose={() => { update({ report: null }); setRevision((v) => v + 1); }} />}
  </AppShell>;
}

function ReportDialog({ reportId, account, onClose }) {
  const admin = account.role === 'administrator';
  const staff = useStaff();
  const dialog = useRef(null);
  const [report, setReport] = useState(null);
  const [responses, setResponses] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [history, setHistory] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [inspection, setInspection] = useState('');
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editingTime, setEditingTime] = useState(null);
  const formRef = useRef(null);
  const assignRef = useRef(null);
  const [sendTarget, setSendTarget] = useState(null);
  const [showPhoto, setShowPhoto] = useState(false);

  async function load() {
    setLoadError('');
    try {
      const [r, resp, dr, hist] = await Promise.all([
        getMsafeReport(reportId), listMsafeResponses(reportId), listMsafeDrafts(reportId), listMsafeHistory(reportId),
      ]);
      if (!r) throw new Error('Report not found.');
      setReport(r); setResponses(resp); setDrafts(dr); setHistory(hist);
      setAssignTo(r.inspector_id ?? ''); // the current inspector is shown selected
    } catch (err) { setLoadError(err.message); }
  }
  useEffect(() => {
    dialog.current.showModal();
    load();
    if (admin) listActiveInspectors().then(setInspectors).catch(() => setError('Could not load inspectors.'));
  }, []);

  async function act(fn, message) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (message) setNotice(message); await load(); return true; }
    catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const mine = drafts.filter((d) => d.author_id === account.id);
  const others = drafts.filter((d) => d.author_id !== account.id);
  const assignedToMe = report?.inspector_id === account.id;
  const canRespond = !!report && (admin || assignedToMe);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  async function saveDraft(event) {
    event.preventDefault();
    if (form.letterUrl && !/^https:\/\//.test(form.letterUrl.trim())) { setError('The letter link must start with https://'); return; }
    const ok = await act(() => saveMsafeDraft(reportId, editingId, form), editingId ? 'Draft updated.' : 'Draft saved. It has not been sent yet.');
    if (ok) { setForm(EMPTY_FORM); setEditingId(null); setEditingTime(null); }
  }
  function editDraft(d) {
    setEditingId(d.draft_id); setEditingTime(d.updated_at); setNotice(''); setError('');
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setForm({ status: d.status, findings: d.findings ?? '', actionTaken: d.action_taken ?? '', inspectionDate: d.inspection_date ?? '',
      letterUrl: d.letter_url ?? '', internalNotes: d.internal_notes ?? '' });
  }

  const supplier = report?.report_type === 'supplier';

  function jumpTo(ref) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => ref.current?.querySelector('select, textarea, input, button')?.focus({ preventScroll: true }));
  }

  // The one thing to do next, shown at the top so nobody has to scroll for it.
  let nextAction = null;
  if (report && !report.inspector_id && !admin) {
    nextAction = <button className="btn-primary" disabled={busy} onClick={() => act(() => claimMsafeReport(report), 'You claimed this report.')}>Claim report</button>;
  } else if (report && !report.inspector_id && admin) {
    nextAction = <button className="btn-primary" disabled={busy} onClick={() => jumpTo(assignRef)}>Assign inspector</button>;
  } else if (canRespond) {
    nextAction = <button className="btn-primary" disabled={busy} onClick={() => jumpTo(formRef)}>{mine.length ? 'Review drafts' : 'Write response'}</button>;
  }

  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="card p-0 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-lg text-ink backdrop:bg-ink/40" aria-labelledby="msafe-title">
    {/* Same look as the other pop-ups (Modal): title bar, body, divider lines. */}
    <div className="sticky top-0 z-10 bg-surface border-b border-surface-line px-6 pt-5 pb-4 space-y-3">
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <h2 id="msafe-title" className="capitalize">{report ? `${report.report_type} report` : 'MSafe report'}</h2>
          {report && <p className="font-mono text-xs text-ink-faint break-all mt-0.5">{report.msafe_report_id}</p>}
        </div>
        <button className="btn-secondary self-start" disabled={busy} onClick={onClose}>Close</button>
      </div>
      {report && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken border border-surface-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <StatusTag status={report.latest_status} />
          <span><span className="text-ink-muted">Inspector: </span>{report.inspector_id ? staffLabel(staff, report.inspector_id, report.inspector_name) : 'Unassigned'}{assignedToMe && ' (you)'}</span>
          {report.inspection_id && <span><span className="text-ink-muted">Inspection: </span>
            <Link className="text-brand-700 underline font-mono text-xs" to={`/records/${encodeURIComponent(report.inspection_id)}`}>{report.inspection_id.length > 14 ? `${report.inspection_id.slice(0, 8)}…${report.inspection_id.slice(-4)}` : report.inspection_id}</Link></span>}
          <span><span className="text-ink-muted">Sent: </span>{responses.length}</span>
          {mine.length > 0 && <span><span className="text-ink-muted">Your drafts: </span>{mine.length}</span>}
        </div>
        {nextAction}
      </div>}
      {error && <p role="alert" className="alert-error">{error}</p>}
      {notice && <p role="status" className="alert-success">{notice}</p>}
    </div>
    <div className="px-6 py-5 space-y-5">
      {loadError && <div role="alert" className="alert-error">{loadError} <button className="btn-secondary ml-2" onClick={load}>Retry</button></div>}
      {!report && !loadError && <p role="status" className="text-sm text-ink-faint">Loading…</p>}
      {report && <>

        <section className="space-y-3">
          <h3 className="font-medium">Scan</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Meat type"><span className="capitalize">{report.meat_type}</span></Field>
            <Field label="Scan result">{report.scan_result}</Field>
            <Field label="Confidence">{report.confidence != null ? `${report.confidence}%` : null}</Field>
            <Field label="Scanned">{report.scanned_at ? formatActivityTime(report.scanned_at) : null}</Field>
            <Field label="Submitted by user">{formatActivityTime(report.submitted_at)}</Field>
            <Field label="Received by MeatScentinel">{formatActivityTime(report.received_at)}</Field>
          </dl>
          {report.photo_url && (showPhoto
            ? <img className="max-h-72 w-full object-contain rounded-lg" src={report.photo_url} alt="Meat photo from the MSafe report"
                referrerPolicy="no-referrer" onError={() => setShowPhoto(false)} />
            : <button className="btn-secondary" onClick={() => setShowPhoto(true)}>Show photo</button>)}
        </section>

        <details className="border-t border-surface-line pt-4 group">
          <summary className="cursor-pointer font-medium flex flex-wrap items-baseline gap-x-2">
            {supplier ? 'Supplier details' : 'Purchase details'}
            <span className="text-sm font-normal text-ink-muted">
              {(supplier ? report.supplier_name : report.purchase_location) || 'Not given'}
              {' · '}<span className="text-brand-700 group-open:hidden">Show more</span><span className="text-brand-700 hidden group-open:inline">Show less</span>
            </span>
          </summary>
        {!supplier && <section className="pt-3 space-y-3">
          <h3 className="font-medium">Purchase</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Store or market">{report.purchase_location}</Field>
            <Field label="Address">{report.purchase_address}</Field>
            <Field label="Date">{report.purchase_date}</Field>
            <Field label="Time">{report.purchase_time}</Field>
            <Field label="Map">{mapLink(report.purchase_lat, report.purchase_lng) &&
              <a className="text-brand-700 underline" href={mapLink(report.purchase_lat, report.purchase_lng)} target="_blank" rel="noopener noreferrer">Open location</a>}</Field>
          </dl>
        </section>}

        {(supplier || report.supplier_name) && <section className="pt-3 space-y-3">
          <h3 className="font-medium">Supplier</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Name">{report.supplier_name}</Field>
            <Field label="Contact">{report.supplier_contact}</Field>
            <Field label="Address">{report.supplier_address}</Field>
            <Field label="Delivery date">{report.delivery_date}</Field>
            <Field label="Map">{mapLink(report.supplier_lat, report.supplier_lng) &&
              <a className="text-brand-700 underline" href={mapLink(report.supplier_lat, report.supplier_lng)} target="_blank" rel="noopener noreferrer">Open location</a>}</Field>
          </dl>
        </section>}

        {report.additional_details && <section className="pt-3 space-y-2">
          <h3 className="font-medium">Additional details</h3>
          <p className="text-sm whitespace-pre-wrap break-words">{report.additional_details}</p>
        </section>}

        </details>

        <section ref={assignRef} className="border-t border-surface-line pt-4 space-y-3 scroll-mt-48">
          <h3 className="font-medium">Assigned inspector</h3>
          <p className="text-sm">{report.inspector_id ? staffLabel(staff, report.inspector_id, report.inspector_name) : 'Unassigned'}{assignedToMe && ' (you)'}</p>
          {admin ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act(() => assignMsafeReport(report, assignTo), 'Assignment saved.'); }}>
            <select aria-label="Assign inspector" className="input flex-1 min-w-0" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} required disabled={busy}>
              <option value="">Choose an inspector</option>
              {inspectors.map((i) => <option key={i.id} value={i.id}>{i.display_name} ({i.user_id})</option>)}
            </select>
            <button className="btn-primary" disabled={busy || !assignTo || assignTo === report.inspector_id}>{report.inspector_id ? 'Reassign' : 'Assign'}</button>
          </form> : !report.inspector_id && <button className="btn-primary" disabled={busy} onClick={() => act(() => claimMsafeReport(report), 'You claimed this report.')}>Claim report</button>}
        </section>

        <section className="border-t border-surface-line pt-4 space-y-3">
          <h3 className="font-medium">Linked inspection</h3>
          <p className="text-xs text-ink-muted">Linking uses this report's scan as the inspection's mobile result, so the gas and mobile results pair.</p>
          {report.inspection_id
            ? <Link className="text-brand-700 underline break-all" to={`/records/${encodeURIComponent(report.inspection_id)}`}>{report.inspection_id}</Link>
            : canRespond && report.inspector_id
              ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act(() => linkMsafeInspection(report, inspection.trim()), 'Inspection linked.'); }}>
                  <label className="block text-sm">Inspection ID<input className="input w-full mt-1" value={inspection}
                    onChange={(e) => { setInspection(e.target.value); setLinkConfirmed(false); }} required disabled={busy} /></label>
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={linkConfirmed} onChange={(e) => setLinkConfirmed(e.target.checked)} required disabled={busy} />
                    I checked this is the same sample. The link cannot be changed later.</label>
                  <button className="btn-primary" disabled={busy || !linkConfirmed || !inspection.trim()}>Link inspection</button>
                </form>
              : <p className="text-sm text-ink-muted">{report.inspector_id ? 'The assigned inspector or an administrator can link an inspection.' : 'Assign or claim this report first.'}</p>}
        </section>

        <section className="border-t border-surface-line pt-4 space-y-3">
          <h3 className="font-medium">Sent responses</h3>
          {responses.length === 0 ? <p className="text-sm text-ink-muted">Nothing sent yet. The reporter sees this report as New.</p>
            : <ol className="space-y-3">{responses.map((r) => <li key={r.response_id} className="rounded-lg border border-surface-line p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><StatusTag status={r.status} />
                <span className="text-ink-muted">{formatActivityTime(r.responded_at)} · {r.author_name}{r.author_role === 'administrator' && ' (administrator)'}</span></div>
              {r.findings && <p className="mt-2 whitespace-pre-wrap break-words"><span className="text-ink-muted">Findings: </span>{r.findings}</p>}
              {r.action_taken && <p className="mt-1 whitespace-pre-wrap break-words"><span className="text-ink-muted">Action taken: </span>{r.action_taken}</p>}
              {r.inspection_date && <p className="mt-1"><span className="text-ink-muted">Inspected on: </span>{r.inspection_date}</p>}
              {r.letter_url && <p className="mt-1"><a className="text-brand-700 underline" href={r.letter_url} target="_blank" rel="noopener noreferrer">Open letter</a></p>}
              {r.internal_notes && <p className="mt-2 rounded bg-surface-sunken p-2 whitespace-pre-wrap break-words"><span className="text-ink-muted">Internal notes (staff only): </span>{r.internal_notes}</p>}
            </li>)}</ol>}
        </section>

        {canRespond && <section className="border-t border-surface-line pt-4 space-y-3">
          <h3 className="font-medium">Your drafts</h3>
          {mine.length === 0 ? <p className="text-sm text-ink-muted">No drafts.</p>
            : <ul className="space-y-2">{mine.map((d) => <li key={d.draft_id} className={`rounded-lg border border-dashed p-3 text-sm ${d.draft_id === editingId ? 'border-brand-500 bg-brand-50' : 'border-surface-line'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span><StatusTag status={d.status} /> <span className="text-ink-muted ml-2">Draft · {formatActivityTime(d.updated_at)}</span></span>
                <span className="flex gap-2">
                  <button className="btn-secondary" disabled={busy} onClick={() => editDraft(d)}>Edit</button>
                  <button className="btn-secondary" disabled={busy} onClick={async () => { if (await act(() => deleteMsafeDraft(d.draft_id), 'Draft deleted.') && d.draft_id === editingId) { setEditingId(null); setEditingTime(null); setForm(EMPTY_FORM); } }}>Delete</button>
                  <button className="btn-primary" disabled={busy} onClick={() => setSendTarget(d)}>Send to reporter</button>
                </span></div>
              {d.findings && <p className="mt-2 whitespace-pre-wrap break-words">{d.findings}</p>}
              {sendTarget?.draft_id === d.draft_id && <SendConfirm draft={d} busy={busy} onCancel={() => setSendTarget(null)}
                onSend={async () => { if (await act(() => sendMsafeDraft(d.draft_id), 'Sent. MSafe will receive it the next time their server checks.')) { if (d.draft_id === editingId) { setEditingId(null); setEditingTime(null); setForm(EMPTY_FORM); } setSendTarget(null); } }} />}
            </li>)}</ul>}
        </section>}

        {admin && others.length > 0 && <section className="border-t border-surface-line pt-4 space-y-2">
          <h3 className="font-medium">Other staff drafts (view only)</h3>
          <ul className="space-y-2">{others.map((d) => <li key={d.draft_id} className="text-sm rounded-lg border border-dashed border-surface-line p-3">
            <StatusTag status={d.status} /> <span className="text-ink-muted ml-2">{d.author_name} · {formatActivityTime(d.updated_at)}</span>
            {d.findings && <p className="mt-1 whitespace-pre-wrap break-words">{d.findings}</p>}
          </li>)}</ul>
        </section>}

        {canRespond ? <form ref={formRef} onSubmit={saveDraft}
          className={editingId ? 'rounded-lg border-2 border-brand-500 bg-brand-50 p-4 space-y-3 scroll-mt-48' : 'border-t border-surface-line pt-4 space-y-3 scroll-mt-48'}>
          <h3 className="font-medium">{editingId ? `Editing draft from ${formatActivityTime(editingTime)}` : 'New response draft'}</h3>
          {!editingId && <p className="text-xs text-ink-muted">Saving here creates a new draft. To change an existing draft, use its Edit button.</p>}
          <label className="block text-sm">Status
            <select className="input w-full mt-1" value={form.status} onChange={(e) => set('status', e.target.value)} disabled={busy} required>
              {MSAFE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></label>
          <label className="block text-sm">Findings (sent to the reporter)
            <textarea className="input w-full mt-1" rows={3} maxLength={4000} value={form.findings} onChange={(e) => set('findings', e.target.value)} disabled={busy} /></label>
          <label className="block text-sm">Action taken (sent to the reporter)
            <textarea className="input w-full mt-1" rows={2} maxLength={4000} value={form.actionTaken} onChange={(e) => set('actionTaken', e.target.value)} disabled={busy} /></label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">Inspection date (optional)
              <input type="date" className="input w-full mt-1" max={today} value={form.inspectionDate} onChange={(e) => set('inspectionDate', e.target.value)} disabled={busy} /></label>
            <label className="block text-sm">Letter link (optional)
              <input type="url" className="input w-full mt-1" placeholder="https://…" maxLength={2048} value={form.letterUrl} onChange={(e) => set('letterUrl', e.target.value)} disabled={busy} /></label>
          </div>
          <label className="block text-sm">Internal notes (staff only, never sent)
            <textarea className="input w-full mt-1" rows={2} maxLength={4000} value={form.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} disabled={busy} /></label>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{editingId ? 'Update this draft' : 'Save as new draft'}</button>
            {editingId && <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setEditingId(null); setEditingTime(null); setForm(EMPTY_FORM); }}>Cancel edit</button>}
          </div>
        </form> : <p className="border-t border-surface-line pt-4 text-sm text-ink-muted">
          {report.inspector_id ? 'Only the assigned inspector or an administrator can respond to this report.' : 'Claim this report to respond.'}</p>}

        {history.length > 0 && <details className="border-t border-surface-line pt-4 space-y-2">
          <summary className="cursor-pointer font-medium">History <span className="text-sm font-normal text-ink-muted">({history.length})</span></summary>
          <ul className="text-sm space-y-1">{history.map((e) => <li key={e.event_id}>
            <span className="text-ink-muted">{formatActivityTime(e.occurred_at)}</span> · {e.actor_name ?? 'Staff'} {EVENT_LABEL[e.action] ?? e.action}
            {(e.action === 'assigned' || e.action === 'reassigned') && e.inspector_name && ` ${e.inspector_name}`}
            {e.action === 'linked' && e.inspection_id && ` ${e.inspection_id}`}
          </li>)}</ul>
        </details>}

      </>}
    </div>
  </dialog>;
}

function SendConfirm({ draft, busy, onSend, onCancel }) {
  const sendRef = useRef(null);
  useEffect(() => { sendRef.current?.focus(); }, []);
  return <div role="alertdialog" aria-labelledby={`send-${draft.draft_id}`} className="mt-3 rounded-lg border border-brand-100 bg-surface p-3 space-y-3">
    <p id={`send-${draft.draft_id}`} className="font-medium text-brand-700">Send this response to the reporter?</p>
    <p>Status: {msafeStatusLabel(draft.status)}. It will appear as "MeatScentinel Inspector". After sending it cannot be edited or deleted. Internal notes are not sent.</p>
    <div className="flex gap-2">
      <button ref={sendRef} className="btn-primary" disabled={busy} onClick={onSend}>Send</button>
      <button className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}
