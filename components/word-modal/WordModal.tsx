"use client";

import { ChevronRight, Plus, X } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { AiAnalysis } from "@/lib/types";

type Props = {
  analysis: AiAnalysis;
  isOpen: boolean;
  isLoading?: boolean;
  lang: string;
  onClose: () => void;
  onAddCard: () => void;
};

const POS_ACTIONS: Record<string, string[]> = {
  "глагол":          ["Спряжение", "Синонимы", "Этимология", "Произношение"],
  "verb":            ["Conjugation", "Synonyms", "Etymology", "Pronunciation"],
  "существительное": ["Склонение", "Синонимы", "Этимология", "Произношение"],
  "noun":            ["Declension", "Synonyms", "Etymology", "Pronunciation"],
  "прилагательное":  ["Сравнение", "Антонимы", "Произношение", "Примеры"],
  "adjective":       ["Comparison", "Antonyms", "Pronunciation", "Examples"],
  "default":         ["Синонимы", "Антонимы", "Этимология", "Произношение"],
};

function getActions(pos: string) {
  const lower = pos.toLowerCase();
  for (const [key, acts] of Object.entries(POS_ACTIONS)) {
    if (lower.includes(key)) return acts;
  }
  return POS_ACTIONS.default;
}

export function WordModal({ analysis, isOpen, isLoading, lang, onClose, onAddCard }: Props) {
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
          <SpeakButton text={analysis.word.lemma} lang={lang} size={18} />
          <button className="pill-btn" onClick={onAddCard} type="button" style={{ marginLeft: "auto" }}>
            <Plus size={15} />
            Карточка
          </button>
        </div>

        {/* Hero */}
        <div className="word-hero">
          <div className="word-hero-lemma">{analysis.word.lemma.toUpperCase()}</div>
          <div className="word-hero-meta">
            <span className="word-meta-chip">{analysis.word.partOfSpeech}</span>
            {analysis.word.gender && <span className="word-meta-chip gender">{analysis.word.gender}</span>}
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
          <span className="modal-section-label">Примеры</span>
          <div className="examples-list">
            {analysis.examples.map((ex, i) => (
              <div key={i} className="example-item">
                <span className="example-num">{i + 1}.</span>
                <span style={{ flex: 1 }}>{ex}</span>
                <SpeakButton text={ex} lang={lang} size={14} />
              </div>
            ))}
          </div>
        </div>

        {/* Action list */}
        <div className="action-list">
          {actions.map((label) => (
            <button key={label} type="button" className="action-list-btn">
              <span>{label}</span>
              <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
