import { supabase } from './supabase.js';

// MSafe reports (migration 017). The MSafe server pushes reports; staff work
// them here. Responses start as drafts (editable by the author), then
// "Send to reporter" locks them and only then does MSafe see them. The
// reporter always sees "MeatScentinel Inspector"; the real author and the
// internal notes stay in msafe_response_internal (staff only).

export const MSAFE_PAGE_SIZE = 20;

export const MSAFE_STATUSES = [
  { id: 'under_review', label: 'Under review' },
  { id: 'investigated', label: 'Investigated' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'not_substantiated', label: 'Not substantiated' },
];

export function msafeStatusLabel(id) {
  return MSAFE_STATUSES.find((s) => s.id === id)?.label ?? 'New';
}

function fail(error) {
  if (!error) return;
  if (/letter_url/.test(error.message)) throw new Error('The letter link must start with https://');
  if (/40001/.test(error.code ?? '')) throw new Error('This report changed. Refresh and try again.');
  throw new Error(error.message);
}

// status: 'all', 'new' (nothing sent yet), or one of MSAFE_STATUSES ids
// (the status of the latest sent response).
export async function listMsafeReports({ type = 'all', view = 'all', status = 'all', accountId, page = 0 } = {}) {
  let query = supabase.from('msafe_reports_view').select('*', { count: 'exact' });
  if (type !== 'all') query = query.eq('report_type', type);
  if (view === 'unassigned') query = query.is('inspector_id', null);
  if (view === 'mine') query = query.eq('inspector_id', accountId);
  if (view === 'assigned') query = query.not('inspector_id', 'is', null);
  if (status === 'new') query = query.is('latest_status', null);
  else if (status !== 'all') query = query.eq('latest_status', status);
  const { data, error, count } = await query
    .order('received_at', { ascending: false })
    .order('msafe_report_id', { ascending: false })
    .range(page * MSAFE_PAGE_SIZE, (page + 1) * MSAFE_PAGE_SIZE - 1);
  fail(error);
  return { rows: data ?? [], total: count ?? 0 };
}

// Dashboard counters. "Waiting for a response" means nothing has been sent
// to the reporter yet; for an inspector it is limited to their own reports.
export async function getMsafeCounts({ accountId, admin }) {
  const head = () => supabase.from('msafe_reports_view').select('msafe_report_id', { count: 'exact', head: true });
  let waiting = head().is('latest_status', null).not('inspector_id', 'is', null);
  if (!admin) waiting = waiting.eq('inspector_id', accountId);
  const [unassigned, open] = await Promise.all([head().is('inspector_id', null), waiting]);
  fail(unassigned.error || open.error);
  return { unassigned: unassigned.count ?? 0, waiting: open.count ?? 0 };
}

export async function getMsafeReport(reportId) {
  const { data, error } = await supabase.from('msafe_reports_view').select('*').eq('msafe_report_id', reportId).maybeSingle();
  fail(error);
  return data;
}

// Sent responses with staff-only details and real author names.
export async function listMsafeResponses(reportId) {
  const responses = await supabase.from('msafe_responses').select('*').eq('msafe_report_id', reportId).order('responded_at');
  fail(responses.error);
  const ids = (responses.data ?? []).map((r) => r.response_id);
  const internal = ids.length
    ? await supabase.from('msafe_response_internal').select('response_id, author_id, author_role, internal_notes').in('response_id', ids)
    : { data: [], error: null };
  fail(internal.error);
  const byId = new Map((internal.data ?? []).map((row) => [row.response_id, row]));
  const authorIds = [...new Set((internal.data ?? []).map((row) => row.author_id))];
  const names = await authorNames(authorIds);
  return (responses.data ?? []).map((r) => {
    const extra = byId.get(r.response_id) ?? {};
    return { ...r, internal_notes: extra.internal_notes ?? null, author_role: extra.author_role ?? null,
      author_name: names.get(extra.author_id) ?? 'Unknown' };
  });
}

export async function listMsafeDrafts(reportId) {
  const { data, error } = await supabase.from('msafe_response_drafts').select('*')
    .eq('msafe_report_id', reportId).order('updated_at', { ascending: false });
  fail(error);
  const names = await authorNames([...new Set((data ?? []).map((d) => d.author_id))]);
  return (data ?? []).map((d) => ({ ...d, author_name: names.get(d.author_id) ?? 'Unknown' }));
}

export async function listMsafeHistory(reportId) {
  const { data, error } = await supabase.from('msafe_assignment_events').select('*')
    .eq('msafe_report_id', reportId).order('occurred_at');
  fail(error);
  const ids = [...new Set((data ?? []).flatMap((e) => [e.actor_id, e.inspector_id]).filter(Boolean))];
  const names = await authorNames(ids);
  return (data ?? []).map((e) => ({ ...e, actor_name: names.get(e.actor_id), inspector_name: names.get(e.inspector_id) }));
}

async function authorNames(ids) {
  if (!ids.length) return new Map();
  const { data } = await supabase.from('author_names').select('id, display_name').in('id', ids);
  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

export async function listActiveInspectors() {
  const { data, error } = await supabase.from('accounts').select('id, user_id, display_name')
    .eq('role', 'inspector').eq('is_active', true).order('display_name');
  fail(error);
  return data ?? [];
}

export async function claimMsafeReport(report) {
  const { error } = await supabase.rpc('claim_msafe_report', { p_report_id: report.msafe_report_id, p_version: report.assignment_version });
  fail(error);
}

export async function assignMsafeReport(report, inspectorId) {
  const { error } = await supabase.rpc('assign_msafe_report', {
    p_report_id: report.msafe_report_id, p_inspector_id: inspectorId, p_version: report.assignment_version,
  });
  fail(error);
}

export async function linkMsafeInspection(report, inspectionId) {
  const { error } = await supabase.rpc('link_msafe_inspection', { p_report_id: report.msafe_report_id, p_inspection_id: inspectionId });
  fail(error);
}

export async function saveMsafeDraft(reportId, draftId, fields) {
  const { data, error } = await supabase.rpc('save_msafe_draft', {
    p_draft_id: draftId ?? null,
    p_report_id: reportId,
    p_status: fields.status,
    p_findings: fields.findings || null,
    p_action_taken: fields.actionTaken || null,
    p_inspection_date: fields.inspectionDate || null,
    p_letter_url: fields.letterUrl?.trim() || null,
    p_internal_notes: fields.internalNotes || null,
  });
  fail(error);
  return data;
}

export async function deleteMsafeDraft(draftId) {
  const { error } = await supabase.rpc('delete_msafe_draft', { p_draft_id: draftId });
  fail(error);
}

export async function sendMsafeDraft(draftId) {
  const { error } = await supabase.rpc('send_msafe_draft', { p_draft_id: draftId });
  fail(error);
}
