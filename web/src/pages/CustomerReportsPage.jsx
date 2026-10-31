import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell, { PageHeader } from '../components/AppShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { formatActivityTime } from '../lib/activity.js';
import { callReportService, listCustomerReports, logReportView, manageReport, REPORT_PAGE_SIZE } from '../lib/customerReports.js';

export default function CustomerReportsPage() {
  const { account } = useAuth();
  const admin = account?.role === 'administrator';
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    listCustomerReports(filter, account.id, page).then((result) => {
      if (!cancelled) { setRows(result.rows); setTotal(result.total); }
    }).catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter, page, account.id, revision]);

  async function sync(older = false) {
    setSyncing(true); setNotice('');
    try {
      const result = await callReportService({ action: 'sync', before: older ? cursor : null });
      setCursor(result.next);
      setNotice(`${result.imported} mobile scans refreshed.${result.next ? ' More scans are available using Load older scans.' : ''}`);
      setRevision((value) => value + 1);
    } catch (err) { setNotice(err.message); }
    finally { setSyncing(false); }
  }

  return <AppShell>
    <PageHeader title="Customer Reports" description="Inspection results from the CheckMeat mobile app." />
    <div className="card p-4 mb-5 text-sm text-ink-muted">
      Claim a mobile report or assign an inspector, then link it to the matching MeatScentinel inspection.
      Linking carries the assignment into inspection records. It does not import an image submission or run classification.
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex gap-2" aria-label="Report filters">
        {[['all', 'All reports'], ['unassigned', 'Unassigned'], ...(!admin ? [['mine', 'Assigned to me']] : [])].map(([id, label]) =>
          <button key={id} className={filter === id ? 'btn-primary' : 'btn-secondary'} aria-pressed={filter === id}
            onClick={() => { setFilter(id); setPage(0); }}>{label}</button>)}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={syncing} onClick={() => sync(false)}>{syncing ? 'Connecting…' : 'Refresh from CheckMeat'}</button>
        {cursor && <button className="btn-secondary" disabled={syncing} onClick={() => sync(true)}>Load older scans</button>}
      </div>
    </div>
    {notice && <p className="card p-4 mb-4 text-sm" role="status">{notice}</p>}
    {error ? <div role="alert" className="card p-5"><p>{error}</p><button className="btn-secondary mt-3" onClick={() => setRevision((v) => v + 1)}>Retry</button></div>
      : loading ? <p role="status">Loading reports…</p>
      : rows.length === 0 ? <div className="card p-8 text-center text-ink-muted">No saved reports match this view. Use Refresh from CheckMeat to retrieve mobile scans.</div>
      : <div className="space-y-3">{rows.map((report) => <article className="card p-5" key={report.scan_id}>
        <div className="flex flex-wrap justify-between gap-3">
          <div><h2 className="capitalize">{report.meat_type} <span className="text-sm font-normal">· {report.classification}</span></h2>
            <p className="text-xs font-mono text-ink-faint break-all mt-1">{report.scan_id}</p></div>
          <button className="btn-secondary" onClick={() => setSelected(report)}>View report</button>
        </div>
        <dl className="grid sm:grid-cols-3 gap-3 mt-4 text-sm">
          <div><dt className="text-ink-muted">Scanned</dt><dd>{formatActivityTime(report.scanned_at)}</dd></div>
          <div><dt className="text-ink-muted">Assigned inspector</dt><dd>{report.inspector_name ? `${report.inspector_name} (${report.inspector_user_id})` : 'Unassigned'}</dd></div>
          <div><dt className="text-ink-muted">Inspection record</dt><dd>{report.inspection_id ? <Link className="text-brand-700 underline break-all" to={`/records/${encodeURIComponent(report.inspection_id)}`}>{report.inspection_id}</Link> : 'Not linked'}</dd></div>
        </dl>
      </article>)}</div>}
    <div className="flex justify-between items-center mt-5 text-sm">
      <span>{total} saved reports · Page {page + 1}</span>
      <div className="flex gap-2"><button className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <button className="btn-secondary" disabled={loading || (page + 1) * REPORT_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button></div>
    </div>
    {selected && <ReportDialog key={selected.scan_id} report={selected} account={account} onClose={() => setSelected(null)}
      onChanged={() => { setSelected(null); setRevision((v) => v + 1); }} />}
  </AppShell>;
}

