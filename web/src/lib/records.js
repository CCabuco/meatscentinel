import { supabase } from './supabase.js';

// Records data access.
//
// Everything here reads inspection_records_view, which derives
// pairing_state from row existence rather than storing it — so the
// list cannot show a pairing state that disagrees with the data.

export const PAGE_SIZE = 20;

export const IMAGE_BUCKET = 'inspection-images';

export const TABS = [
  { id: 'all', label: 'All records' },
  { id: 'iot', label: 'IoT gas records' },
  { id: 'mobile', label: 'Mobile app submissions' },
  { id: 'paired', label: 'Paired records' },
  { id: 'pending', label: 'Pending or unmatched' },
];

export const SAMPLE_TYPES = ['chicken', 'pork', 'beef'];
export const CLASSIFICATIONS = ['Fresh', 'Spoiled', 'For Review'];
export const CASE_STATUSES = ['Open', 'Under Review', 'Resolved'];
export const SOURCE_TYPES = [
  { id: 'iot', label: 'IoT gas device' },
  { id: 'mobile', label: 'Mobile application' },
];

// V-10 — tabs are overlapping views, not a partition. A paired record
// legitimately appears under IoT gas records, mobile app submissions,
// and paired records.
function applyTab(query, tab) {
  switch (tab) {
    case 'iot':
      return query.eq('has_gas_submission', true);
    case 'mobile':
      return query.eq('has_image_submission', true);
    case 'paired':
      return query.eq('pairing_state', 'paired');
    case 'pending':
      return query.eq('pairing_state', 'pending');
    default:
      return query;
  }
}

// Filters combine — each one narrows the set further. The requirements
// name the five dimensions without stating whether they AND or replace
// each other; AND is the reading taken here.
function applyFilters(query, filters) {
  let q = query;

  // Part of an inspection ID typed in the search box.
  if (filters.q) {
    const text = filters.q.replace(/[%_\\,()]/g, '');
    if (text) q = q.ilike('inspection_id', `%${text}%`);
  }

  if (filters.sampleType) {
    q = q.eq('sample_type', filters.sampleType);
  }

  // V-11 — source type duplicates what the first two tabs do. Both are
  // in the confirmed requirements and both are kept.
  if (filters.sourceType === 'iot') {
    q = q.eq('has_gas_submission', true);
  } else if (filters.sourceType === 'mobile') {
    q = q.eq('has_image_submission', true);
  }

  if (filters.classification === '__pending') {
    q = q.is('final_classification', null);
  } else if (filters.classification) {
    q = q.eq('final_classification', filters.classification);
  }

  if (filters.caseStatus) {
    q = q.eq('current_case_status', filters.caseStatus);
  }

  if (filters.dateFrom) {
    q = q.gte('created_at', `${filters.dateFrom}T00:00:00`);
  }
  if (filters.dateTo) {
    q = q.lte('created_at', `${filters.dateTo}T23:59:59`);
  }

  return q;
}

// Who is assigned to each record, in this order:
//   1. An inspector an administrator assigned to the record (migration 020).
//   2. The inspector of a linked MSafe report (migration 017).
//   3. The retired CheckMeat assignment, so older records keep their inspector.
async function withAssignments(records) {
  if (!records.length) return records;
  const ids = records.map((record) => record.inspection_id);
  const [direct, legacy, msafe] = await Promise.all([
    supabase.from('inspection_assignments_view')
      .select('inspection_id,inspector_id,inspector_name,assigned_by,assigned_by_name,assigned_at')
      .in('inspection_id', ids),
    supabase.from('customer_report_assignments')
      .select('inspection_id,scan_id,inspector_id,inspector_name,inspector_user_id')
      .in('inspection_id', ids),
    supabase.from('msafe_reports_view')
      .select('msafe_report_id,inspection_id,inspector_id,inspector_name,report_type,latest_status,received_at')
      .in('inspection_id', ids)
      .order('received_at', { ascending: false }),
  ]);
  if (direct.error) throw new Error(direct.error.message);
  if (legacy.error) throw new Error(legacy.error.message);
  if (msafe.error) throw new Error(msafe.error.message);

  const directById = new Map((direct.data ?? []).map((row) => [row.inspection_id, { source: 'direct', ...row }]));
  const legacyById = new Map((legacy.data ?? []).map((row) => [row.inspection_id, row]));
  const msafeById = new Map();
  for (const row of msafe.data ?? []) {
    if (!msafeById.has(row.inspection_id)) msafeById.set(row.inspection_id, []);
    msafeById.get(row.inspection_id).push(row);
  }

  return records.map((record) => {
    const reports = msafeById.get(record.inspection_id) ?? [];
    const assignedReport = reports.find((r) => r.inspector_id);
    const assignment = directById.get(record.inspection_id) ?? (assignedReport
      ? { source: 'msafe', inspector_id: assignedReport.inspector_id, inspector_name: assignedReport.inspector_name,
          msafe_report_id: assignedReport.msafe_report_id }
      : legacyById.get(record.inspection_id) ?? null);
    return { ...record, assignment, msafeReports: reports };
  });
}

