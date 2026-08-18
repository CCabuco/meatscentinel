import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { signOut as doSignOut } from '../lib/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deactivated, setDeactivated] = useState(false);

  // 'anonymous' | 'active' | 'unverified' | 'deactivated' | 'unknown'.
  // The route guards need this: without it, a session that is signed in
  // but unverified looks identical to one whose account is still loading,
  // and the guards would show a loading screen that never resolves.
  const [sessionState, setSessionState] = useState('anonymous');

  // AD-02 / U-F — deactivation is immediate. Every RLS policy requires
  // is_active, so a deactivated user's own row becomes unreadable the
  // moment the flag flips, even though their token has not expired.
  //
  // This used to be inferred: "signed in but the accounts row returned
  // zero rows" meant deactivated. Migration 010 made that inference
  // wrong. current_account_role() now also requires a verified session,
  // so THREE different situations return zero rows:
  //
  //   - deactivated              → sign out, say so
  //   - unverified session       → a recovery link or an email-change
  //                                confirmation. Signing out here would
  //                                break password recovery entirely,
  //                                because the reset form needs that
  //                                session to set the new password.
  //   - a genuine error          → prove nothing, keep what we had
  //
  // So the client stops inferring and asks. login_session_state() is
  // security definer and answers regardless of policy.
  const loadSeq = useRef(0);

  const loadAccount = useCallback(async (userId) => {
    if (!userId) {
      setAccount(null);
      setSessionState('anonymous');
      return;
    }

    const seq = ++loadSeq.current;

    const { data: state, error: stateError } = await supabase.rpc(
      'login_session_state',
    );

    if (seq !== loadSeq.current) return;

    if (stateError) {
      setSessionState('unknown');
      // Could not determine anything. Keep whatever we had; never sign
      // out on a failed lookup — that was the bug that bounced valid
      // logins back to the login page.
      return;
    }

    setSessionState(state ?? 'unknown');

    if (state === 'deactivated') {
      setAccount(null);
      setDeactivated(true);
      await doSignOut();
      return;
    }

    if (state === 'unverified') {
      // Not signed in as far as the application is concerned, but the
      // session is left alone so /reset-password and /email-changed can
      // use it. Both routes are unguarded, so nothing else is reachable.
      setAccount(null);
      setDeactivated(false);
      return;
    }

    if (state !== 'active') {
      setAccount(null);
      return;
    }

    const { data, error } = await supabase
      .from('accounts')
      .select('id, user_id, email, display_name, role, is_active, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (seq !== loadSeq.current) return;

    if (error || !data) {
      // The state check just said active, so a miss here is a transient
      // failure rather than a verdict. Leave the session alone.
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
        setSessionState('anonymous');
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
    setSessionState('anonymous');
  }, []);

  const value = {
    session,
    account,
    loading,
    deactivated,
    sessionState,
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
