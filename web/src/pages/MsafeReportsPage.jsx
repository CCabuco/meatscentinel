import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatActivityTime } from '../lib/activity.js';
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

export default function MsafeReportsPage() {
  const { account } = useAuth();
  const admin = account?.role === 'administrator';
  const [type, setType] = useState('all');
  const [view, setView] = useState('all');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    listMsafeReports({ type, view, accountId: account.id, page })
      .then((r) => { if (!cancelled) { setRows(r.rows); setTotal(r.total); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, view, page, account.id, revision]);

  const views = [['all', 'All reports'], ['unassigned', 'Unassigned'], ...(!admin ? [['mine', 'Assigned to me']] : [])];

  return <AppShell>
    <PageHeader title="MSafe reports" description="Spoiled-meat reports sent by MSafe users and suppliers." />
    <div className="card p-4 mb-5 text-sm text-ink-muted">
      Claim a report (or have an administrator assign it), then write a response. Responses are saved as drafts first.
      When you choose Send to reporter, the response is locked and the reporter sees it from "MeatScentinel Inspector".
      Internal notes are never sent.
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex flex-wrap gap-2" aria-label="Report view">
        {views.map(([id, label]) => <button key={id} className={view === id ? 'btn-primary' : 'btn-secondary'}
          aria-pressed={view === id} onClick={() => { setView(id); setPage(0); }}>{label}</button>)}
      </div>
      <div className="flex gap-2">
        <select aria-label="Report type" className="input" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
          {TYPE_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button className="btn-secondary" disabled={loading} onClick={() => setRevision((v) => v + 1)}>Refresh</button>
      </div>
    </div>

    {error ? <div role="alert" className="card p-5"><p>{error}</p><button className="btn-secondary mt-3" onClick={() => setRevision((v) => v + 1)}>Retry</button></div>
      : loading ? <p role="status">Loading reports…</p>
      : rows.length === 0 ? <div className="card p-8 text-center text-ink-muted">No MSafe reports match this view.</div>
      : <div className="space-y-3">{rows.map((report) => <article className="card p-5" key={report.msafe_report_id}>
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="capitalize">{report.report_type} report
              {report.meat_type && <span className="text-sm font-normal"> · {report.meat_type}</span>}
              {report.scan_result && <span className="text-sm font-normal normal-case"> · {report.scan_result}</span>}
            </h2>
            <p className="text-xs font-mono text-ink-faint break-all mt-1">{report.msafe_report_id}</p>
          </div>
          <div className="flex items-center gap-3"><StatusTag status={report.latest_status} />
            <button className="btn-secondary" onClick={() => setSelectedId(report.msafe_report_id)}>View report</button></div>
        </div>
        <dl className="grid sm:grid-cols-4 gap-3 mt-4 text-sm">
          <Field label="Received">{formatActivityTime(report.received_at)}</Field>
          <Field label={report.report_type === 'supplier' ? 'Supplier' : 'Purchased at'}>
            {report.report_type === 'supplier' ? report.supplier_name : report.purchase_location}
          </Field>
          <Field label="Assigned inspector">{report.inspector_name ?? 'Unassigned'}</Field>
          <Field label="Responses sent">{report.response_count}</Field>
        </dl>
      </article>)}</div>}

    <div className="flex justify-between items-center mt-5 text-sm">
      <span>{total} reports · Page {page + 1}</span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <button className="btn-secondary" disabled={loading || (page + 1) * MSAFE_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>

    {selectedId && <ReportDialog key={selectedId} reportId={selectedId} account={account}
      onClose={() => { setSelectedId(null); setRevision((v) => v + 1); }} />}
  </AppShell>;
}

function ReportDialog({ reportId, account, onClose }) {
  const admin = account.role === 'administrator';
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

  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="rounded-xl p-0 w-full max-w-2xl max-h-[90vh] overflow-y-auto backdrop:bg-black/40" aria-labelledby="msafe-title">
    <div className="p-6 space-y-5">
      <div className="flex justify-between gap-3">
        <h2 id="msafe-title" className="capitalize">{report ? `${report.report_type} report` : 'MSafe report'}</h2>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>
      </div>
      {loadError && <div role="alert" className="text-sm">{loadError} <button className="btn-secondary ml-2" onClick={load}>Retry</button></div>}
      {!report && !loadError && <p role="status">Loading…</p>}
      {report && <>
        <p className="font-mono text-xs break-all">{report.msafe_report_id}</p>

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

        {!supplier && <section className="border-t border-surface-line pt-4 space-y-3">
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

        {(supplier || report.supplier_name) && <section className="border-t border-surface-line pt-4 space-y-3">
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

        {report.additional_details && <section className="border-t border-surface-line pt-4 space-y-2">
          <h3 className="font-medium">Additional details</h3>
          <p className="text-sm whitespace-pre-wrap break-words">{report.additional_details}</p>
        </section>}

        <section className="border-t border-surface-line pt-4 space-y-3">
          <h3 className="font-medium">Assigned inspector</h3>
          <p className="text-sm">{report.inspector_name ?? 'Unassigned'}{assignedToMe && ' (you)'}</p>
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
            </li>)}</ul>}
        </section>}

        {admin && others.length > 0 && <section className="border-t border-surface-line pt-4 space-y-2">
          <h3 className="font-medium">Other staff drafts (view only)</h3>
          <ul className="space-y-2">{others.map((d) => <li key={d.draft_id} className="text-sm rounded-lg border border-dashed border-surface-line p-3">
            <StatusTag status={d.status} /> <span className="text-ink-muted ml-2">{d.author_name} · {formatActivityTime(d.updated_at)}</span>
            {d.findings && <p className="mt-1 whitespace-pre-wrap break-words">{d.findings}</p>}
          </li>)}</ul>
        </section>}

        {sendTarget && <div role="alertdialog" aria-labelledby="send-title" className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm space-y-3">
          <p id="send-title" className="font-medium text-brand-700">Send this response to the reporter?</p>
          <p>Status: {msafeStatusLabel(sendTarget.status)}. It will appear as "MeatScentinel Inspector". After sending it cannot be edited or deleted. Internal notes are not sent.</p>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={async () => { if (await act(() => sendMsafeDraft(sendTarget.draft_id), 'Sent. MSafe will receive it the next time their server checks.')) { if (sendTarget.draft_id === editingId) { setEditingId(null); setEditingTime(null); setForm(EMPTY_FORM); } setSendTarget(null); } }}>Send</button>
            <button className="btn-secondary" disabled={busy} onClick={() => setSendTarget(null)}>Cancel</button>
          </div>
        </div>}

        {canRespond ? <form ref={formRef} onSubmit={saveDraft}
          className={editingId ? 'rounded-lg border-2 border-brand-500 bg-brand-50 p-4 space-y-3' : 'border-t border-surface-line pt-4 space-y-3'}>
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

        {history.length > 0 && <section className="border-t border-surface-line pt-4 space-y-2">
          <h3 className="font-medium">History</h3>
          <ul className="text-sm space-y-1">{history.map((e) => <li key={e.event_id}>
            <span className="text-ink-muted">{formatActivityTime(e.occurred_at)}</span> · {e.actor_name ?? 'Staff'} {EVENT_LABEL[e.action] ?? e.action}
            {(e.action === 'assigned' || e.action === 'reassigned') && e.inspector_name && ` ${e.inspector_name}`}
            {e.action === 'linked' && e.inspection_id && ` ${e.inspection_id}`}
          </li>)}</ul>
        </section>}

        {error && <p role="alert" className="text-sm text-state-spoiled">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </>}
    </div>
  </dialog>;
}
