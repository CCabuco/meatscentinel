import { supabase } from './supabase.js';

export const ACTIVITY_PAGE_SIZE = 25;
export const ACTIVITY_ACTIONS = {
  signed_in: 'Signed in',
  signed_out: 'Signed out',
  remark_added: 'Added remark',
  status_changed: 'Changed case status',
  account_updated: 'Updated account',
  password_changed: 'Changed password',
  email_change_requested: 'Requested email change',
  email_change_cancelled: 'Cancelled email change',
  record_viewed: 'Opened inspection',
  image_viewed: 'Viewed image',
  inspection_assigned: 'Assigned to inspection',
  inspection_unassigned: 'Removed from inspection',
  inspection_claimed: 'Claimed inspection',
  msafe_claimed: 'Claimed MSafe report',
  msafe_assigned: 'Assigned MSafe report',
  msafe_linked: 'Linked MSafe report to inspection',
  msafe_response_sent: 'Sent MSafe response',
  report_claimed: 'CheckMeat (retired): claimed report',
  report_assigned: 'CheckMeat (retired): assigned report',
  report_linked: 'CheckMeat (retired): linked report',
  report_viewed: 'CheckMeat (retired): opened report',
  report_image_viewed: 'CheckMeat (retired): viewed scan image',
};

export async function listActivity(filters = {}, page = 0) {
  let query = supabase.from('inspector_activity').select(
    'id, occurred_at, actor_user_id, actor_name, inspector_user_id, inspector_name, action, inspection_id, details, source',
    { count: 'exact' },
  );
  if (filters.inspector) {
    // Exact, case-insensitive User ID; escape wildcard characters.
    query = query.ilike('inspector_user_id', filters.inspector.trim().replace(/[\\%_*]/g, '\\$&'));
  }
  if (filters.inspectionId) query = query.eq('inspection_id', filters.inspectionId.trim());
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.viewsOnly) query = query.in('action', ['record_viewed', 'image_viewed']);
  if (filters.from) query = query.gte('occurred_at', `${filters.from}T00:00:00+08:00`);
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00+08:00`);
    end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
    query = query.lt('occurred_at', end.toISOString());
  }
  const { data, count, error } = await query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * ACTIVITY_PAGE_SIZE, (page + 1) * ACTIVITY_PAGE_SIZE - 1);
  return { entries: data ?? [], total: count ?? 0, error: error?.message ?? null };
}

export async function reportInspectionView(action, inspectionId, eventId) {
  const { error } = await supabase.rpc('record_inspection_activity', {
    p_action: action, p_inspection: inspectionId, p_event: eventId,
  });
  if (error) throw new Error(error.message);
}

export function formatActivityTime(value) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value));
}

const FIELD_LABELS = { email: 'Email', display_name: 'Display name', role: 'Role', is_active: 'Account active' };
const showValue = (value) => value == null ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

export function activityDetail(entry) {
  const details = entry.details ?? {};
  if (entry.action.startsWith('report_')) {
    const assignment = ['report_claimed', 'report_assigned'].includes(entry.action)
      ? ` · ${details.before ?? 'Unassigned'} → ${details.after ?? 'Unassigned'}` : '';
    return `Mobile scan ${details.scan_id ?? ''}${assignment}`;
  }
  if (['inspection_assigned', 'inspection_unassigned', 'inspection_claimed'].includes(entry.action)) {
    return `${details.before ?? 'Unassigned'} → ${details.after ?? 'Unassigned'}`;
  }
  if (entry.action.startsWith('msafe_')) {
    const id = details.msafe_report_id ? `MSafe report ${String(details.msafe_report_id).slice(0, 8)}…` : 'MSafe report';
    return entry.action === 'msafe_assigned' && details.after ? `${id} → ${details.after}` : id;
  }
  if (entry.action === 'remark_added') return details.content ?? '';
  if (entry.action === 'status_changed') return `${showValue(details.before)} → ${showValue(details.after)}`;
  if (entry.action === 'email_change_requested') return `Awaiting confirmation: ${details.requested_email ?? ''}`;
  if (entry.action === 'account_updated') {
    return Object.entries(details.changes ?? {}).map(([field, change]) =>
      `${FIELD_LABELS[field] ?? field}: ${showValue(change.before)} → ${showValue(change.after)}`,
    ).join('\n');
  }
  return '';
}
