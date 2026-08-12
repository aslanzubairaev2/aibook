"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookA, Camera, ChevronDown, Dumbbell, Loader2, Search, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import type { AiAnalysis, CefrLevel, Flashcard, PosTag } from "@/lib/types";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const FORM_LABEL: Record<string, string> = {
  praeteritum: "Präteritum",
  partizip2: "Partizip II",
  hilfsverb: "вспом. глагол",
  trennbar: "отделяемая",
  komparativ: "сравнит.",
  superlativ: "превосх.",
};

// The part-of-speech labels come from the model in the learner's language;
// normalising to lowercase merges "Глагол" and "глагол" into one chip.
function normalizePos(pos: string): string {
  return pos.trim().toLowerCase();
}

type BatchGroup = {
  batch: DictionaryBatch | null; // null = words photographed before batches existed
  entries: DictionaryEntry[];
  /** Of this batch's flashcards, how many have been answered correctly at least once. */
  progress: { learned: number; total: number } | null;
};

type Props = {
  entries: DictionaryEntry[];
  batches: DictionaryBatch[];
  cards: Flashcard[];
  isLoading: boolean;
  error: string | null;
  onPhotograph: () => void;
  onOpenEntry: (entry: DictionaryEntry) => void;
  onDeleteEntry: (id: string) => void;
  onDeleteBatch: (batchId: string) => void;
  /** Open the flashcard trainer narrowed to this batch's cards. */
  onTrainBatch: (batch: DictionaryBatch) => void;
};

/**
 * The learner's dictionary, organised the way the studying is organised: one
 * photographed page = one batch («пачка»), with its own progress and its own
 * "train these" button. A flat list of every word ever photographed is exactly
 * the pile the learner said they cannot face.
 *
 * Search and filters cut across every batch at once; a batch with nothing left
 * to show disappears rather than sitting there empty.
 */
