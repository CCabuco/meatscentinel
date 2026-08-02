import { evaluatePassword, strengthLabel } from '../lib/passwordPolicy.js';

// D-06 — strength feedback is displayed as the user types, not only on
// submit.

export default function PasswordStrength({ password, currentPassword = null }) {
  const { results, metCount, total } = evaluatePassword(password, currentPassword);
  const { text, tone } = strengthLabel(metCount, total);

  if (!password) return null;

  const barTone =
    tone === 'ok' ? 'bg-state-fresh' : tone === 'partial' ? 'bg-state-review' : 'bg-state-spoiled';
  const textTone =
    tone === 'ok' ? 'text-state-fresh' : tone === 'partial' ? 'text-state-review' : 'text-state-spoiled';

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-1 flex-1 rounded-full bg-surface-line overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barTone}`}
            style={{ width: `${(metCount / total) * 100}%` }}
          />
        </div>
        <span className={`text-xs font-medium ${textTone}`}>{text}</span>
      </div>

      <ul className="space-y-1">
        {results.map((rule) => (
          <li
            key={rule.id}
            className={`text-xs flex items-center gap-2 ${
              rule.met ? 'text-state-fresh' : 'text-ink-faint'
            }`}
          >
            <span aria-hidden="true" className="w-3">
              {rule.met ? '✓' : '·'}
            </span>
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
