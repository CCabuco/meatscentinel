import { useState } from 'react';

// Password field, masked by default with a toggle.
//
// Administrators set an initial password they then have to pass on to the
// account holder, so being able to read it back matters — but masked is the
// right default when the screen might be visible to someone else.

export default function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = 'new-password',
  placeholder,
  required = false,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className={`input pr-16 ${visible ? 'font-mono' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-sunken"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
