import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;

// Supabase is moving from the legacy anon key to publishable keys
// (sb_publishable_...). They are drop-in equivalents for the client, so
// either name works here.
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
  );
}

// Never put a secret key (sb_secret_...) or the legacy service_role key
// here. Those bypass every Row Level Security policy, which is the whole
// access boundary between the inspector and administrator roles.
export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
