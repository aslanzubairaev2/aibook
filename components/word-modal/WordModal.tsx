"use client";

import { Plus, X } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { AiAnalysis } from "@/lib/types";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";

type Props = {
  analysis: AiAnalysis | null;
  isOpen: boolean;
  isLoading?: boolean;
  lang: string;
  selectedWord: string;
  onClose: () => void;
  onAddCard: () => void;
  onWordTap?: (word: string, contextSentence: string) => void;
};

export function WordModal({ analysis, isOpen, isLoading, lang, selectedWord, onClose, onAddCard, onWordTap }: Props) {
  if (!isOpen) return null;
  const word = analysis?.word;
  const displayWord = selectedWord || word?.text || word?.lemma || "";
  const hasLemma = word?.lemma && word.lemma.toLowerCase() !== displayWord.toLowerCase();

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
          {displayWord && <SpeakButton text={displayWord} lang={lang} size={18} />}
          <button className="pill-btn" onClick={onAddCard} type="button" style={{ marginLeft: "auto" }} disabled={!word?.translation}>
            <Plus size={15} />
            Карточка
          </button>
        </div>

        {isLoading || !word ? (
          <div className="word-modal-skeleton">
            <div className="word-hero">
              <div className="word-hero-lemma">{displayWord ? displayWord.toUpperCase() : "..."}</div>
            </div>
            <div className="modal-section">
              <span className="modal-section-label">Перевод</span>
              <div className="shimmer-line" />
              <div className="shimmer-line medium" />
            </div>
            <div className="modal-section">
              <span className="modal-section-label">Примеры</span>
              <div className="shimmer-line" />
              <div className="shimmer-line medium" />
              <div className="shimmer-line short" />
            </div>
          </div>
        ) : (
        <>
        {/* Hero */}
        <div className="word-hero">
          <div className="word-hero-lemma">{displayWord.toUpperCase()}</div>
          <div className="word-hero-meta">
            <span className="word-meta-chip">{word.partOfSpeech}</span>
            {word.gender && <span className="word-meta-chip gender">{word.gender}</span>}
          </div>
          {hasLemma && (
            <div className="word-lemma-line">
              <span>Инфинитив / словарная форма</span>
              <strong>{word.lemma}</strong>
              <SpeakButton text={word.lemma} lang={lang} size={13} />
            </div>
          )}
        </div>

        {/* Translation */}
        <div className="modal-section">
          <span className="modal-section-label">Перевод</span>
          <div className="modal-translation">{word.translation}</div>
          {word.explanation && <div className="modal-explanation">{word.explanation}</div>}
          {(word.nounDetails?.article || word.nounDetails?.plural || word.verbDetails?.infinitive) && (
            <div className="word-details-grid">
              {word.nounDetails?.article && <span>Артикль <b>{word.nounDetails.article}</b></span>}
              {word.nounDetails?.plural && <span>Мн. число <b>{word.nounDetails.plural}</b></span>}
              {word.verbDetails?.infinitive && <span>Инфинитив <b>{word.verbDetails.infinitive}</b></span>}
              {word.verbDetails?.person && <span>Форма <b>{word.verbDetails.person}</b></span>}
            </div>
          )}
        </div>

        {/* Examples */}
        <div className="modal-section">
          <span className="modal-section-label">Примеры</span>
          <div className="examples-list">
            {(analysis?.examples ?? []).slice(0, 5).map((exItem, i) => {
              const text = typeof exItem === "string" ? exItem : exItem.text;
              const translation = typeof exItem === "string" ? "" : exItem.translation;
              const tokens = splitIntoTokens(text);
              return (
                <div key={i} className="example-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                  <div style={{ display: "flex", gap: "8px", width: "100%", alignItems: "flex-start" }}>
                    <span className="example-num">{i + 1}.</span>
                    <span style={{ flex: 1 }}>
                      {tokens.map((token, tokIdx) => {
                        const norm = normalizeToken(token);
                        if (!norm) return <span key={tokIdx}>{token}</span>;
                        return (
                          <span
                            key={tokIdx}
                            role="button"
                            tabIndex={0}
                            className="text-token"
                            onClick={() => onWordTap?.(token, text)}
                            onKeyDown={(e) => { if (e.key === "Enter") onWordTap?.(token, text); }}
                          >
                            {token}
                          </span>
                        );
                      })}
                    </span>
                    <SpeakButton text={text} lang={lang} size={14} />
                  </div>
                  {translation && (
                    <div style={{ 
                      paddingLeft: "24px", 
                      color: "rgba(240, 230, 211, 0.45)", 
                      fontSize: "13px",
                      fontStyle: "italic",
                      marginTop: "-2px",
                      lineHeight: 1.4
                    }}>
                      {translation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </>
        )}

      </section>
    </div>
  );
}