function ReportDialog({ report, account, onClose, onChanged }) {
  const admin = account.role === 'administrator';
  const dialog = useRef(null);
  const [inspectors, setInspectors] = useState([]);
  const [inspector, setInspector] = useState(report.inspector_id ?? '');
  const [inspection, setInspection] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState(null);
  const [imageError, setImageError] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [auditErrors, setAuditErrors] = useState({});
  const events = useRef({ report_viewed: crypto.randomUUID(), report_image_viewed: crypto.randomUUID() });
  const displayed = useRef(false);

  async function audit(action) {
    if (admin) return;
    try { await logReportView(report.scan_id, action, events.current[action]); setAuditErrors((errors) => ({ ...errors, [action]: '' })); }
    catch (err) { setAuditErrors((errors) => ({ ...errors, [action]: err.message })); }
  }
  useEffect(() => {
    dialog.current.showModal();
    audit('report_viewed');
    if (admin) {
      let cancelled = false;
      supabase.from('accounts').select('id,user_id,display_name').eq('role', 'inspector').eq('is_active', true).order('user_id')
        .then(({ data, error: loadError }) => { if (!cancelled) { setInspectors(data ?? []); if (loadError) setError('Could not load inspectors. Close and reopen this report to retry.'); } });
      return () => { cancelled = true; };
    }
  }, []);

  async function act(action, fields) {
    setBusy(true); setError('');
    try { await manageReport(report, action, fields); onChanged(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function loadImage() {
    setImageLoading(true); setImageError(''); setImage(null);
    try { const result = await callReportService({ action: 'image', scan_id: report.scan_id }); setImage(result.url); }
    catch (err) { setImageError(err.message); }
    finally { setImageLoading(false); }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="rounded-xl p-0 w-full max-w-xl max-h-[90vh] overflow-y-auto backdrop:bg-black/40" aria-labelledby="report-title">
    <div className="p-6 space-y-5">
      <div className="flex justify-between gap-3"><h2 id="report-title">Mobile inspection report</h2><button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button></div>
      <p className="font-mono text-xs break-all">{report.scan_id}</p>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-muted">Meat type</dt><dd className="capitalize">{report.meat_type}</dd></div>
        <div><dt className="text-ink-muted">Mobile result</dt><dd>{report.classification}</dd></div>
        <div><dt className="text-ink-muted">Scanned</dt><dd>{formatActivityTime(report.scanned_at)}</dd></div>
        <div><dt className="text-ink-muted">Last refreshed</dt><dd>{formatActivityTime(report.synced_at)}</dd></div>
      </dl>
      <section className="border-t border-surface-line pt-4">
        <button className="btn-secondary" disabled={imageLoading} onClick={loadImage}>{imageLoading ? 'Loading image…' : image ? 'Refresh image' : 'View scan image'}</button>
        {imageError && <p className="mt-3 text-sm" role="alert">{imageError}</p>}
        {image && <img className="mt-3 max-h-72 w-full object-contain rounded-lg" src={image} alt="Meat sample from the mobile inspection" referrerPolicy="no-referrer"
          onLoad={() => { displayed.current = true; audit('report_image_viewed'); }} onError={() => setImageError('The photo could not be loaded. Try refreshing the image.')} />}
      </section>
      {Object.values(auditErrors).some(Boolean) && <div role="alert" className="text-sm">Could not record viewing activity.<button className="btn-secondary ml-2" onClick={async () => { await audit('report_viewed'); if (displayed.current) await audit('report_image_viewed'); }}>Retry logging</button></div>}
      <section className="border-t border-surface-line pt-4 space-y-3">
        <h3 className="font-medium">Assigned inspector</h3>
        <p className="text-sm">{report.inspector_name ? `${report.inspector_name} (${report.inspector_user_id})` : 'Unassigned'}</p>
        {admin ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); act('assign', { p_inspector: inspector }); }}>
          <select aria-label="Assign inspector" className="input flex-1 min-w-0" value={inspector} onChange={(event) => setInspector(event.target.value)} required disabled={busy}>
            <option value="">Choose an inspector</option>{inspectors.map((item) => <option key={item.id} value={item.id}>{item.display_name} ({item.user_id})</option>)}
          </select><button className="btn-primary" disabled={busy || !inspector || inspector === report.inspector_id}>Assign</button>
        </form> : !report.inspector_id && <button className="btn-primary" disabled={busy} onClick={() => act('claim')}>Claim report</button>}
      </section>
      <section className="border-t border-surface-line pt-4 space-y-3">
        <h3 className="font-medium">Linked inspection</h3>
        {report.inspection_id ? <Link className="text-brand-700 underline break-all" to={`/records/${encodeURIComponent(report.inspection_id)}`}>{report.inspection_id}</Link>
          : report.inspector_id && (admin || report.inspector_id === account.id) ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); act('link', { p_inspection: inspection.trim() }); }}>
            <label className="block text-sm">Inspection ID<input className="input w-full mt-1" placeholder="MS-DEV-01-YYYYMMDD-NNNN" value={inspection} onChange={(event) => { setInspection(event.target.value); setConfirmed(false); }} required disabled={busy} /></label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required disabled={busy} />I checked that this is the same sample. This link cannot be changed here.</label>
            <button className="btn-primary" disabled={busy || !confirmed || !inspection.trim()}>Link inspection</button>
          </form> : <p className="text-sm text-ink-muted">{report.inspector_id ? 'The assigned inspector or an administrator can link this report.' : 'Assign or claim this report before linking an inspection.'}</p>}
      </section>
      {error && <p role="alert" className="text-sm text-state-spoiled">{error}</p>}
      {busy && <p role="status" className="text-sm">Saving…</p>}
    </div>
  </dialog>;
}
