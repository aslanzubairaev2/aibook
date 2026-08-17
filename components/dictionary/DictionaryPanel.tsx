"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookA, Camera, ChevronDown, Dumbbell, Loader2, Search, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { getCardVariantProgressMap } from "@/lib/db/local";
import { describePackTraining, getCardsVariantProgress, type TrainBatch } from "@/lib/cards";
import { SpeakButton } from "@/components/ui/SpeakButton";
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

// The row has little width to spare; the chip carries the familiar
// dictionary-style abbreviation, and the full label lives in the word modal.
const POS_SHORT: Record<string, string> = {
  "существительное": "сущ.",
  "глагол": "гл.",
  "прилагательное": "прил.",
  "наречие": "нар.",
  "предлог": "предл.",
  "союз": "союз",
  "местоимение": "мест.",
  "числительное": "числ.",
  "выражение": "выраж.",
};
function shortPos(pos: string): string {
  const norm = normalizePos(pos);
  return POS_SHORT[norm] ?? (norm ? norm.slice(0, 6) : "");
}

type BatchGroup = {
  batch: DictionaryBatch | null; // null = words photographed before batches existed
  entries: DictionaryEntry[];
  /**
   * The pack's flashcards. A pack of phrases or sentences — anything an
   * assistant built — has these and no dictionary entries at all, and is shown
   * through them.
   */
  cards: Flashcard[];
  /** Of this batch's flashcards, how many have been answered correctly at least once. */
  progress: { learned: number; total: number } | null;
  /**
   * A pack that exists only as cards sharing a source name: real to the
   * learner, but with no row of its own, so it cannot be deleted or configured
   * here. Trained by title.
   */
  looseTitle?: string;
};

