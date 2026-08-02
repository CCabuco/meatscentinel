import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import { ClassificationBadge } from '../components/Badge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDateTime, formatPpm, titleCaseSample } from '../lib/format.js';
import {
  getRecord,
  getTimeline,
  addRemark,
  changeCaseStatus,
  getImageUrl,
  CASE_STATUSES,
} from '../lib/records.js';

export default function RecordDetailPage() {
  const { inspectionId } = useParams();
  const { account } = useAuth();

  const [record, setRecord] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { record: row, error: recordError } = await getRecord(inspectionId);

    if (recordError || !row) {
      setError(recordError ?? 'That inspection record was not found.');
      setLoading(false);
      return;
    }

    const { timeline: entries } = await getTimeline(inspectionId);
    setRecord(row);
    setTimeline(entries);
    setError(null);
    setLoading(false);

    if (row.image_path) {
      setImageUrl(await getImageUrl(row.image_path));
    }
  }, [inspectionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-faint">Loading record…</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="alert-error mb-4">{error}</div>
        <Link to="/records" className="btn-secondary">Back to records</Link>
      </AppShell>
    );
  }

  const currentStatus = timeline.filter((e) => e.kind === 'status').at(-1)?.status ?? null;

  return (
    <AppShell>
      <div className="mb-6">
        <Link to="/records" className="text-sm text-brand-600 hover:text-brand-700">
          ← Inspection records
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="font-mono">{record.inspection_id}</h1>
          <ClassificationBadge value={record.final_classification} />
          {record.pairing_state === 'pending' && (
            <span className="text-xs text-ink-muted">Waiting for its counterpart</span>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <FusionPanel record={record} />
          <DetailPanel record={record} currentStatus={currentStatus} />
          <ImagePanel record={record} imageUrl={imageUrl} />
        </div>

        <div className="space-y-6">
          <ActionsPanel
            record={record}
            account={account}
            currentStatus={currentStatus}
            onDone={load}
          />
          <TimelinePanel timeline={timeline} />
        </div>
      </div>
    </AppShell>
  );
}

// Shows how the classification was reached, not just what it was. A
// record that reads "For Review" is otherwise opaque — this says which
// input was missing or invalid.
function FusionPanel({ record }) {
  const pending = record.pairing_state === 'pending';

  return (
    <section className="card p-5">
      <h2 className="mb-4">Decision fusion</h2>

      <div className="grid sm:grid-cols-3 gap-3 items-stretch">
        <InputCard
          label="Gas-based result"
          present={record.has_gas_submission}
          valid={record.gas_is_valid}
          value={record.gas_result}
          missingText="No gas submission yet"
          invalidText="Reading invalid"
        />
        <InputCard
          label="Image-based result"
          present={record.has_image_submission}
          valid={record.image_is_valid}
          value={record.image_result}
          missingText="No mobile submission yet"
          invalidText="Submission incomplete"
        />
        <div className="rounded-lg border border-surface-line bg-surface-sunken p-3 flex flex-col justify-between">
          <p className="text-xs font-medium text-ink-muted">Final classification</p>
          <div className="mt-2">
            <ClassificationBadge value={record.final_classification} />
          </div>
          <p className="text-xs text-ink-faint mt-2">
            {record.classified_at ? formatDateTime(record.classified_at) : 'Not yet classified'}
          </p>
        </div>
      </div>

      <p className="text-xs text-ink-faint mt-4">
        {pending
          ? 'Fusion runs automatically once both submissions are paired by inspection ID.'
          : 'Written once when the pair completed. Classifications are not recomputed.'}
      </p>
    </section>
  );
}

function InputCard({ label, present, valid, value, missingText, invalidText }) {
  let body;
  if (!present) body = <span className="text-sm text-ink-faint">{missingText}</span>;
  else if (!valid) body = <span className="text-sm text-state-review">{invalidText}</span>;
  else body = <span className="text-sm text-ink">{value}</span>;

  return (
    <div className="rounded-lg border border-surface-line bg-surface-sunken p-3 flex flex-col justify-between">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <div className="mt-2">{body}</div>
      <p className="text-xs text-ink-faint mt-2">
        {present ? 'Received' : 'Awaiting'}
      </p>
    </div>
  );
}

function DetailPanel({ record, currentStatus }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4">Inspection details</h2>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        <Detail label="Inspection ID" value={record.inspection_id} mono />
        <Detail label="Sample type" value={titleCaseSample(record.sample_type)} />
        <Detail
          label="Source type"
          value={sourceLabel(record.has_gas_submission, record.has_image_submission)}
        />
        <Detail label="Recorded" value={formatDateTime(record.created_at)} />
        <Detail label="Final averaged NH₃" value={formatPpm(record.nh3_ppm)} />
        <Detail label="Final averaged H₂S" value={formatPpm(record.h2s_ppm)} />
        <Detail label="Gas-based result" value={record.gas_result ?? '—'} />
        <Detail label="External image-based result" value={record.image_result ?? '—'} />
        <Detail label="Current case status" value={currentStatus ?? '—'} />
      </dl>
    </section>
  );
}

