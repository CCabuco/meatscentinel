import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const expected = Deno.env.get('NOTIFICATION_WORKER_SECRET');
  if (!expected || req.headers.get('x-notification-secret') !== expected) return json({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const brevo = Deno.env.get('BREVO_API_KEY');
  const sender = Deno.env.get('MAIL_FROM_EMAIL');
  const senderName = Deno.env.get('MAIL_FROM_NAME') || 'MeatScentinel';
  if (!url || !key || !brevo || !sender) return json({ error: 'Notification mail service is not configured' }, 503);
  const appUrl = Deno.env.get('NOTIFICATION_APP_URL') || 'https://meatscentinel.vercel.app';
  let base: URL;
  try {
    base = new URL(appUrl);
    if (!['https:', 'http:'].includes(base.protocol)) throw new Error();
  } catch { return json({ error: 'Invalid notification app URL' }, 503); }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let processed = 0;
  try {
    // Five sequential sends keep runs bounded. The queue survives closed browsers.
    for (let index = 0; index < 5; index++) {
      const { data: rows, error: claimError } = await db.rpc('claim_inspection_notification');
      if (claimError) throw new Error('Queue unavailable');
      const item = rows?.[0];
      if (!item) break;
      const finish = async (status: string, reason: string | null = null, providerId: string | null = null) => {
        const { error } = await db.rpc('finish_inspection_notification', {
          p_id: item.id, p_lease: item.lease_token, p_status: status, p_reason: reason, p_provider_id: providerId,
        });
        if (error) throw new Error('Could not save delivery outcome');
      };
      // Recheck settings and current email after leasing, including opt-outs while queued.
      const [eligibility, account, settings] = await Promise.all([
        db.rpc('notification_skip_reason', { p_recipient: item.recipient_id, p_category: item.category, p_scan: item.scan_id ?? item.msafe_report_id, p_event: item.event_type, p_inspection: item.inspection_id ?? null }),
        db.from('accounts').select('email').eq('id', item.recipient_id).single(),
        db.from('notification_settings').select('email_enabled').eq('id', true).single(),
      ]);
      if (eligibility.error || account.error || settings.error) {
        await finish('failed', 'Could not confirm recipient preferences');
        continue;
      }
      if (eligibility.data) { await finish('skipped', eligibility.data); continue; }
      if (!settings.data.email_enabled || account.data.email !== item.sent_to) {
        await finish('pending', 'Delivery paused or recipient email changed before sending');
        continue;
      }
      const path = item.inspection_id ? `/records/${encodeURIComponent(item.inspection_id)}` : '/msafe-reports';
      const link = new URL(path, base).href;
      const preferences = new URL('/notifications?tab=settings', base).href;
      const reference = item.msafe_report_id
        ? `MSafe report: ${item.msafe_report_id}${item.inspection_id ? ` (inspection ${item.inspection_id})` : ''}`
        : item.inspection_id ? `Inspection: ${item.inspection_id}` : `Mobile report: ${item.scan_id}`;
      const text = `${item.title}\n\nHello ${item.recipient_name},\n\n${item.message}\n\n${reference}\nOpen: ${link}\n\nEmail preferences: ${preferences}\nYou received this because of your inspection assignment.`;
      let response: Response;
      try {
        response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { 'api-key': brevo, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sender: { name: senderName, email: sender }, to: [{ email: item.sent_to }],
            subject: `MeatScentinel: ${item.title}`, textContent: text,
            htmlContent: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#29252a"><h2>${escapeHtml(item.title)}</h2><p>Hello ${escapeHtml(item.recipient_name)},</p><p>${escapeHtml(item.message)}</p><p>${escapeHtml(reference)}</p><p><a href="${escapeHtml(link)}">Open in MeatScentinel</a></p><hr><p style="font-size:12px">You received this because of your inspection assignment. <a href="${escapeHtml(preferences)}">Manage email preferences</a>.</p></div>`,
            headers: { idempotencyKey: item.id }, tags: ['inspection-notification'],
          }),
        });
      } catch {
        // Request may have reached Brevo. Retrying automatically could send twice.
        await finish('unknown', 'Mail request timed out or the connection closed; acceptance is uncertain');
        continue;
      }
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        await finish('accepted', null, typeof payload.messageId === 'string' ? payload.messageId : null);
      } else if (payload.code === 'duplicate_parameter') {
        await finish('unknown', 'Brevo rejected a duplicate request; check its transactional log before retrying');
      } else if (response.status === 429) {
        await finish('pending', 'Brevo rate limit; retry scheduled (maximum five automatic attempts)');
      } else if (response.status >= 500) {
        await finish('unknown', `Mail provider returned HTTP ${response.status}; acceptance is uncertain`);
      } else {
        // Do not store raw provider responses, which may contain addresses or credentials.
        await finish('failed', `Mail provider rejected the request (HTTP ${response.status})`);
      }
      processed++;
    }
    return json({ processed });
  } catch {
    return json({ error: 'Notification processing interrupted; queued messages remain available' }, 500);
  }
});
