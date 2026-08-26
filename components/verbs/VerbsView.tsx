"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, Dumbbell, Loader2, Repeat, SlidersHorizontal, Wand2 } from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { entryToAnalysis, entryToCardText } from "@/components/dictionary/DictionaryPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { VerbsQuiz } from "@/components/verbs/VerbsQuiz";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { isIrregularGermanVerb, normalizePos } from "@/lib/verbForms";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders, sbInsertFlashcard } from "@/lib/db/supabase";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { freshFetch } from "@/lib/net/freshFetch";
import { getLocalVerbsDict, getLocalVerbsOpenGroups, saveLocalVerbsDict, saveLocalVerbsOpenGroups } from "@/lib/db/local";
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

type FillResult = { ok: true } | { ok: false; error: string };

const SOURCE_LABEL = "Глаголы";

/**
 * Every verb already in the learner's dictionary, laid out the way their
 * teacher's notebook is: Infinitiv · Präteritum · Partizip II, one pack at a
 * time. Reads the same `dictionary_entries` every other screen does, can
 * photograph a new page itself, and can ask the AI to backfill principal
 * parts for a "глагол" entry that was saved without them.
 */
export function VerbsView({ profile, cards, onAddCard, onBack }: Props) {
  const { user } = useAuth();
  // Read once at mount so the screen shows the learner's own verbs straight
  // away — including on a hard refresh — instead of a blank spinner every
  // single time the network round trip that already ran once repeats itself.
  const cachedDict = useState(() => getLocalVerbsDict(profile.targetLanguage))[0];
  const [entries, setEntries] = useState<DictionaryEntry[]>(cachedDict?.entries ?? []);
  const [batches, setBatches] = useState<DictionaryBatch[]>(cachedDict?.batches ?? []);
  const [isLoading, setIsLoading] = useState(cachedDict === null);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(!!cachedDict && (cachedDict.entries.length > 0 || cachedDict.batches.length > 0));

  const [verbType, setVerbType] = useState<VerbType>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Which packs are expanded — persisted so the learner's choice survives a
  // reload, and empty by default so every pack starts closed.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => getLocalVerbsOpenGroups());

  const [wordModal, setWordModal] = useState<{ entry: DictionaryEntry; analysis: AiAnalysis } | null>(null);
  const [quizVerbs, setQuizVerbs] = useState<DictionaryEntry[] | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [fillingIds, setFillingIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const loadDictionary = useCallback(async () => {
    if (!user) { setEntries([]); setBatches([]); setIsLoading(false); return; }
    // Cached data is already on screen — refresh quietly in the background
    // instead of hiding it behind a spinner again.
    if (!hasDataRef.current) setIsLoading(true);
    setError(null);
    try {
      const res = await freshFetch(`/api/dictionary?language=${encodeURIComponent(profile.targetLanguage)}`, {
        headers: await sbAuthHeaders(),
      });
      const data = await res.json() as { entries?: DictionaryEntry[]; batches?: DictionaryBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить глаголы.");
      const nextEntries = data.entries ?? [];
      const nextBatches = data.batches ?? [];
      setEntries(nextEntries);
      setBatches(nextBatches);
      saveLocalVerbsDict(profile.targetLanguage, nextEntries, nextBatches);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить глаголы.";
      // A cached list is still shown behind it — don't blank the screen for a
      // background refresh that failed, just say so quietly.
      if (hasDataRef.current) setToast(message);
      else setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user, profile.targetLanguage]);

  useEffect(() => { void loadDictionary(); }, [loadDictionary]);

  useEffect(() => {
    hasDataRef.current = entries.length > 0 || batches.length > 0;
  }, [entries, batches]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Every "глагол" entry in the dictionary, whether or not it has forms yet —
  // used to split into the real table below and the "Без форм" backlog.
  const allGlagolEntries = useMemo(
    () => entries.filter((e) => normalizePos(e.part_of_speech).includes("глагол")),
    [entries],
  );

  // The teacher's table is about verbs with at least one principal part
  // recorded — a "глагол" with nothing in `forms` has nothing to show here.
  const allVerbs = useMemo(
    () => allGlagolEntries.filter((e) => e.forms?.praeteritum || e.forms?.partizip2),
    [allGlagolEntries],
  );

  // Saved as verbs, but with no Präteritum/Partizip II on file — typed in by
  // hand, added by an assistant, or read from a photo the model missed them
  // on. Shown separately with a way to ask the AI to fill them in.
  const missingForms = useMemo(
    () => allGlagolEntries.filter((e) => !e.forms?.praeteritum && !e.forms?.partizip2),
    [allGlagolEntries],
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
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveLocalVerbsOpenGroups(next);
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

  /** Asks the AI for one verb's principal parts and saves them, merged into whatever `forms` it already has. */
  async function fillEntryForms(entry: DictionaryEntry): Promise<FillResult> {
    try {
      const res = await freshFetch("/api/ai/verb-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          lemma: entry.lemma,
          headword: entry.headword,
          targetLanguage: profile.targetLanguage,
          nativeLanguage: profile.nativeLanguage,
        }),
      });
      const data = await res.json() as { forms?: Record<string, string>; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось получить формы.");
      const forms = data.forms ?? {};
      if (!forms.praeteritum && !forms.partizip2) throw new Error(`ИИ не смог определить формы «${entry.headword}»`);

      const saveRes = await freshFetch("/api/dictionary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({ id: entry.id, forms }),
      });
      const saveData = await saveRes.json() as { ok?: boolean; error?: string };
      if (!saveRes.ok) throw new Error(saveData.error ?? "Не удалось сохранить формы.");

      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, forms: { ...e.forms, ...forms } } : e)));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Не удалось заполнить формы." };
    }
  }

  async function fillOne(entry: DictionaryEntry) {
    setFillingIds((prev) => new Set(prev).add(entry.id));
    const result = await fillEntryForms(entry);
    setFillingIds((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
    setToast(result.ok ? "✓ Формы заполнены" : result.error);
  }

  async function fillAllMissing() {
    const targets = missingForms;
    if (targets.length === 0 || bulkProgress) return;
    setBulkProgress({ done: 0, total: targets.length });
    setFillingIds(new Set(targets.map((e) => e.id)));
    let failures = 0;
    for (const entry of targets) {
      const result = await fillEntryForms(entry);
      if (!result.ok) failures += 1;
      setFillingIds((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
      setBulkProgress((prev) => (prev ? { done: prev.done + 1, total: prev.total } : prev));
    }
    setBulkProgress(null);
    setToast(
      failures === 0
        ? `✓ Заполнено форм: ${targets.length}`
        : `Заполнено ${targets.length - failures} из ${targets.length}, ${failures} не удалось`,
    );
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

  const hasNothing = !isLoading && !error && allVerbs.length === 0 && missingForms.length === 0;

  return (
    <section className="screen verbs-view">
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
      ) : hasNothing ? (
        <div className="empty-state">
          <Repeat size={40} />
          <strong>Глаголов пока нет</strong>
          <p>Сфотографируйте страницу с глаголами — те, что с формами прошедшего времени, появятся здесь автоматически.</p>
          <button type="button" className="primary-btn" style={{ maxWidth: 260, margin: "12px auto 0" }} onClick={() => setPhotoOpen(true)}>
            <Camera size={16} style={{ marginRight: 6 }} />Сфотографировать глаголы
          </button>
        </div>
      ) : (
        <>
          <div className="verbs-toolbar">
            {allVerbs.length > 0 && (
              <button
                type="button"
                className={`all-filter-toggle dict-filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <SlidersHorizontal size={15} /> Тип
                {activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}
                <ChevronDown size={12} />
              </button>
            )}
            <span className="dict-toolbar-count">{verbs.length} {verbNoun(verbs.length)}</span>
            {verbs.length > 0 && (
              <button type="button" className="dict-train-btn verbs-train-all-btn" onClick={() => setQuizVerbs(verbs)}>
                <Dumbbell size={14} /> Тренировать всё
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => setPhotoOpen(true)} aria-label="Сфотографировать страницу">
              <Camera size={18} />
            </button>
          </div>

          {filtersOpen && allVerbs.length > 0 && (
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

          {allVerbs.length > 0 && (
            <div className="verbs-groups">
              {groups.map((group) => {
                const open = openGroups.has(group.key);
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
          )}

          {missingForms.length > 0 && (
            <section className="verb-missing">
              <div className="verb-missing-head">
                <strong>Без форм — {missingForms.length}</strong>
                <button
                  type="button"
                  className="dict-train-btn verb-missing-fill-all"
                  onClick={() => void fillAllMissing()}
                  disabled={bulkProgress !== null}
                >
                  {bulkProgress
                    ? `Заполняю ${bulkProgress.done} из ${bulkProgress.total}…`
                    : <><Wand2 size={14} /> Дозаполнить все</>}
                </button>
              </div>
              <p className="verb-missing-hint">
                Эти глаголы уже в Словаре, но без Präteritum/Partizip II — ИИ может определить их сам.
              </p>
              <div className="verb-missing-list">
                {missingForms.map((entry) => (
                  <div key={entry.id} className="verb-missing-row">
                    <span className="verb-missing-word">
                      {entry.headword}
                      {entry.translation && <em> — {entry.translation}</em>}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Заполнить формы для ${entry.headword}`}
                      onClick={() => void fillOne(entry)}
                      disabled={fillingIds.has(entry.id)}
                    >
                      {fillingIds.has(entry.id) ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
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

      {photoOpen && (
        <PhotoLessonModal
          targetLanguage={profile.targetLanguage}
          nativeLanguage={profile.nativeLanguage}
          mode="dictionary"
          authHeaders={sbAuthHeaders}
          onClose={() => setPhotoOpen(false)}
          onCreated={() => {}}
          onWordsAdded={({ added, updated, warning }) => {
            setPhotoOpen(false);
            void loadDictionary();
            setToast(warning ? warning : updated > 0 ? `Добавлено слов: ${added}, обновлено: ${updated}` : `Добавлено слов: ${added}`);
          }}
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
