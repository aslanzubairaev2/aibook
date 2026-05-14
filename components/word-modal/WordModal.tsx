"use client";

import { Plus, Volume2, X } from "lucide-react";
import type { AiAnalysis } from "@/lib/types";

type Props = {
  analysis: AiAnalysis;
  isOpen: boolean;
  onClose: () => void;
  onAddCard: () => void;
};

const POS_ACTIONS: Record<string, string[]> = {
  "глагол":        ["Спряжение", "Синонимы", "Произношение", "Примеры"],
  "verb":          ["Conjugation", "Synonyms", "Pronunciation", "Examples"],
  "существительное": ["Склонение", "Синонимы", "Произношение", "Этимология"],
  "noun":          ["Declension", "Synonyms", "Pronunciation", "Etymology"],
  "прилагательное":["Сравнение", "Антонимы", "Произношение", "Примеры"],
  "adjective":     ["Comparison", "Antonyms", "Pronunciation", "Examples"],
  "idiom":         ["Буквальный смысл", "Происхождение", "Примеры", "Регистр"],
  "default":       ["Синонимы", "Антонимы", "Произношение", "Этимология"],
};

function getActions(pos: string): string[] {
  const lower = pos.toLowerCase();
  for (const [key, actions] of Object.entries(POS_ACTIONS)) {
    if (lower.includes(key)) return actions;
  }
  return POS_ACTIONS.default;
}

export function WordModal({ analysis, isOpen, onClose, onAddCard }: Props) {
  if (!isOpen) return null;

  const actions = getActions(analysis.word.partOfSpeech);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="word-modal"
        role="dialog"
        aria-modal
        aria-label="Разбор слова"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="modal-top-bar">
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="icon-btn" type="button" aria-label="Произношение">
              <Volume2 size={18} />
            </button>
            <button className="pill-btn" onClick={onAddCard} type="button">
              <Plus size={15} />
              Карточка
            </button>
          </div>
        </div>

        {/* Hero */}
        <div className="word-hero">
          <div className="word-hero-lemma">{analysis.word.lemma}</div>
          <div className="word-hero-meta">
            <span className="word-meta-chip">{analysis.word.partOfSpeech}</span>
            {analysis.word.gender && (
              <span className="word-meta-chip gender">{analysis.word.gender}</span>
            )}
          </div>
        </div>

        {/* Translation */}
        <div className="modal-section">
          <span className="modal-section-label">Перевод</span>
          <div className="modal-translation">{analysis.word.translation}</div>
          <div className="modal-explanation">{analysis.word.explanation}</div>
        </div>

        {/* Examples */}
        <div className="modal-section">
          <span className="modal-section-label">5 примеров фраз</span>
          <div className="examples-list">
            {analysis.examples.map((ex, i) => (
              <div key={i} className="example-item">{ex}</div>
            ))}
          </div>
        </div>

        {/* Dynamic actions */}
        <div className="action-grid">
          {actions.map((action) => (
            <button key={action} type="button" className="action-grid-btn">
              {action}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
