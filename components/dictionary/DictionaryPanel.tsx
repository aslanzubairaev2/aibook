"use client";

import { useMemo, useState } from "react";
import { BookA, Camera, Loader2, Search, Trash2, X, Volume2 } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import type { CefrLevel, Flashcard } from "@/lib/types";
import { speak } from "@/lib/tts";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Gender colours are the one visual cue that makes German nouns stick, so they
// are the same everywhere in the app: the reader, the cards, and here.
const GENDER_LABEL: Record<string, string> = { m: "der", f: "die", n: "das", pl: "die (Pl.)" };

const FORM_LABEL: Record<string, string> = {
  praeteritum: "Präteritum",
  partizip2: "Partizip II",
  hilfsverb: "Вспом. глагол",
  trennbar: "Отделяемая приставка",
  komparativ: "Сравнит.",
  superlativ: "Превосх.",
};

type Props = {
  entries: DictionaryEntry[];
  isLoading: boolean;
  error: string | null;
  language: string;
  onPhotograph: () => void;
  onDelete: (id: string) => void;
  onAddCard: (entry: DictionaryEntry) => void;
  /** Fronts of existing flashcards, so an already-added word says so. */
  cardFronts: Set<string>;
};

/**
 * The learner's own dictionary.
 *
 * One entry per word, deliberately: a photographed coursebook page is a list of
 * words to learn, and merging them into a single document would make each word
 * unfindable — which is the opposite of what a dictionary is for.
 */
export function DictionaryPanel({
  entries, isLoading, error, language, onPhotograph, onDelete, onAddCard, cardFronts,
}: Props) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<CefrLevel | "">("");
  const [open, setOpen] = useState<DictionaryEntry | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (level && e.cefr !== level) return false;
      if (!q) return true;
      return (
        e.headword.toLowerCase().includes(q) ||
        e.lemma.toLowerCase().includes(q) ||
        e.translation.toLowerCase().includes(q)
      );
    });
  }, [entries, query, level]);

  // Which levels are actually present — a filter offering empty levels is noise.
  const levelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) if (e.cefr) counts.set(e.cefr, (counts.get(e.cefr) ?? 0) + 1);
    return counts;
  }, [entries]);

  if (isLoading) {
    return (
      <div className="dict-loading">
        <Loader2 className="spin" size={22} /> Загружаю словарь...
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <BookA size={40} />
        <strong>Словарь недоступен</strong>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      {entries.length === 0 ? (
        <div className="empty-state">
          <BookA size={40} />
          <strong>Словарь пуст</strong>
          <p>Сфотографируйте страницу со словами — каждое слово станет отдельной статьёй с артиклем, множественным числом и переводом.</p>
          <button type="button" className="primary-btn" style={{ maxWidth: 260, margin: "12px auto 0" }} onClick={onPhotograph}>
            <Camera size={16} style={{ marginRight: 6 }} />Сфотографировать слова
          </button>
        </div>
      ) : (
        <>
          <div className="dict-toolbar">
            <div className="dict-search">
              <Search size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Слово или перевод"
                aria-label="Поиск по словарю"
              />
            </div>
            <div className="dict-levels">
              <button
                type="button"
                className={`dict-level-chip${level === "" ? " active" : ""}`}
                onClick={() => setLevel("")}
              >
                Все · {entries.length}
              </button>
              {LEVELS.filter((l) => levelCounts.has(l)).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`dict-level-chip${level === l ? " active" : ""}`}
                  onClick={() => setLevel(level === l ? "" : l)}
                >
                  {l} · {levelCounts.get(l)}
                </button>
              ))}
            </div>
          </div>

          <div className="dict-list">
            {filtered.map((entry) => (
              <button key={entry.id} type="button" className="dict-row" onClick={() => setOpen(entry)}>
                <div className="dict-row-main">
                  <span className={`dict-word gender-${entry.gender || "none"}`}>{entry.headword}</span>
                  <span className="dict-translation">{entry.translation}</span>
                </div>
                <div className="dict-row-meta">
                  {entry.plural && <span className="dict-chip">{entry.plural}</span>}
                  {entry.cefr && <span className="dict-chip level">{entry.cefr}</span>}
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="dict-nothing">Ничего не нашлось.</p>}
          </div>
        </>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <section className="book-modal dict-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
            <header className="book-modal-header">
              <div>
                <p className="eyebrow">{open.part_of_speech || "Слово"}{open.cefr ? ` · ${open.cefr}` : ""}</p>
                <h3 className={`gender-${open.gender || "none"}`}>{open.headword}</h3>
              </div>
              <button type="button" className="icon-btn" onClick={() => setOpen(null)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </header>

            <div className="dict-modal-body">
              <div className="dict-detail-row">
                <span>Перевод</span>
                <strong>{open.translation}</strong>
              </div>

              {open.gender && (
                <div className="dict-detail-row">
                  <span>Род</span>
                  <strong>{GENDER_LABEL[open.gender] ?? open.gender}</strong>
                </div>
              )}
              {open.plural && (
                <div className="dict-detail-row">
                  <span>Мн. число</span>
                  <strong>{open.plural}</strong>
                </div>
              )}
              {Object.entries(open.forms ?? {}).map(([key, value]) => (
                <div key={key} className="dict-detail-row">
                  <span>{FORM_LABEL[key] ?? key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
              {open.cefr && (
                <div className="dict-detail-row">
                  <span>Уровень</span>
                  <strong>{open.cefr}</strong>
                </div>
              )}

              {open.note && <p className="dict-note">{open.note}</p>}

              {open.example && (
                <div className="dict-example">
                  <div className="dict-example-line">
                    <span>{open.example}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Произнести пример"
                      onClick={() => void speak(open.example, language)}
                    >
                      <Volume2 size={15} />
                    </button>
                  </div>
                  {open.example_translation && <em>{open.example_translation}</em>}
                </div>
              )}

              {open.source && <p className="dict-source">Источник: {open.source}</p>}
            </div>

            <footer className="dict-modal-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="Произнести слово"
                onClick={() => void speak(open.headword, language)}
              >
                <Volume2 size={18} />
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={cardFronts.has(open.headword.toLowerCase())}
                onClick={() => onAddCard(open)}
              >
                {cardFronts.has(open.headword.toLowerCase()) ? "Уже в карточках" : "В карточки"}
              </button>
              <button
                type="button"
                className="icon-btn danger"
                aria-label="Удалить слово"
                onClick={() => { onDelete(open.id); setOpen(null); }}
              >
                <Trash2 size={18} />
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

/** A dictionary entry as a flashcard: the headword carries the article, the back carries the cheat sheet. */
export function entryToCardText(entry: DictionaryEntry): { front: string; back: string } {
  const extras = [
    entry.plural && `мн. ч.: ${entry.plural}`,
    ...Object.entries(entry.forms ?? {}).map(([k, v]) => `${FORM_LABEL[k] ?? k}: ${v}`),
  ].filter(Boolean);

  return {
    front: entry.headword,
    back: extras.length > 0 ? `${entry.translation}\n${extras.join(" · ")}` : entry.translation,
  };
}

export type { Flashcard };