export function DictionaryPanel({
  entries, batches, cards, isLoading, error,
  onPhotograph, onOpenEntry, onDeleteEntry, onDeleteBatch, onTrainBatch,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [level, setLevel] = useState<string>("all");
  const [pos, setPos] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Tapping anywhere else closes the floating search and the filter panel.
  //
  // On pointerdown, not click, and not out of preference: React (App Router)
  // delegates events on `document`, so a click on the toggle re-renders the
  // icon synchronously *before* this document-level listener sees the same
  // event — whose target, the old icon, is by then detached, `closest` finds
  // nothing, and the panel closes in the same instant it opened. At
  // pointerdown time the pressed element is still in the document.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dict-search-float, .dict-search-toggle")) setSearchOpen(false);
      if (!target.closest(".all-filter-panel, .dict-filter-toggle")) setFiltersOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  const posOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const norm = normalizePos(e.part_of_speech);
      if (norm && !seen.has(norm)) seen.set(norm, e.part_of_speech.trim());
    }
    return Array.from(seen.entries()); // [normalized, label]
  }, [entries]);

  const levelOptions = useMemo(
    () => LEVELS.filter((l) => entries.some((e) => e.cefr === l)),
    [entries],
  );

  const activeFilterCount = (level !== "all" ? 1 : 0) + (pos !== "all" ? 1 : 0);
  const isNarrowed = activeFilterCount > 0 || query.trim().length > 0;

  const matches = (e: DictionaryEntry): boolean => {
    if (level !== "all" && e.cefr !== level) return false;
    if (pos !== "all" && normalizePos(e.part_of_speech) !== pos) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      e.headword.toLowerCase().includes(q) ||
      e.lemma.toLowerCase().includes(q) ||
      e.translation.toLowerCase().includes(q)
    );
  };

  const groups = useMemo<BatchGroup[]>(() => {
    const byBatch = new Map<string, DictionaryEntry[]>();
    const loose: DictionaryEntry[] = [];
    for (const e of entries) {
      if (!matches(e)) continue;
      if (e.batch_id) {
        const list = byBatch.get(e.batch_id) ?? [];
        list.push(e);
        byBatch.set(e.batch_id, list);
      } else {
        loose.push(e);
      }
    }

    const result: BatchGroup[] = [];
    for (const batch of batches) {
      const batchEntries = byBatch.get(batch.id) ?? [];
      // A batch with no matching words disappears while a search or filter is
      // narrowing the view; an untouched view shows every batch, even one
      // whose words were all deleted (so it can still be removed).
      if (batchEntries.length === 0 && isNarrowed) continue;
      const batchCards = cards.filter((c) => c.sourceBookId === batch.id);
      result.push({
        batch,
        entries: batchEntries,
        progress: batchCards.length > 0
          ? { learned: batchCards.filter((c) => c.repetitions > 0).length, total: batchCards.length }
          : null,
      });
    }
    if (loose.length > 0) result.push({ batch: null, entries: loose, progress: null });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, batches, cards, query, level, pos]);

  const shownWordCount = groups.reduce((sum, g) => sum + g.entries.length, 0);

  const isExpanded = (key: string) => isNarrowed || expanded.has(key);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  if (entries.length === 0 && batches.length === 0) {
    return (
      <div className="empty-state">
        <BookA size={40} />
        <strong>Словарь пуст</strong>
        <p>Сфотографируйте страницу со словами — она станет пачкой: все слова с артиклями и переводом, сразу готовые к тренировке.</p>
        <button type="button" className="primary-btn" style={{ maxWidth: 260, margin: "12px auto 0" }} onClick={onPhotograph}>
          <Camera size={16} style={{ marginRight: 6 }} />Сфотографировать слова
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Toolbar: compact filters on the left, the search magnifier on the
          right. The search input floats over this row instead of pushing it. */}
      <div className="dict-toolbar-row">
        <button
          type="button"
          className={`all-filter-toggle dict-filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`}
          onClick={(e) => { e.stopPropagation(); setFiltersOpen((v) => !v); }}
        >
          <SlidersHorizontal size={15} /> Фильтры
          {activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}
          <ChevronDown size={12} />
        </button>

        <span className="dict-toolbar-count">
          {shownWordCount} {wordNoun(shownWordCount)}
        </span>

        <button
          type="button"
          className={`icon-btn dict-search-toggle${searchOpen || query ? " active" : ""}`}
          aria-label={searchOpen ? "Закрыть поиск" : "Поиск по словарю"}
          onClick={(e) => {
            e.stopPropagation();
            // No side effects inside an updater: concurrent React may replay
            // updaters, and a setQuery hidden in one made this toggle collapse
            // back to closed on real (trusted) clicks.
            if (searchOpen) setQuery("");
            setSearchOpen(!searchOpen);
          }}
        >
          {searchOpen ? <X size={18} /> : <Search size={18} />}
        </button>

        {searchOpen && (
          <div className="dict-search-float" onClick={(e) => e.stopPropagation()}>
            <Search size={15} />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Слово или перевод — по всем пачкам"
              aria-label="Поиск по словарю"
            />
            {query && (
              <button type="button" className="dict-search-clear" onClick={() => setQuery("")} aria-label="Очистить">
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {filtersOpen && (
        <div className="all-filter-panel" onClick={(e) => e.stopPropagation()}>
          {levelOptions.length > 0 && (
            <div className="filter-group">
              <div className="filter-group-label">Уровень</div>
              <div className="filter-chips">
                <button type="button" className={`filter-chip ${level === "all" ? "active" : ""}`} onClick={() => setLevel("all")}>Все</button>
                {levelOptions.map((l) => (
                  <button key={l} type="button" className={`filter-chip ${level === l ? "active" : ""}`} onClick={() => setLevel(level === l ? "all" : l)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {posOptions.length > 1 && (
            <div className="filter-group">
              <div className="filter-group-label">Часть речи</div>
              <div className="filter-chips">
                <button type="button" className={`filter-chip ${pos === "all" ? "active" : ""}`} onClick={() => setPos("all")}>Все</button>
                {posOptions.map(([norm, label]) => (
                  <button key={norm} type="button" className={`filter-chip ${pos === norm ? "active" : ""}`} onClick={() => setPos(pos === norm ? "all" : norm)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeFilterCount > 0 && (
            <button type="button" className="filter-reset-btn" onClick={() => { setLevel("all"); setPos("all"); }}>
              Сбросить фильтры
            </button>
          )}
        </div>
      )}

      <div className="dict-batches">
        {groups.map((group) => {
          const key = group.batch?.id ?? "loose";
          const open = isExpanded(key);
          const pct = group.progress && group.progress.total > 0
            ? Math.round((group.progress.learned / group.progress.total) * 100)
            : null;

          return (
            <section key={key} className="dict-batch">
              <button type="button" className="dict-batch-head" onClick={() => toggle(key)}>
                <div className="dict-batch-title-wrap">
                  <strong className="dict-batch-title">
                    {group.batch ? group.batch.title : "Прочие слова"}
                  </strong>
                  <span className="dict-batch-meta">
                    {group.batch?.kind ? `${group.batch.kind} · ` : ""}
                    {group.entries.length} {wordNoun(group.entries.length)}
                    {group.batch ? ` · ${formatDate(group.batch.created_at)}` : ""}
                  </span>
                </div>
                {pct !== null && (
                  <span className={`dict-batch-pct${pct >= 100 ? " done" : ""}`}>{pct}%</span>
                )}
                <ChevronDown size={17} className={`dict-batch-chevron${open ? " open" : ""}`} />
              </button>

              {pct !== null && (
                <div className="dict-batch-bar-wrap" aria-hidden>
                  <div className="dict-batch-bar" style={{ width: `${pct}%` }} />
                </div>
              )}

              {group.batch && (
                <div className="dict-batch-actions">
                  <button type="button" className="dict-train-btn" onClick={() => onTrainBatch(group.batch!)}>
                    <Dumbbell size={14} />
                    {pct === null || pct === 0 ? "Тренировать" : pct >= 100 ? "Повторить" : "Продолжить изучение"}
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label="Удалить пачку"
                    title="Удалить пачку (карточки и их прогресс остаются)"
                    onClick={() => {
                      if (confirm("Удалить пачку и её слова из словаря? Карточки и прогресс их изучения останутся.")) {
                        onDeleteBatch(group.batch!.id);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}

              {open && (
                <div className="dict-list">
                  {group.entries.map((entry) => (
                    <div key={entry.id} className="dict-row-wrap">
                      <button type="button" className="dict-row" onClick={() => onOpenEntry(entry)}>
                        <div className="dict-row-main">
                          <span className={`dict-word gender-${entry.gender || "none"}`}>{entry.headword}</span>
                          <span className="dict-translation">
                            {entry.translation}
                            {formsSummary(entry) && <em className="dict-forms"> · {formsSummary(entry)}</em>}
                          </span>
                        </div>
                        <div className="dict-row-meta">
                          {entry.plural && <span className="dict-chip">{entry.plural}</span>}
                          {entry.cefr && <span className="dict-chip level">{entry.cefr}</span>}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="dict-row-delete"
                        aria-label={`Удалить ${entry.headword}`}
                        onClick={() => onDeleteEntry(entry.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {group.entries.length === 0 && <p className="dict-nothing">В этой пачке слов не осталось.</p>}
                </div>
              )}
            </section>
          );
        })}
        {groups.length === 0 && <p className="dict-nothing">Ничего не нашлось.</p>}
      </div>
    </>
  );
}

/** «lud ein · eingeladen» — the irregular forms at a glance, right in the row. */
function formsSummary(entry: DictionaryEntry): string {
  const forms = entry.forms ?? {};
  return [forms.praeteritum, forms.partizip2].filter(Boolean).join(" · ");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function wordNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "слов";
  if (mod10 === 1) return "слово";
  if (mod10 >= 2 && mod10 <= 4) return "слова";
  return "слов";
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

// The word modal is the app's one place for word details; a dictionary entry
// already holds everything it displays, so the analysis is assembled locally —
// opening a word from the dictionary costs no AI call at all.
export function entryToAnalysis(entry: DictionaryEntry): AiAnalysis {
  const pos = normalizePos(entry.part_of_speech);
  const posTag: PosTag =
    pos.includes("глагол") ? "verb"
    : pos.includes("существ") ? "noun"
    : pos.includes("прилаг") ? "adjective"
    : pos.includes("нареч") ? "adverb"
    : pos.includes("местоим") ? "pronoun"
    : pos.includes("числит") ? "numeral"
    : "other";

  const formLines = Object.entries(entry.forms ?? {})
    .map(([k, v]) => `${FORM_LABEL[k] ?? k}: ${v}`)
    .join(" · ");

  return {
    word: {
      text: entry.headword,
      lemma: entry.lemma,
      partOfSpeech: entry.part_of_speech || "слово",
      posTag,
      gender: entry.article || (entry.gender === "pl" ? "Pl." : ""),
      cefr: entry.cefr || undefined,
      translation: entry.translation,
      explanation: [entry.note, formLines].filter(Boolean).join("\n"),
      nounDetails: posTag === "noun"
        ? { article: entry.article || undefined, plural: entry.plural || undefined }
        : undefined,
      verbDetails: posTag === "verb" ? { infinitive: entry.lemma } : undefined,
    },
    examples: entry.example
      ? [{ text: entry.example, translation: entry.example_translation }]
      : [],
  };
}
