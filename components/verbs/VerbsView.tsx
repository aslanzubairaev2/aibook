"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Dumbbell, Loader2, Repeat, SlidersHorizontal } from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { entryToAnalysis, entryToCardText } from "@/components/dictionary/DictionaryPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { VerbsQuiz } from "@/components/verbs/VerbsQuiz";
import { isIrregularGermanVerb, normalizePos } from "@/lib/verbForms";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders, sbInsertFlashcard } from "@/lib/db/supabase";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { freshFetch } from "@/lib/net/freshFetch";
import type { AiAnalysis, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  cards: Flashcard[];
  onAddCard: (card: Flashcard) => void;
  onBack: () => void;
};

type VerbType = "all" | "regular" | "irregular";

type VerbGroup = {
  key: string;
  title: string;
  createdAt: number;
  verbs: DictionaryEntry[];
};

const SOURCE_LABEL = "Глаголы";

/**
 * Every verb already in the learner's dictionary, laid out the way their
 * teacher's notebook is: Infinitiv · Präteritum · Partizip II, one pack at a
 * time. No new photo pipeline — this reads the same `dictionary_entries`
 * every other screen does, and only shows the ones with principal parts.
 */
export function VerbsView({ profile, cards, onAddCard, onBack }: Props) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [batches, setBatches] = useState<DictionaryBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [verbType, setVerbType] = useState<VerbType>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [wordModal, setWordModal] = useState<{ entry: DictionaryEntry; analysis: AiAnalysis } | null>(null);
  const [quizVerbs, setQuizVerbs] = useState<DictionaryEntry[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadDictionary = useCallback(async () => {
    if (!user) { setEntries([]); setBatches([]); setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      const res = await freshFetch(`/api/dictionary?language=${encodeURIComponent(profile.targetLanguage)}`, {
        headers: await sbAuthHeaders(),
      });
      const data = await res.json() as { entries?: DictionaryEntry[]; batches?: DictionaryBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить глаголы.");
      setEntries(data.entries ?? []);
      setBatches(data.batches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить глаголы.");
    } finally {
      setIsLoading(false);
    }
  }, [user, profile.targetLanguage]);

  useEffect(() => { void loadDictionary(); }, [loadDictionary]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Every entry the teacher's table is actually about: a verb with at least
  // one principal part recorded. A "глагол" with nothing in `forms` has
  // nothing this module can show.
  const allVerbs = useMemo(
    () => entries.filter((e) => normalizePos(e.part_of_speech).includes("глагол") && (e.forms?.praeteritum || e.forms?.partizip2)),
    [entries],
  );

  const verbs = useMemo(() => {
    if (verbType === "all") return allVerbs;
    return allVerbs.filter((e) => {
      const irregular = isIrregularGermanVerb(e.lemma, e.headword, e.forms);
      return verbType === "irregular" ? irregular : !irregular;
    });
  }, [allVerbs, verbType]);

  const groups = useMemo<VerbGroup[]>(() => {
    const byBatch = new Map<string, DictionaryEntry[]>();
    const loose: DictionaryEntry[] = [];
    for (const v of verbs) {
      if (v.batch_id) {
        const list = byBatch.get(v.batch_id) ?? [];
        list.push(v);
        byBatch.set(v.batch_id, list);
      } else {
        loose.push(v);
      }
    }

    const result: VerbGroup[] = [];
    for (const batch of batches) {
      const batchVerbs = byBatch.get(batch.id) ?? [];
      if (batchVerbs.length === 0) continue;
      result.push({ key: batch.id, title: batch.title, createdAt: Date.parse(batch.created_at) || 0, verbs: batchVerbs });
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    if (loose.length > 0) {
      result.push({ key: "loose", title: "Без пачки", createdAt: 0, verbs: loose });
    }
    return result;
  }, [verbs, batches]);

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  function openEntry(entry: DictionaryEntry) {
    setWordModal({ entry, analysis: entryToAnalysis(entry) });
  }

  function addCardFromEntry(entry: DictionaryEntry) {
    const { front, back } = entryToCardText(entry);
    if (cards.some((c) => c.front.trim().toLowerCase() === front.trim().toLowerCase())) {
      setToast("Такая карточка уже есть");
      return;
    }
    const srs = createDefaultSrsFields(null, SOURCE_LABEL);
    const card: Flashcard = {
      id: `card-${Date.now()}`,
      type: "word",
      source: SOURCE_LABEL,
      addedAt: new Date().toISOString(),
      ...srs,
      front,
      back,
    };
    onAddCard(card);
    setToast("✓ Карточка добавлена");
    if (user) {
      void sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: card.front,
        back: card.back,
        source_book_title: SOURCE_LABEL,
        selection_type: "word",
        repetitions: srs.repetitions,
        lapses: srs.lapses,
        easiness_factor: srs.easeFactor,
        interval_days: srs.intervalDays,
        next_review_at: srs.dueAt,
        last_reviewed_at: srs.lastReviewedAt,
        source_book_id: null,
        status: srs.status,
      });
    }
  }

  const activeFilterCount = verbType !== "all" ? 1 : 0;

  if (quizVerbs) {
    return (
      <VerbsQuiz
        verbs={quizVerbs}
        targetLanguage={profile.targetLanguage}
        onExit={() => setQuizVerbs(null)}
      />
    );
  }

  return (
    <section className="verbs-view">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Глаголы</p>
          <h1>Infinitiv · Präteritum · Partizip II</h1>
        </div>
      </header>

      {isLoading ? (
        <div className="dict-loading">
          <Loader2 className="spin" size={22} /> Загружаю глаголы...
        </div>
      ) : error ? (
        <div className="empty-state">
          <Repeat size={40} />
          <strong>Не удалось загрузить</strong>
          <p>{error}</p>
        </div>
      ) : allVerbs.length === 0 ? (
        <div className="empty-state">
          <Repeat size={40} />
          <strong>Глаголов пока нет</strong>
          <p>Сфотографируйте страницу с глаголами в Словаре — те, что с формами прошедшего времени, появятся здесь автоматически.</p>
        </div>
      ) : (
        <>
          <div className="verbs-toolbar">
            <button
              type="button"
              className={`all-filter-toggle dict-filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal size={15} /> Тип
              {activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}
              <ChevronDown size={12} />
            </button>
            <span className="dict-toolbar-count">{verbs.length} {verbNoun(verbs.length)}</span>
            {verbs.length > 0 && (
              <button type="button" className="dict-train-btn verbs-train-all-btn" onClick={() => setQuizVerbs(verbs)}>
                <Dumbbell size={14} /> Тренировать всё
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="all-filter-panel">
              <div className="filter-group">
                <div className="filter-group-label">Тип глаголов</div>
                <div className="filter-chips">
                  <button type="button" className={`filter-chip ${verbType === "all" ? "active" : ""}`} onClick={() => setVerbType("all")}>Все</button>
                  <button type="button" className={`filter-chip ${verbType === "regular" ? "active" : ""}`} onClick={() => setVerbType("regular")}>Слабые</button>
                  <button type="button" className={`filter-chip ${verbType === "irregular" ? "active" : ""}`} onClick={() => setVerbType("irregular")}>Сильные</button>
                </div>
              </div>
            </div>
          )}

          <div className="verbs-groups">
            {groups.map((group) => {
              const open = !collapsed.has(group.key);
              return (
                <section key={group.key} className="verb-batch">
                  <button type="button" className="verb-batch-head" onClick={() => toggleGroup(group.key)}>
                    <strong className="verb-batch-title">{group.title}</strong>
                    <span className="dict-batch-meta">{group.verbs.length} {verbNoun(group.verbs.length)}</span>
                    <ChevronDown size={17} className={`dict-batch-chevron${open ? " open" : ""}`} />
                  </button>

                  {open && (
                    <>
                      <button type="button" className="dict-train-btn verb-batch-train-btn" onClick={() => setQuizVerbs(group.verbs)}>
                        <Dumbbell size={14} /> Тренировать эту пачку
                      </button>

                      <div className="verb-table-wrap">
                        <table className="verb-table">
                          <thead>
                            <tr>
                              <th>Infinitiv</th>
                              <th>Präteritum</th>
                              <th>Partizip II</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.verbs.map((entry) => {
                              const irregular = isIrregularGermanVerb(entry.lemma, entry.headword, entry.forms);
                              return (
                                <tr
                                  key={entry.id}
                                  className={`verb-row ${irregular ? "verb-row-irregular" : "verb-row-regular"}`}
                                  onClick={() => openEntry(entry)}
                                >
                                  <td className="verb-cell-infinitive">
                                    <span className="verb-infinitive">{entry.headword}</span>
                                    {entry.translation && <span className="verb-translation">{entry.translation}</span>}
                                  </td>
                                  <td>{entry.forms?.praeteritum || "—"}</td>
                                  <td>{partizipCell(entry)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {wordModal && (
        <WordModal
          analysis={wordModal.analysis}
          isOpen
          lang={profile.targetLanguage}
          nativeLang={profile.nativeLanguage}
          selectedWord={wordModal.entry.headword}
          onClose={() => setWordModal(null)}
          onAddCard={() => addCardFromEntry(wordModal.entry)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

/** «ist geschwommen» / «hat gemacht» — the auxiliary is half of what Partizip II is for. */
function partizipCell(entry: DictionaryEntry): string {
  const p2 = (entry.forms?.partizip2 || "").trim();
  if (!p2) return "—";
  const aux = (entry.forms?.hilfsverb || "").trim().toLowerCase();
  if (aux === "sein") return `ist ${p2}`;
  if (aux === "haben") return `hat ${p2}`;
  return p2;
}

function verbNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "глаголов";
  if (mod10 === 1) return "глагол";
  if (mod10 >= 2 && mod10 <= 4) return "глагола";
  return "глаголов";
}