type Props = {
  entries: DictionaryEntry[];
  batches: DictionaryBatch[];
  cards: Flashcard[];
  isLoading: boolean;
  error: string | null;
  /** Target language, for pronouncing the words in the rows. */
  language: string;
  onPhotograph: () => void;
  onOpenEntry: (entry: DictionaryEntry) => void;
  onDeleteEntry: (id: string) => void;
  onDeleteBatch: (batchId: string) => void;
  /** Open the flashcard trainer narrowed to this pack's cards. */
  onTrainBatch: (batch: TrainBatch) => void;
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
const GERMAN_IRREGULAR_VERB_STEMS = new Set([
  "sein", "haben", "werden", "können", "müssen", "wollen", "sollen", "dürfen", "mögen", "wissen", "tun",
  "backen", "befehlen", "beginnen", "beißen", "bergen", "bersten", "bewegen", "biegen", "bieten", "binden",
  "bitten", "blasen", "bleiben", "braten", "brechen", "brennen", "bringen", "denken", "dreschen", "dringen",
  "empfehlen", "erlöschen", "erschrecken", "essen", "fahren", "fallen", "fangen", "fechten", "finden",
  "flechten", "fliegen", "fliehen", "fließen", "fressen", "frieren", "gären", "gebären", "geben", "gedeihen",
  "gehen", "gelingen", "gelten", "genesen", "genießen", "geschehen", "gewinnen", "gießen", "gleichen",
  "gleiten", "glimmen", "graben", "greifen", "halten", "hängen", "hauen", "heben", "heißen", "helfen",
  "kennen", "klingen", "kneifen", "kommen", "kriechen", "laden", "lassen", "laufen", "leiden", "leihen",
  "lesen", "liegen", "lügen", "mahlen", "meiden", "melken", "messen", "misslingen", "nehmen", "nennen",
  "pfeifen", "preisen", "quellen", "raten", "reiben", "reißen", "reiten", "rennen", "riechen", "ringen",
  "rinnen", "rufen", "salzen", "saufen", "saugen", "schaffen", "scheiden", "scheinen", "schelten", "scheren",
  "schieben", "schießen", "schlafen", "schlagen", "schleichen", "schleifen", "schließen", "schlingen",
  "schmeißen", "schmelzen", "schneiden", "schreiben", "schreien", "schreiten", "schweigen", "schwellen",
  "schwimmen", "schwinden", "schwingen", "schwören", "sehen", "senden", "singen", "sinken", "sinnen",
  "sitzen", "spinnen", "sprechen", "sprießen", "springen", "stechen", "stehen", "stehlen", "steigen",
  "sterben", "stinken", "stoßen", "streichen", "streiten", "tragen", "treffen", "treiben", "treten",
  "triefen", "trinken", "trügen", "verbieten", "verbleiben", "vergessen", "vergleichen", "verlassen",
  "verlieren", "vermeiden", "verstehen", "verschwinden", "verzeihen", "wachsen", "wägen", "waschen",
  "weichen", "weisen", "wenden", "werben", "werden", "werfen", "wiegen", "winden", "winken", "wissen",
  "ziehen", "zwingen", "fernsehen"
]);

function isIrregularGermanVerb(lemma: string, headword: string, forms: Record<string, string> = {}): boolean {
  const norm = (lemma || headword || "").toLowerCase().trim();
  if (!norm) return false;

  for (const stem of GERMAN_IRREGULAR_VERB_STEMS) {
    if (norm === stem || norm.endsWith(stem)) return true;
  }

  const p2 = (forms.partizip2 || "").toLowerCase().trim();
  const pr = (forms.praeteritum || "").toLowerCase().trim();

  if (p2.endsWith("en") && !p2.endsWith("ten")) return true;
  if (pr && !pr.endsWith("te") && !pr.endsWith("ten")) return true;

  return false;
}

export function DictionaryPanel({
  entries, batches, cards, isLoading, error, language,
  onPhotograph, onOpenEntry, onDeleteEntry, onDeleteBatch, onTrainBatch,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [level, setLevel] = useState<string>("all");
  const [pos, setPos] = useState<string>("all");
  const [verbType, setVerbType] = useState<"all" | "regular" | "irregular">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isStuck, setIsStuck] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!stickyRef.current) return;
      const rect = stickyRef.current.getBoundingClientRect();
      setIsStuck(rect.top <= 12);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dict-search-float, .dict-search-toggle")) {
        setSearchOpen(false);
        setQuery("");
      }
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

  const activeFilterCount = (level !== "all" ? 1 : 0) + (pos !== "all" ? 1 : 0) + (pos === "глагол" && verbType !== "all" ? 1 : 0);
  const isNarrowed = activeFilterCount > 0 || query.trim().length > 0;

  const matches = (e: DictionaryEntry): boolean => {
    if (level !== "all" && e.cefr !== level) return false;
    if (pos !== "all" && normalizePos(e.part_of_speech) !== pos) return false;
    if (pos === "глагол" && verbType !== "all") {
      const irr = isIrregularGermanVerb(e.lemma, e.headword, e.forms);
      if (verbType === "regular" && irr) return false;
      if (verbType === "irregular" && !irr) return false;
    }
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      e.headword.toLowerCase().includes(q) ||
      e.lemma.toLowerCase().includes(q) ||
      e.translation.toLowerCase().includes(q)
    );
  };

  /** A card matches a text search on either side; the word filters are about dictionary entries, not cards. */
  const cardMatches = (card: Flashcard): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return card.front.toLowerCase().includes(q) || card.back.toLowerCase().includes(q);
  };

  /**
   * Packs that hold cards and no dictionary words at all — a set of phrases or
   * sentences. Read from the unfiltered entries, so a level filter cannot make
   * a page of nouns look like one of them.
   */
  const wordlessBatchIds = useMemo(() => {
    const withWords = new Set(entries.map((e) => e.batch_id).filter(Boolean) as string[]);
    return new Set(batches.map((b) => b.id).filter((id) => !withWords.has(id)));
  }, [entries, batches]);

  const groups = useMemo<BatchGroup[]>(() => {
    const variantProgress = getCardVariantProgressMap();
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
    const claimedTitles = new Set(batches.map((b) => b.title));

    for (const batch of batches) {
      const batchEntries = byBatch.get(batch.id) ?? [];
      const batchCards = cards.filter((c) => c.sourceBookId === batch.id);
      // A pack with nothing matching disappears while a search or filter is
      // narrowing the view; an untouched view shows every pack, even one whose
      // words were all deleted (so it can still be removed). A pack of phrases
      // has no dictionary entries at all — its cards are what it holds, so
      // those are what the narrowing is measured against.
      const shownCards = batchEntries.length > 0 ? batchCards : batchCards.filter(cardMatches);
      if (isNarrowed && batchEntries.length === 0 && shownCards.length === 0) continue;
      result.push({
        batch,
        entries: batchEntries,
        cards: shownCards,
        progress: batchCards.length > 0
          ? getCardsVariantProgress(batchCards, variantProgress)
          : null,
      });
    }

    // Cards an assistant filed under a source name of its own, before packs
    // could hold phrases. They are a pack to the learner in every way that
    // matters, so the screen treats them as one — with progress, and with the
    // «тренировать» button that was the whole point.
    const looseCards = new Map<string, Flashcard[]>();
    for (const card of cards) {
      const title = card.sourceBookTitle || card.source || "";
      if (card.sourceBookId || !title || claimedTitles.has(title)) continue;
      looseCards.set(title, [...(looseCards.get(title) ?? []), card]);
    }
    for (const [title, packCards] of looseCards) {
      const shownCards = packCards.filter(cardMatches);
      if (isNarrowed && shownCards.length === 0) continue;
      result.push({
        batch: null,
        looseTitle: title,
        entries: [],
        cards: shownCards,
        progress: getCardsVariantProgress(packCards, variantProgress),
      });
    }

    if (loose.length > 0) result.push({ batch: null, entries: loose, cards: [], progress: null });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, batches, cards, query, level, pos, verbType]);

  const shownWordCount = groups.reduce((sum, g) => sum + g.entries.length, 0);
  // Cards of packs that hold no dictionary words — counted apart, because
  // «482 слова» must not quietly start meaning something else.
  const shownCardCount = groups.reduce(
    (sum, g) => sum + (g.entries.length === 0 ? g.cards.length : 0),
    0,
  );

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

  // Packs an assistant built out of phrases live here too, and they are not
  // "nothing" — offering the camera when the learner already has three packs of
  // sentences waiting is telling them their own material does not exist.
  const hasPackCards = cards.some((c) => !c.sourceBookId && Boolean(c.sourceBookTitle || c.source));
  if (entries.length === 0 && batches.length === 0 && !hasPackCards) {
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
      {/* Sticky container: glass blur appears only when pinned to top edge on scroll */}
      <div ref={stickyRef} className={`dict-toolbar-sticky ${isStuck ? "stuck" : ""}`}>
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
            {shownCardCount > 0 && ` · ${shownCardCount} ${cardNoun(shownCardCount)}`}
          </span>

          <button
            type="button"
            className={`icon-btn dict-search-toggle${searchOpen || query ? " active" : ""}`}
            aria-label={searchOpen ? "Закрыть поиск" : "Поиск по словарю"}
            onClick={(e) => {
              e.stopPropagation();
              setQuery("");
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
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Слово или перевод — по всем пачкам"
                aria-label="Поиск по словарю"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  className="dict-search-clear-btn"
                  aria-label="Очистить поле поиска"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
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
                  <button
                    type="button"
                    className={`filter-chip ${pos === "all" ? "active" : ""}`}
                    onClick={() => { setPos("all"); setVerbType("all"); }}
                  >
                    Все
                  </button>
                  {posOptions.map(([norm, label]) => (
                    <button
                      key={norm}
                      type="button"
                      className={`filter-chip ${pos === norm ? "active" : ""}`}
                      onClick={() => {
                        const next = pos === norm ? "all" : norm;
                        setPos(next);
                        if (next !== "глагол") setVerbType("all");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pos === "глагол" && (
              <div className="filter-group">
                <div className="filter-group-label">Тип глаголов</div>
                <div className="filter-chips">
                  <button type="button" className={`filter-chip ${verbType === "all" ? "active" : ""}`} onClick={() => setVerbType("all")}>Все</button>
                  <button type="button" className={`filter-chip ${verbType === "regular" ? "active" : ""}`} onClick={() => setVerbType("regular")}>Правильные</button>
                  <button type="button" className={`filter-chip ${verbType === "irregular" ? "active" : ""}`} onClick={() => setVerbType("irregular")}>Неправильные</button>
                </div>
              </div>
            )}
            {activeFilterCount > 0 && (
              <button type="button" className="filter-reset-btn" onClick={() => { setLevel("all"); setPos("all"); setVerbType("all"); }}>
                Сбросить фильтры
              </button>
            )}
          </div>
        )}
      </div>

      <div className="dict-batches">
        {groups.map((group) => {
          const key = group.batch?.id ?? group.looseTitle ?? "loose";
          const open = isExpanded(key);
          const pct = group.progress && group.progress.total > 0
            ? Math.round((group.progress.learned / group.progress.total) * 100)
            : null;
          const title = group.batch?.title ?? group.looseTitle ?? "Прочие слова";
          // A pack of phrases has no dictionary words to count, so it is
          // measured in cards — which is what it actually holds.
          const isCardPack = group.batch
            ? wordlessBatchIds.has(group.batch.id)
            : Boolean(group.looseTitle);
          const trainingSummary = describePackTraining(group.batch?.training);
          const isPack = Boolean(group.batch || group.looseTitle);

          return (
            <section key={key} className="dict-batch">
              <button type="button" className="dict-batch-head" onClick={() => toggle(key)}>
                <div className="dict-batch-title-wrap">
                  <strong className="dict-batch-title">{title}</strong>
                  <span className="dict-batch-meta">
                    {group.batch
                      ? [
                          group.batch.kind,
                          isCardPack
                            ? `${group.cards.length} ${cardNoun(group.cards.length)}`
                            : `${group.entries.length} ${wordNoun(group.entries.length)}`,
                          formatDate(group.batch.created_at),
                        ].filter(Boolean).join(" · ")
                      : group.looseTitle
                        ? `от ИИ-ассистента · ${group.cards.length} ${cardNoun(group.cards.length)}`
                        : `${group.entries.length} ${wordNoun(group.entries.length)} · добавлены до появления пачек`}
                  </span>
                  {trainingSummary && (
                    <span className="dict-batch-training" title="Как эта пачка тренируется по умолчанию">
                      <Dumbbell size={11} />{trainingSummary}
                    </span>
                  )}
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

              {isPack && (
                <div className="dict-batch-actions">
                  <button
                    type="button"
                    className="dict-train-btn"
                    onClick={() =>
                      onTrainBatch({
                        id: group.batch?.id ?? "",
                        title,
                        training: group.batch?.training ?? null,
                      })
                    }
                  >
                    <Dumbbell size={14} />
                    {pct === null || pct === 0 ? "Тренировать" : pct >= 100 ? "Повторить" : "Продолжить изучение"}
                  </button>
                  {group.batch && (
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label="Удалить пачку"
                      title="Удалить пачку (карточки и их прогресс остаются)"
                      onClick={() => {
                        // A pack of phrases has no dictionary words to warn
                        // about; saying otherwise would describe a deletion
                        // that is not the one about to happen.
                        const question = isCardPack
                          ? "Убрать эту пачку из словаря? Карточки и прогресс их изучения останутся — их можно будет найти во «Всех карточках»."
                          : "Удалить пачку и её слова из словаря? Карточки и прогресс их изучения останутся.";
                        if (confirm(question)) onDeleteBatch(group.batch!.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )}

              {open && isCardPack && (
                <div className="dict-list">
                  {group.cards.map((card) => (
                    <div key={card.id} className="dict-row-wrap">
                      <div className="dict-row dict-row-card">
                        <div className="dict-row-main">
                          <span className="dict-word">{card.front}</span>
                          <span className="dict-translation">{card.back}</span>
                        </div>
                      </div>
                      <span className="dict-row-side" onClick={(e) => e.stopPropagation()}>
                        <SpeakButton text={card.front} lang={language} size={15} />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {open && !isCardPack && (
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
                          {shortPos(entry.part_of_speech) && <span className="dict-chip pos">{shortPos(entry.part_of_speech)}</span>}
                          {entry.plural && <span className="dict-chip">{entry.plural}</span>}
                          {entry.cefr && <span className="dict-chip level">{entry.cefr}</span>}
                        </div>
                      </button>
                      <span className="dict-row-side" onClick={(e) => e.stopPropagation()}>
                        <SpeakButton text={entry.headword} lang={language} size={15} />
                      </span>
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

function cardNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "карточек";
  if (mod10 === 1) return "карточка";
  if (mod10 >= 2 && mod10 <= 4) return "карточки";
  return "карточек";
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
