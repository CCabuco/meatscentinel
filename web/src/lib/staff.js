import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// Staff names with their User ID, so two people with the same display name
// (for example two "Cj Inspector" accounts) can be told apart. Loaded once
// per page load and shared by every page.
let cache = null;

function loadStaff() {
  if (!cache) {
    cache = supabase.from('author_names').select('*').then(({ data, error }) => {
      if (error) { cache = null; return new Map(); }
      return new Map((data ?? []).map((row) => [row.id, row]));
    });
  }
  return cache;
}

export function useStaff() {
  const [staff, setStaff] = useState(() => new Map());
  useEffect(() => {
    let active = true;
    loadStaff().then((map) => { if (active) setStaff(map); });
    return () => { active = false; };
  }, []);
  return staff;
}

// "Cj Inspector (INSP-001)". Falls back to the name alone, or to fallback
// when the person is unknown.
export function staffLabel(staff, id, fallback = 'Unassigned') {
  if (!id) return fallback;
  const row = staff.get(id);
  if (!row) return fallback;
  return row.user_id ? `${row.display_name} (${row.user_id})` : row.display_name;
}
