import { useEffect, useId, useState } from 'react';

// One-line filter bar used by every list page:
//   [ search…            ] [Filters (2)]
//   Active: Spoiled ✕  Assigned to me ✕  Clear all
// The full set of filters opens in a panel under the bar. Children are
// the filter fields shown in that panel.
export default function FilterBar({
  search, onSearch, searchPlaceholder = 'Search…', searchLabel = 'Search',
  chips = [], onClearAll, children, actions,
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const [text, setText] = useState(search ?? '');

  // Search waits for a short pause in typing before it runs.
  useEffect(() => { setText(search ?? ''); }, [search]);
  useEffect(() => {
    if (!onSearch || text === (search ?? '')) return undefined;
    const timer = setTimeout(() => onSearch(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="px-4 py-3 border-b border-surface-line bg-surface-sunken/40">
      <div className="flex flex-wrap items-center gap-2">
        {onSearch && (
          <div className="flex-1 min-w-[12rem]">
            <label className="sr-only" htmlFor={`${panelId}-search`}>{searchLabel}</label>
            <input
              id={`${panelId}-search`}
              type="search"
              className="input py-2"
              placeholder={searchPlaceholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        {children && (
          <button
            type="button"
            className={open ? 'btn-primary' : 'btn-secondary'}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            Filters{chips.length ? ` (${chips.length})` : ''}
          </button>
        )}
        {actions}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          <span className="text-xs text-ink-muted">Active:</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-50 px-2.5 py-0.5 text-xs text-brand-700 hover:bg-brand-100"
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label} <span aria-hidden="true">✕</span>
            </button>
          ))}
          {onClearAll && (
            <button type="button" onClick={onClearAll} className="text-xs text-brand-600 hover:text-brand-700 underline">
              Clear all
            </button>
          )}
        </div>
      )}

      {children && open && (
        <div id={panelId} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children}
        </div>
      )}
    </div>
  );
}

// A labelled <select> with an "Any" option, for use inside FilterBar.
export function FilterSelect({ label, value, onChange, options, anyLabel = 'Any' }) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {anyLabel !== null && <option value="">{anyLabel}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
