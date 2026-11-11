"use client";

// Filters in an overlay.
//
// Every screen used to open its filters as a block in the page flow, so the
// list, the pack buttons or the card being trained jumped down by the height
// of the panel and back up when it closed — on a phone the thing being
// filtered was pushed off the screen by its own filters. The same content now
// opens over the page: a sheet from the bottom on a phone, a centred panel on
// a wide screen. The page underneath does not move.
//
// The root keeps the `all-filter-panel` class on purpose: a couple of screens
// close their filters on any click outside an element with that class, and a
// click on the sheet's own header must not count as «outside».

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  title?: string;
  onClose: () => void;
  children: ReactNode;
};

export function FilterSheet({ title = "Фильтры", onClose, children }: Props) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRef.current();
    };
    // Capture: the trainers have their own Escape handling for the session.
    document.addEventListener("keydown", onKey, true);
    // The page behind must not scroll under the finger.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="filter-sheet-backdrop" onClick={(event) => { event.stopPropagation(); onClose(); }}>
      <div
        ref={sheetRef}
        className="filter-sheet all-filter-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="filter-sheet-head">
          <h2 className="filter-sheet-title">{title}</h2>
          <button type="button" className="icon-btn filter-sheet-close" onClick={onClose} aria-label="Закрыть фильтры">
            <X size={18} />
          </button>
        </header>
        <div className="filter-sheet-body">{children}</div>
        <div className="filter-sheet-foot">
          <button type="button" className="primary-btn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