// Plain-language pairing state, the same on every page. pairing_state comes
// from the database view, so it always matches the stored submissions.
export function pairingLabel(record) {
  if (record.has_gas_submission && record.has_image_submission) return 'Paired';
  if (record.has_gas_submission) return 'Waiting for mobile result';
  if (record.has_image_submission) return 'Waiting for gas reading';
  return 'No submissions yet';
}

// Inspectors only (enforced in the database): take an unassigned inspection.
export async function claimInspection(inspectionId) {
  const { error } = await supabase.rpc('claim_inspection', { p_inspection_id: inspectionId });
  return { error: error?.message ?? null };
}

// Administrators only (enforced in the database). Pass null to unassign.
// Shorter wording for table cells.
export function pairingShort(record) {
  if (record.has_gas_submission && record.has_image_submission) return 'Paired';
  if (record.has_gas_submission) return 'Needs mobile';
  if (record.has_image_submission) return 'Needs gas';
  return 'Empty';
}

export async function assignInspection(inspectionId, inspectorId) {
  const { error } = await supabase.rpc('assign_inspection', {
    p_inspection_id: inspectionId,
    p_inspector_id: inspectorId || null,
  });
  return { error: error?.message ?? null };
}

// Inspection IDs that have an inspector: assigned directly by an
// administrator, or through a linked MSafe report. With accountId, only
// that inspector's.
async function assignedInspectionIds(accountId) {
  let direct = supabase.from('inspection_assignments').select('inspection_id');
  let msafe = supabase.from('msafe_report_assignments').select('inspection_id')
    .not('inspection_id', 'is', null).not('inspector_id', 'is', null);
  if (accountId) {
    direct = direct.eq('inspector_id', accountId);
    msafe = msafe.eq('inspector_id', accountId);
  }
  const [d, m] = await Promise.all([direct, msafe]);
  if (d.error) throw new Error(d.error.message);
  if (m.error) throw new Error(m.error.message);
  return [...new Set([...(d.data ?? []), ...(m.data ?? [])].map((r) => r.inspection_id))];
}

// PostgREST "in" list, with IDs quoted (they may contain hyphens).
const inList = (ids) => `(${ids.map((id) => `"${id}"`).join(',')})`;

export async function getMyInspectionCount(accountId) {
  try {
    return { count: (await assignedInspectionIds(accountId)).length, error: null };
  } catch (err) { return { count: null, error: err.message }; }
}

export async function listRecords({ tab = 'all', filters = {}, page = 0, accountId = null }) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('inspection_records_view')
    .select('*', { count: 'exact' });

  if (filters.assigned === 'mine' || filters.assigned === 'unassigned') {
    let ids;
    try {
      ids = await assignedInspectionIds(filters.assigned === 'mine' ? accountId : null);
    } catch (err) { return { records: [], total: 0, error: err.message }; }
    if (filters.assigned === 'mine') {
      if (!ids.length) return { records: [], total: 0, error: null };
      query = query.in('inspection_id', ids);
    } else if (ids.length) {
      query = query.not('inspection_id', 'in', inList(ids));
    }
  }

  query = applyTab(query, tab);
  query = applyFilters(query, filters);

  // V-19 — newest first, with pagination.
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return { records: [], total: 0, error: error.message };

  try {
    return { records: await withAssignments(data ?? []), total: count ?? 0, error: null };
  } catch (err) { return { records: [], total: 0, error: err.message }; }
}

