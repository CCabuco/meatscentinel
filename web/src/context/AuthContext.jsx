import { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
  const loadAccount = useCallback(async (userId) => {
    if (!userId) {
      setAccount(null);
      return;
    }

    const { data, error } = await supabase
      .from('accounts')
      .select('id, user_id, email, display_name, role, is_active, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
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
