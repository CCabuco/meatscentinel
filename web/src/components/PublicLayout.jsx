import { useEffect } from 'react';

// Shared frame for every page a signed-out user can reach: sign in,
// password reset, email change confirmation and the 404 page. Same brand
// sidebar and centred column everywhere, so the portal looks like one
// product before and after sign-in.

export default function PublicLayout({ title, children }) {
  usePageTitle(title);

  return (
    <div className="min-h-screen flex">
      <aside className="hidden lg:flex w-80 shrink-0 bg-surface border-r border-surface-line flex-col justify-between p-8">
        <div>
          <p className="text-sm font-medium text-ink">MeatScentinel</p>
          <p className="text-xs text-ink-faint mt-0.5">Inspection portal</p>
        </div>
        <p className="text-xs text-ink-faint leading-relaxed">
          An assistive inspection support tool. MeatScentinel does not replace
          official inspection procedures, laboratory testing, or professional
          judgment.
        </p>
      </aside>

      <main className="flex-1 grid place-items-center px-6 py-12 bg-surface-sunken">
        <div className="w-full max-w-sm">
          <p className="lg:hidden text-sm font-medium text-ink mb-6">MeatScentinel</p>
          {children}
        </div>
      </main>
    </div>
  );
}

// Gives each page its own browser tab title, e.g. "MSafe reports · MeatScentinel".
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · MeatScentinel` : 'MeatScentinel — Inspection Portal';
  }, [title]);
}
