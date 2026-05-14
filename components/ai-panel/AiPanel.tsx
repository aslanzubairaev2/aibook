"use client";

import { BookMarked, ChevronDown, Maximize2, Plus } from "lucide-react";
import type { AiAnalysis, Flashcard } from "@/lib/types";

type Props = {
  selection: { token: string; sentence: string };
  analysis: AiAnalysis | null;
  isLoading: boolean;
  onClose: () => void;
  onOpenWordModal: () => void;
  onAddCard: (type: Flashcard["type"]) => void;
};

export function AiPanel({ selection, analysis, isLoading, onClose, onOpenWordModal, onAddCard }: Props) {
  return (
    <aside className="ai-panel">
      {/* Handle */}
      <div className="panel-drag-area">
        <div className="panel-handle-bar" />
        <div className="panel-close-row">
          <span className="panel-selected-word">{selection.token}</span>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Закрыть">
            <ChevronDown size={20} />
          </button>
        </div>
      </div>

      {/* WORD */}
      <div className="panel-section panel-section-word">
        <div className="panel-section-header">
          <span className="panel-section-label">Слово</span>
          <button
            className="mini-btn"
            type="button"
            disabled={!analysis}
            onClick={onOpenWordModal}
          >
            <Maximize2 size={13} />
            подробнее
          </button>
        </div>
        {isLoading && !analysis ? (
          <PanelSkeleton label={selection.token} />
        ) : (
          <PanelContent
            main={analysis?.word.text ?? selection.token}
            sub={analysis?.word.partOfSpeech ?? ""}
            translation={analysis?.word.translation ?? "Анализирую…"}
            note={analysis?.word.explanation ?? ""}
          />
        )}
      </div>

      {/* PHRASE */}
      <div className="panel-section panel-section-phrase">
        <div className="panel-section-header">
          <span className="panel-section-label">Фраза</span>
          <button
            className="mini-btn"
            type="button"
            disabled={!analysis}
            onClick={() => onAddCard("phrase")}
          >
            <Plus size={13} />
            карточка
          </button>
        </div>
        {analysis ? (
          <PanelContent
            main={analysis.phrase.text}
            translation={analysis.phrase.translation}
            note={analysis.phrase.explanation}
          />
        ) : (
          <PanelSkeleton label="AI определяет фразу…" />
        )}
      </div>

      {/* SENTENCE */}
      <div className="panel-section">
        <div className="panel-section-header">
          <span className="panel-section-label">Предложение</span>
          <button
            className="mini-btn"
            type="button"
            disabled={!analysis}
            onClick={() => onAddCard("sentence")}
          >
            <BookMarked size={13} />
            сохранить
          </button>
        </div>
        {analysis ? (
          <PanelContent
            main={analysis.sentence.text}
            translation={analysis.sentence.translation}
            note={analysis.sentence.grammarNote}
          />
        ) : (
          <PanelSkeleton label={selection.sentence.slice(0, 80) + "…"} />
        )}
      </div>

      {/* CTA */}
      <button
        className="primary-btn"
        type="button"
        disabled={!analysis}
        onClick={() => onAddCard("word")}
        style={{ marginTop: 10 }}
      >
        <Plus size={18} />
        Добавить слово в карточки
      </button>
    </aside>
  );
}

function PanelContent({ main, sub, translation, note }: { main: string; sub?: string; translation: string; note: string }) {
  return (
    <div>
      <span className="panel-text-main">{main}{sub ? <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500, marginLeft: 8 }}>{sub}</span> : null}</span>
      <span className="panel-text-trans">{translation}</span>
      {note && <span className="panel-text-note">{note}</span>}
    </div>
  );
}

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div>
      <span className="panel-text-main" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="shimmer-line" />
      <span className="shimmer-line medium" />
      <span className="shimmer-line short" />
    </div>
  );
}