export async function getRecord(inspectionId) {
  const { data, error } = await supabase
    .from('inspection_records_view')
    .select('*')
    .eq('inspection_id', inspectionId)
    .maybeSingle();

  if (error) return { record: null, error: error.message };
  try {
    return { record: data ? (await withAssignments([data]))[0] : null, error: null };
  } catch (err) { return { record: null, error: err.message }; }
}

// V-15 — remarks and status changes are shown in one combined
// chronological timeline. They live in two tables because they are
// independent actions (V-16), so the merge happens here.
export async function getTimeline(inspectionId) {
  const [remarksRes, statusRes, namesRes] = await Promise.all([
    supabase
      .from('remarks')
      .select('id, author_id, content, created_at')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('status_entries')
      .select('id, author_id, status, created_at')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true }),
    supabase.from('author_names').select('id, display_name'),
  ]);

  const error = remarksRes.error || statusRes.error;
  if (error) return { timeline: [], error: error.message };

  const names = new Map(
    (namesRes.data ?? []).map((row) => [row.id, row.display_name])
  );

  // author_id null means the entry was written by the system — used for
  // the initial Open status created with the record (DB-02).
  const authorFor = (id) => (id === null ? 'System' : names.get(id) ?? 'Unknown user');

  const entries = [
    ...(remarksRes.data ?? []).map((r) => ({
      key: `remark-${r.id}`,
      kind: 'remark',
      at: r.created_at,
      author: authorFor(r.author_id),
      content: r.content,
    })),
    ...(statusRes.data ?? []).map((s) => ({
      key: `status-${s.id}`,
      kind: 'status',
      at: s.created_at,
      author: authorFor(s.author_id),
      status: s.status,
    })),
  ];

  entries.sort((a, b) => new Date(a.at) - new Date(b.at));

  return { timeline: entries, error: null };
}

// Append-only. There is no update or delete counterpart to either of
// these, by design and by permission.
export async function addRemark(inspectionId, authorId, content) {
  const { error } = await supabase.from('remarks').insert({
    inspection_id: inspectionId,
    author_id: authorId,
    content: content.trim(),
  });
  return { error: error?.message ?? null };
}

export async function changeCaseStatus(inspectionId, authorId, status) {
  const { error } = await supabase.from('status_entries').insert({
    inspection_id: inspectionId,
    author_id: authorId,
    status,
  });
  return { error: error?.message ?? null };
}

export async function getImageUrl(path) {
  if (!path) return null;
  // A mobile result taken from a linked MSafe report keeps MSafe's own
  // photo link (migration 021); it is not in our storage bucket.
  if (/^https:\/\//.test(path)) return path;
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// V-06 — all-time totals, not scoped to a period.
// V-09 — pending records are counted separately and are not part of the
// three classification totals. A pending record has no classification, so
// there is nothing to count it as.
export async function getDashboardCounts() {
  const countFor = (build) =>
    build(supabase.from('inspection_records_view').select('inspection_id', {
      count: 'exact',
      head: true,
    }));

  const [fresh, spoiled, forReview, pending] = await Promise.all([
    countFor((q) => q.eq('final_classification', 'Fresh')),
    countFor((q) => q.eq('final_classification', 'Spoiled')),
    countFor((q) => q.eq('final_classification', 'For Review')),
    countFor((q) => q.is('final_classification', null)),
  ]);

  const error =
    fresh.error || spoiled.error || forReview.error || pending.error;

  if (error) {
    return { counts: null, error: error.message };
  }

  return {
    counts: {
      fresh: fresh.count ?? 0,
      spoiled: spoiled.count ?? 0,
      forReview: forReview.count ?? 0,
      pending: pending.count ?? 0,
    },
    error: null,
  };
}
