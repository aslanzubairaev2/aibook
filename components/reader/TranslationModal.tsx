"use client";

import { X } from "lucide-react";

type Props = {
  title: string;
  paragraphs: string[];
  onClose: () => void;
};

/**
 * The translated text on its own, as one readable piece.
 *
 * Putting it under each paragraph in the reader made it something to glance at
 * between lines; the point of translating the whole text is to be able to read
 * the whole translation.
 */
export function TranslationModal({ title, paragraphs, onClose }: Props) {
  return (
    <div className="book-modal-backdrop" onClick={onClose}>
      <div className="book-modal" onClick={(e) => e.stopPropagation()}>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
        <div className="book-modal-header">
          <strong>Перевод — {title}</strong>
          <button onClick={onClose} className="icon-btn modal-close" type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="book-modal-content">
          <div className="translation-body">
            {paragraphs.map((para, i) => <p key={i}>{para}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}

const STYLES = `
  .translation-body { padding-bottom: 20px; }
  .translation-body p {
    margin: 0 0 14px;
    font-family: var(--font-reading);
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-primary);
  }
  .translation-body p:last-child { margin-bottom: 0; }
`;
