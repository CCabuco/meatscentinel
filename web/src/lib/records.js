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

export async function listRecords({ tab = 'all', filters = {}, page = 0 }) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('inspection_records_view')
    .select('*', { count: 'exact' });

  query = applyTab(query, tab);
  query = applyFilters(query, filters);

  // V-19 — newest first, with pagination.
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return { records: [], total: 0, error: error.message };

  return { records: data ?? [], total: count ?? 0, error: null };
}

export async function getRecord(inspectionId) {
  const { data, error } = await supabase
    .from('inspection_records_view')
    .select('*')
    .eq('inspection_id', inspectionId)
    .maybeSingle();

  if (error) return { record: null, error: error.message };
  return { record: data, error: null };
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
