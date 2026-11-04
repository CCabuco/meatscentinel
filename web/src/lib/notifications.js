import { supabase } from './supabase.js';

export const NOTIFICATION_PAGE_SIZE = 20;
export const DEFAULT_OPTIONS = { email_enabled: true, assignments: true, remarks: true, statuses: true, results: true };
export const NOTIFICATION_CATEGORIES = {
  assignments: ['Assignments', 'New assignments, claimed reports, and reassignment notices.'],
  remarks: ['Remarks', 'New remarks on an assigned inspection.'],
  statuses: ['Case status', 'Changes such as Open, Under Review, or Resolved.'],
  results: ['Results and linked reports', 'Gas or mobile results received, gas and mobile paired with the final classification, and linked MSafe reports.'],
};
export const DELIVERY_LABELS = {
  pending: 'Queued', processing: 'Sending', accepted: 'Accepted by email provider',
  failed: 'Failed', unknown: 'Uncertain — needs review', skipped: 'Email skipped',
};
export async function notificationOptions(global, accountId) {
  const table = global ? 'notification_settings' : 'notification_preferences';
  const { data, error } = await supabase.from(table).select('*').eq(global ? 'id' : 'account_id', global ? true : accountId).maybeSingle();
  if (error) throw new Error(error.message);
  if (global && !data) throw new Error('Notification settings have not been configured.');
  return { ...DEFAULT_OPTIONS, ...data };
}
export async function saveNotificationOptions(global, options) {
  const { error } = await supabase.rpc('save_notification_options', {
    p_global: global, p_email: options.email_enabled, p_assignments: options.assignments,
    p_remarks: options.remarks, p_statuses: options.statuses, p_results: options.results,
  });
  if (error) throw new Error(error.message);
}
export async function listNotifications(filters, page) {
  let query = supabase.from('inspection_notifications').select(
    'id,recipient_id,recipient_user_id,recipient_name,scan_id,msafe_report_id,inspection_id,category,event_type,title,message,created_at,read_at,status,reason,attempts,accepted_at,sent_to',
    { count: 'exact' },
  );
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.unread) query = query.is('read_at', null);
  if (filters.inspector) query = query.ilike('recipient_user_id', filters.inspector.trim().replace(/[\\%_*]/g, '\\$&'));
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id')
    .range(page * NOTIFICATION_PAGE_SIZE, (page + 1) * NOTIFICATION_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}
export async function retryNotification(id, allowUnknown) {
  const { error } = await supabase.rpc('retry_inspection_notification', { p_id: id, p_allow_unknown: allowUnknown });
  if (error) throw new Error(error.message);
}
export async function markNotificationRead(id) {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
  if (error) throw new Error(error.message);
}
