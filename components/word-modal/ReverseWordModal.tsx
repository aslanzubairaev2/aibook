"use client";

// «Как это сказать» — the word modal turned round.
//
// It exists because of one specific moment in the trainer: the card is showing
// the learner's own language (the reverse direction), the phrase is mostly
// familiar, and one word in it is the one they cannot produce. Flipping the
// card answers a question they did not ask — it gives away the whole phrase —
// so tapping that single word has to answer only for that word.
//
// A separate modal rather than the existing one on purpose. «Разбор слова» is
// built end to end around a word in the language being learned: it speaks the
// headword, offers the conjugation tables for it, and saves it to a card front.
// Every one of those is wrong for a Russian word, and bending it into shape
// would have cost the reader the modal it already has.

import { Loader2, Plus, X } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { ReverseWordAnalysis } from "@/lib/types";

type Props = {
  isOpen: boolean;
  isLoading?: boolean;
  /** The native-language word that was tapped. */
  word: string;
  analysis: ReverseWordAnalysis | null;
  /** Language being learned — what the answers are in, and what gets spoken. */
  lang: string;
  onClose: () => void;
  /** Save one of the offered words as a new card, target side first. */
  onAddCard?: (front: string, back: string) => void;
};

const TITLE = "Как это сказать";
const CLOSE_LABEL = "Закрыть";
const EMPTY_TEXT = "Не удалось подобрать перевод. Попробуйте ещё раз.";
const EXAMPLES_LABEL = "Примеры";

export function ReverseWordModal({ isOpen, isLoading, word, analysis, lang, onClose, onAddCard }: Props) {
  if (!isOpen) return null;

  const entries = analysis?.entries ?? [];

  return (
    <div className="modal-backdrop word-modal-backdrop" onClick={onClose}>
      <section
        className="word-modal reverse-word-modal"
        role="dialog"
        aria-modal
        aria-label={TITLE}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-top-bar">
          <button className="icon-btn" onClick={onClose} type="button" aria-label={CLOSE_LABEL}>
            <X size={20} />
          </button>
          <span className="reverse-word-kicker">{TITLE}</span>
        </div>

        <h2 className="reverse-word-native">{analysis?.native || word}</h2>

        {isLoading && (
          <div className="reverse-word-loading">
            <Loader2 size={18} className="spin" /> Подбираю варианты...
          </div>
        )}

        {!isLoading && entries.length === 0 && <p className="reverse-word-empty">{EMPTY_TEXT}</p>}

        {entries.map((entry, index) => {
          // What actually gets spoken and saved: a noun without its article is
          // half a word, and the learner is here precisely for the half that
          // is missing.
          const spoken = [entry.article, entry.text].filter(Boolean).join(" ").trim();
          const details = [entry.plural && `мн. ч.: ${entry.plural}`, entry.forms]
            .filter(Boolean)
            .join(" · ");

          return (
            <article key={`${entry.text}-${index}`} className={`reverse-word-option${index === 0 ? " primary" : ""}`}>
              <div className="reverse-word-head">
                <span className="reverse-word-target">{spoken || entry.text}</span>
                <SpeakButton text={spoken || entry.text} lang={lang} size={17} />
                {onAddCard && (
                  <button
                    type="button"
                    className="icon-btn reverse-word-add"
                    aria-label="Добавить карточку"
                    title="Добавить карточку"
                    onClick={() => onAddCard(spoken || entry.text, analysis?.native || word)}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {(entry.partOfSpeech || details) && (
                <div className="reverse-word-meta">
                  {entry.partOfSpeech && <span className="dict-chip pos">{entry.partOfSpeech}</span>}
                  {details && <span>{details}</span>}
                </div>
              )}
              {entry.note && <p className="reverse-word-note">{entry.note}</p>}
            </article>
          );
        })}

        {analysis?.examples && analysis.examples.length > 0 && (
          <>
            <div className="reverse-word-section">{EXAMPLES_LABEL}</div>
            {analysis.examples.map((example, index) => (
              <div key={`${example.text}-${index}`} className="reverse-word-example">
                <div className="reverse-word-example-main">
                  <span>{example.text}</span>
                  <SpeakButton text={example.text} lang={lang} size={13} />
                </div>
                <span className="reverse-word-example-translation">{example.translation}</span>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
