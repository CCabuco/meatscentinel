import { supabase } from './supabase.js';

export const REPORT_PAGE_SIZE = 20;
export async function listCustomerReports(filter, accountId, page) {
  let query = supabase.from('customer_reports_view').select('*', { count: 'exact' });
  if (filter === 'mine') query = query.eq('inspector_id', accountId);
  if (filter === 'unassigned') query = query.is('inspector_id', null);
  const { data, error, count } = await query.order('scanned_at', { ascending: false })
    .order('scan_id', { ascending: false }).range(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function callReportService(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to continue.');
  const { data, error } = await supabase.functions.invoke('customer-reports', {
    body: { ...body, access_token: session.access_token },
  });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* Network failure. */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function manageReport(report, action, fields = {}) {
  const { error } = await supabase.rpc('manage_customer_report', {
    p_scan: report.scan_id, p_action: action, p_version: report.version, ...fields,
  });
  if (error) throw new Error(error.code === '23505' ? 'That inspection already has a linked customer report.' : error.message);
}

export async function logReportView(scanId, action, eventId) {
  const { error } = await supabase.rpc('record_customer_report_view', {
    p_scan: scanId, p_action: action, p_event: eventId,
  });
  if (error) throw new Error('Could not record this viewing activity. Please retry.');
}