function sourceLabel(hasGas, hasImage) {
  if (hasGas && hasImage) return 'IoT gas device and mobile application';
  if (hasGas) return 'IoT gas device';
  if (hasImage) return 'Mobile application';
  return '—';
}

function Detail({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted mb-0.5">{label}</dt>
      <dd className={`text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function ImagePanel({ record, imageUrl }) {
  if (!record.has_image_submission) return null;

  return (
    <section className="card p-5">
      <h2 className="mb-1">Image documentation</h2>
      <p className="text-sm text-ink-muted mb-4">
        Stored for documentation only. MeatScentinel does not analyse this image.
      </p>

      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Inspection sample for ${record.inspection_id}`}
          className="rounded-lg border border-surface-line max-h-80 object-contain bg-surface-sunken"
        />
      ) : (
        <p className="text-sm text-ink-faint">
          {record.image_path ? 'Image could not be loaded.' : 'No image file was submitted.'}
        </p>
      )}
    </section>
  );
}

// V-16 — a remark can be added without a status change, and a status can
// be changed without a remark. Two separate forms, deliberately.
function ActionsPanel({ record, account, currentStatus, onDone }) {
  const [remark, setRemark] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function submitRemark(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const { error } = await addRemark(record.inspection_id, account.id, remark);
    setBusy(false);
    if (error) return setFeedback({ tone: 'error', message: error });
    setRemark('');
    setFeedback({ tone: 'success', message: 'Remark added.' });
    onDone();
  }

  async function submitStatus(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const { error } = await changeCaseStatus(record.inspection_id, account.id, status);
    setBusy(false);
    if (error) return setFeedback({ tone: 'error', message: error });
    setStatus('');
    setFeedback({ tone: 'success', message: 'Case status updated.' });
    onDone();
  }

  return (
    <section className="card p-5">
      <h2 className="mb-4">Record an entry</h2>

      {feedback && (
        <div className={`${feedback.tone === 'error' ? 'alert-error' : 'alert-success'} mb-4`}>
          {feedback.message}
        </div>
      )}

      <form onSubmit={submitRemark} className="space-y-2 mb-5">
        <label className="label" htmlFor="remark">Add a remark</label>
        <textarea
          id="remark"
          className="input min-h-[80px] resize-y"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Observations for this record"
          maxLength={2000}
        />
        <button type="submit" className="btn-primary w-full" disabled={busy || !remark.trim()}>
          Add remark
        </button>
      </form>

      <form onSubmit={submitStatus} className="space-y-2 pt-5 border-t border-surface-line">
        <label className="label" htmlFor="status">Change case status</label>
        <select
          id="status"
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Select a status</option>
          {CASE_STATUSES.filter((s) => s !== currentStatus).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="submit" className="btn-secondary w-full" disabled={busy || !status}>
          Update status
        </button>
      </form>

      <p className="text-xs text-ink-faint mt-4">
        Entries are permanent. Previous remarks and statuses are never removed
        or reset.
      </p>
    </section>
  );
}

// V-15 — remarks and status changes in one combined chronological
// timeline. V-14 — every entry carries its author and timestamp.
function TimelinePanel({ timeline }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4">Remarks and status history</h2>

      {timeline.length === 0 ? (
        <p className="text-sm text-ink-faint">No entries yet.</p>
      ) : (
        <ol className="space-y-4">
          {timeline.map((entry) => (
            <li key={entry.key} className="relative pl-5">
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${
                  entry.kind === 'status' ? 'bg-brand-500' : 'bg-ink-faint/50'
                }`}
              />
              {entry.kind === 'status' ? (
                <p className="text-sm text-ink">
                  Status set to <span className="font-medium">{entry.status}</span>
                </p>
              ) : (
                <p className="text-sm text-ink whitespace-pre-wrap">{entry.content}</p>
              )}
              <p className="text-xs text-ink-faint mt-1">
                {entry.author} · {formatDateTime(entry.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
