// Classification and case status are distinct fields with distinct
// vocabularies (V-02). They are styled differently on purpose so the
// two are never mistaken for one another on screen.

const CLASSIFICATION_STYLES = {
  Fresh: 'bg-state-freshBg text-state-fresh border-state-fresh/25',
  Spoiled: 'bg-state-spoiledBg text-state-spoiled border-state-spoiled/25',
  'For Review': 'bg-state-reviewBg text-state-review border-state-review/25',
};

export function ClassificationBadge({ value }) {
  if (!value) {
    return (
      <span className="inline-flex items-center rounded-md border border-state-pending/25 bg-state-pendingBg px-2 py-0.5 text-xs font-medium text-state-pending">
        Pending
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
        CLASSIFICATION_STYLES[value] ?? ''
      }`}
    >
      {value}
    </span>
  );
}

export function StatusPill({ value }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
      {value ?? '—'}
    </span>
  );
}

export function SourceMarks({ hasGas, hasImage }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={hasGas ? 'text-ink' : 'text-ink-faint/60'}>Gas</span>
      <span className="text-ink-faint/40" aria-hidden="true">+</span>
      <span className={hasImage ? 'text-ink' : 'text-ink-faint/60'}>Image</span>
    </span>
  );
}
