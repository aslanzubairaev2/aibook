"use client";

import { ArrowLeft, BookOpen, Search } from "lucide-react";
import type { Flashcard } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  onBack: () => void;
};

const TYPE_LABELS = { word: "Слово", phrase: "Фраза", sentence: "Предложение" } as const;

export function CardsView({ cards, onBack }: Props) {
  const words     = cards.filter((c) => c.type === "word");
  const phrases   = cards.filter((c) => c.type === "phrase");
  const sentences = cards.filter((c) => c.type === "sentence");

  return (
    <section className="screen">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Словарь</p>
          <h1>Карточки</h1>
        </div>
        <button className="icon-btn" type="button" aria-label="Поиск">
          <Search size={20} />
        </button>
      </header>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[
          { label: "Слов",         count: words.length },
          { label: "Фраз",         count: phrases.length },
          { label: "Предложений",  count: sentences.length },
        ].map(({ label, count }) => (
          <div
            key={label}
            style={{
              flex: 1,
              padding: "12px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-elevated)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--accent)" }}>{count}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {cards.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={40} />
          <strong>Карточек пока нет</strong>
          <p>Тапните на слово в читалке и нажмите «Добавить в карточки»</p>
        </div>
      ) : (
        <div className="card-list">
          {cards.map((card) => (
            <div key={card.id} className="flash-card">
              <span className={`flash-card-type ${card.type}`}>
                {TYPE_LABELS[card.type]}
              </span>
              <div className="flash-card-front">{card.front}</div>
              <div className="flash-card-back">{card.back}</div>
              <div className="flash-card-source">из «{card.source}»</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
