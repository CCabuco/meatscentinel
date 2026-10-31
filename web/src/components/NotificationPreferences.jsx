import { useEffect, useState } from 'react';
import { DEFAULT_OPTIONS, NOTIFICATION_CATEGORIES, notificationOptions, saveNotificationOptions } from '../lib/notifications.js';

export default function NotificationPreferences({ account, global = false }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    notificationOptions(global, account.id).then((value) => {
      if (active) { setOptions(value); setSaved(value); }
    }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [global, account.id, reload]);
  const changed = saved && Object.keys(DEFAULT_OPTIONS).some((key) => saved[key] !== options[key]);
  async function save(event) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try { await saveNotificationOptions(global, options); setSaved({ ...options }); setNotice('Notification settings saved.'); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  function toggle(key) { setOptions((value) => ({ ...value, [key]: !value[key] })); setNotice(''); }
  return <section className="card overflow-hidden">
    <div className="p-5 border-b border-surface-line">
      <h2>{global ? 'Email delivery controls' : 'Your email preferences'}</h2>
      <p className="text-sm text-ink-muted mt-1">{global
        ? 'Manage inspection emails for the organization. Each inspector’s personal opt-out is always respected.'
        : <>Send inspection notifications to <strong className="font-medium break-all">{account.email}</strong>. This is your registered account email.</>}</p>
    </div>
    {loading ? <p className="p-5" role="status">Loading settings…</p> : !saved ? <div className="p-5"><p role="alert">{error}</p><button className="btn-secondary mt-3" onClick={() => setReload((n) => n + 1)}>Retry</button></div>
      : <form onSubmit={save}>
        <div className="p-5 bg-brand-50/40 border-b border-surface-line">
          <Toggle checked={options.email_enabled} disabled={saving} onChange={() => toggle('email_enabled')}
            title={global ? 'Send inspection emails' : 'Email me about my inspections'}
            description={global ? 'Turning this off pauses queued email delivery. Resume to send eligible queued messages less than seven days old.' : 'Turn this off to stop assignment and inspection-update emails. Your notification history remains available.'} />
        </div>
        <fieldset className="p-5 space-y-5" disabled={saving || !options.email_enabled}>
          <legend className="sr-only">Email categories</legend>
          {Object.entries(NOTIFICATION_CATEGORIES).map(([key, [label, description]]) =>
            <Toggle key={key} checked={options[key]} disabled={saving || !options.email_enabled} onChange={() => toggle(key)} title={label} description={description} />)}
        </fieldset>
        <div className="px-5 pb-5 space-y-3">
          <p className="text-xs text-ink-muted">{global ? 'Disabled categories are skipped, not held for later. ' : 'Emails already submitted to the provider cannot be recalled. '}Login verification codes and password recovery are separate and remain enabled.</p>
          {error && <p className="alert-error" role="alert">{error}</p>}
          {notice && <p className="alert-success" role="status">{notice}</p>}
          <div className="flex items-center gap-3"><button className="btn-primary" disabled={saving || !changed}>{saving ? 'Saving…' : 'Save preferences'}</button>
            {changed && <span className="text-xs text-ink-muted">Unsaved changes</span>}</div>
        </div>
      </form>}
  </section>;
}
function Toggle({ checked, disabled, onChange, title, description }) {
  return <label className={`flex gap-4 items-start cursor-pointer ${disabled ? 'opacity-60' : ''}`}>
    <input type="checkbox" className="mt-1 h-4 w-4 accent-rose-700 shrink-0" checked={checked} onChange={onChange} disabled={disabled} />
    <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-ink-muted mt-1 leading-relaxed">{description}</span></span>
  </label>;
}
