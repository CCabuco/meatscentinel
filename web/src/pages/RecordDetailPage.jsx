import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import Modal from '../components/Modal.jsx';
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
  const [feedback, setFeedback] = useState(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

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
        <Link to="/records" className="btn-secondary">
          Back to records
        </Link>
      </AppShell>
    );
  }

  const statusEntries = timeline.filter((e) => e.kind === 'status');
  const remarkEntries = timeline.filter((e) => e.kind === 'remark');
  const currentStatus = statusEntries.at(-1)?.status ?? null;
  const currentRemark = remarkEntries.at(-1) ?? null;

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

      {feedback && (
        <div className={`${feedback.tone === 'error' ? 'alert-error' : 'alert-success'} mb-4`}>
          {feedback.message}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <FusionPanel record={record} />
          <DetailPanel record={record} currentStatus={currentStatus} />
          <ImagePanel record={record} imageUrl={imageUrl} />
        </div>

        <div className="space-y-6">
          <RemarksPanel
            currentRemark={currentRemark}
            entryCount={timeline.length}
            onViewHistory={() => setHistoryOpen(true)}
            onCreate={() => setRemarkOpen(true)}
          />
          <StatusPanel
            currentStatus={currentStatus}
            onChange={() => setStatusOpen(true)}
          />
        </div>
      </div>

      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        inspectionId={record.inspection_id}
        timeline={timeline}
      />

      <CreateRemarkModal
        open={remarkOpen}
        onClose={() => setRemarkOpen(false)}
        inspectionId={record.inspection_id}
        accountId={account.id}
        onCreated={(message) => {
          setRemarkOpen(false);
          setFeedback({ tone: 'success', message });
          load();
        }}
      />

      <ChangeStatusModal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        inspectionId={record.inspection_id}
        accountId={account.id}
        currentStatus={currentStatus}
        onChanged={(message) => {
          setStatusOpen(false);
          setFeedback({ tone: 'success', message });
          load();
        }}
      />
    </AppShell>
  );
}

// Shows how the classification was reached, not just what it was. A record
// reading "For Review" is otherwise opaque — this says which input was
// missing or invalid.
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
      <p className="text-xs text-ink-faint mt-2">{present ? 'Received' : 'Awaiting'}</p>
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

// Only the most recent remark is shown. The full sequence is one click away
// rather than filling the page — but it is never summarised or truncated in
// a way that hides an entry, since the whole point of the log is that
// nothing disappears.
function RemarksPanel({ currentRemark, entryCount, onViewHistory, onCreate }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4">Remarks</h2>

      <div className="rounded-lg border border-surface-line bg-surface-sunken p-3 mb-3">
        <p className="text-xs font-medium text-ink-muted mb-1">Current remark</p>
        {currentRemark ? (
          <>
            <p className="text-sm text-ink whitespace-pre-wrap">{currentRemark.content}</p>
            <p className="text-xs text-ink-faint mt-2">
              {currentRemark.author} · {formatDateTime(currentRemark.at)}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-faint">No remarks recorded yet.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary text-xs py-1.5" onClick={onCreate}>
          Create remark
        </button>
        <button className="btn-secondary text-xs py-1.5" onClick={onViewHistory}>
          View history
          {entryCount > 0 && <span className="ml-1.5 text-ink-faint">{entryCount}</span>}
        </button>
      </div>

      <p className="text-xs text-ink-faint mt-3">
        Remarks are permanent. Nothing is edited or removed.
      </p>
    </section>
  );
}

// V-16 — a status change is independent of a remark. Separate action,
// separate dialog; neither requires the other.
function StatusPanel({ currentStatus, onChange }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4">Case status</h2>

      <div className="rounded-lg border border-surface-line bg-surface-sunken p-3 mb-3">
        <p className="text-xs font-medium text-ink-muted mb-1">Current status</p>
        <p className="text-sm text-ink">{currentStatus ?? '—'}</p>
      </div>

      <button className="btn-secondary text-xs py-1.5" onClick={onChange}>
        Change status
      </button>

      <p className="text-xs text-ink-faint mt-3">
        Previous statuses are kept. Changing the status adds an entry rather
        than replacing one.
      </p>
    </section>
  );
}

// V-14, V-15 — the combined chronological timeline, with every entry's author
// and timestamp.
function HistoryModal({ open, onClose, inspectionId, timeline }) {
  return (
    <Modal
      open={open}
      title="Remarks and status history"
      description={`Complete record for ${inspectionId}, oldest first.`}
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
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
    </Modal>
  );
}

// Two steps: compose, then confirm. A remark cannot be edited or deleted
// once written, so the confirmation is the only chance to catch a mistake.
function CreateRemarkModal({ open, onClose, inspectionId, accountId, onCreated }) {
  const [content, setContent] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    setContent('');
    setConfirming(false);
    setError(null);
    onClose();
  }

  async function confirmCreate() {
    setBusy(true);
    setError(null);

    const { error: createError } = await addRemark(inspectionId, accountId, content);
    setBusy(false);

    if (createError) {
      setConfirming(false);
      setError(createError);
      return;
    }

    setContent('');
    setConfirming(false);
    onCreated('Remark added.');
  }

  return (
    <>
      <Modal
        open={open && !confirming}
        title="Create remark"
        description={`This will be added to the record for ${inspectionId}.`}
        onClose={close}
        footer={
          <>
            <button className="btn-secondary" onClick={close}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => setConfirming(true)}
              disabled={!content.trim()}
            >
              Add remark
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="alert-error">{error}</div>}

          <div>
            <label className="label" htmlFor="remarkContent">
              Remark
            </label>
            <textarea
              id="remarkContent"
              className="input min-h-[120px] resize-y"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Observations for this record"
              maxLength={2000}
            />
            <p className="text-xs text-ink-faint mt-1.5">
              {content.length}/2000 characters
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={open && confirming}
        title="Add this remark?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Back
            </button>
            <button className="btn-primary" onClick={confirmCreate} disabled={busy}>
              {busy ? 'Adding…' : 'Yes, add remark'}
            </button>
          </>
        }
      >
        <div className="rounded-lg border border-surface-line bg-surface-sunken p-3">
          <p className="text-sm text-ink whitespace-pre-wrap">{content}</p>
        </div>

        <p className="text-xs text-ink-faint mt-4">
          Remarks cannot be edited or removed once added. It will be recorded
          against your name with the current date and time.
        </p>
      </Modal>
    </>
  );
}

function ChangeStatusModal({
  open,
  onClose,
  inspectionId,
  accountId,
  currentStatus,
  onChanged,
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    setStatus('');
    setError(null);
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const { error: statusError } = await changeCaseStatus(inspectionId, accountId, status);
    setBusy(false);

    if (statusError) {
      setError(statusError);
      return;
    }

    setStatus('');
    onChanged(`Case status set to ${status}.`);
  }

  return (
    <Modal
      open={open}
      title="Change case status"
      description={`Current status: ${currentStatus ?? '—'}`}
      onClose={close}
      footer={
        <>
          <button className="btn-secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !status}>
            {busy ? 'Updating…' : 'Update status'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="alert-error">{error}</div>}

        <div>
          <label className="label" htmlFor="newStatus">
            New status
          </label>
          <select
            id="newStatus"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Select a status</option>
            {CASE_STATUSES.filter((s) => s !== currentStatus).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-ink-faint">
          This adds an entry to the history. The previous status is kept.
        </p>
      </div>
    </Modal>
  );
}
