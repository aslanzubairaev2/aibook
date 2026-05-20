"use client";

import { X } from "lucide-react";

type Props = {
  isOpen: boolean;
  title?: string;
  message: string;
  onClose: () => void;
};

const DEFAULT_TITLE = "Ошибка API";

export function ApiErrorModal({ isOpen, title = DEFAULT_TITLE, message, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" style={{ zIndex: 90 }} onClick={onClose}>
      <section
        className="api-error-modal"
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="api-error-header">
          <span>{title}</span>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <div className="api-error-body">
          <p>{message}</p>
        </div>
        <footer className="api-error-footer">
          <button className="primary-btn" type="button" onClick={onClose}>
            Понятно
          </button>
        </footer>
      </section>
    </div>
  );
}
