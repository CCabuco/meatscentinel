import { useEffect, useRef } from 'react';

// Modal dialog. Closes on Escape and on backdrop click, restores focus to
// whatever opened it, and traps focus while open so keyboard users cannot
// tab into the page behind it.
//
// The setup effect depends on `open` alone. It cannot depend on `onClose`:
// callers almost always pass an inline or locally-defined function, which is
// a new reference on every render, so the effect would re-run on every
// keystroke and yank focus back to the first field. `onClose` is held in a
// ref instead, kept current without retriggering anything.

export default function Modal({ open, title, description, onClose, children, footer }) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';

    const firstField = panelRef.current?.querySelector('input, select, textarea, button');
    firstField?.focus();

    const restoreTo = previouslyFocused.current;

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      restoreTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-lg"
      >
        <div className="px-6 pt-5 pb-4 border-b border-surface-line">
          <h2>{title}</h2>
          {description && <p className="text-sm text-ink-muted mt-1">{description}</p>}
        </div>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-surface-line flex gap-2 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
