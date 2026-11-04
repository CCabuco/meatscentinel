import { useEffect, useRef } from 'react';

// Keeps a page in step with the database without a manual reload.
// Calls refresh() every `intervalMs` while the tab is visible, and again
// as soon as the user comes back to the tab. refresh() should update the
// page quietly (no full "Loading…" screen).
export default function useAutoRefresh(refresh, intervalMs = 20000) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    const timer = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
    };
  }, [intervalMs]);
}
