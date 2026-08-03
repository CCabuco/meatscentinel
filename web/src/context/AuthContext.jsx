import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { signOut as doSignOut } from '../lib/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deactivated, setDeactivated] = useState(false);

  // AD-02 / U-F — deactivation is immediate.
  //
  // Row Level Security requires is_active on every policy, including the
  // one on accounts. So a deactivated user's own row becomes unreadable
  // the instant the flag flips, even though their token has not expired.
  // No row means deactivated: sign out rather than render a shell the
  // user cannot load anything into.
  // AD-02 / U-F — deactivation is immediate.
  //
  // Every RLS policy requires is_active, including the one on accounts, so a
  // deactivated user's own row becomes unreadable the moment the flag flips.
  // "Signed in but no row" therefore means deactivated — but ONLY when the
  // query genuinely returned no row. A query that ERRORED (network hiccup,
  // token still settling in the first moments after sign-in) proves nothing,
  // and signing out on it produced a flash of the landing page followed by a
  // bounce back to login. Errors now retry once, then leave the session
  // alone; the route guards keep unauthorised screens unreachable either way.
  const loadSeq = useRef(0);

  const loadAccount = useCallback(async (userId) => {
    if (!userId) {
      setAccount(null);
      return;
    }

    const seq = ++loadSeq.current;

    const attempt = () =>
      supabase
        .from('accounts')
        .select('id, user_id, email, display_name, role, is_active, created_at')
        .eq('id', userId)
        .maybeSingle();

    let { data, error } = await attempt();

    if (error) {
      await new Promise((r) => setTimeout(r, 400));
      if (seq !== loadSeq.current) return;
      ({ data, error } = await attempt());
    }

    // A newer load has started (another auth event fired); let it win rather
    // than racing it to setState.
    if (seq !== loadSeq.current) return;

    if (error) {
      // Could not determine anything. Keep whatever we had; do not sign out
      // on a failed lookup.
      return;
    }

    if (!data) {
      // Clean answer, zero rows: the policies refused. Deactivated.
      setAccount(null);
      setDeactivated(true);
      await doSignOut();
      return;
    }

    setDeactivated(false);
    setAccount(data);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      await loadAccount(data.session?.user?.id);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next ?? null);
      if (next?.user?.id) {
        await loadAccount(next.user.id);
      } else {
        setAccount(null);
      }
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadAccount]);

  const refreshAccount = useCallback(async () => {
    await loadAccount(session?.user?.id);
  }, [loadAccount, session]);

  const signOut = useCallback(async () => {
    await doSignOut();
    setAccount(null);
    setSession(null);
  }, []);

  const value = {
    session,
    account,
    loading,
    deactivated,
    clearDeactivated: () => setDeactivated(false),
    role: account?.role ?? null,
    isInspector: account?.role === 'inspector',
    isAdministrator: account?.role === 'administrator',
    refreshAccount,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
