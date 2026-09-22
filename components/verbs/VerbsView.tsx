"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, Dumbbell, Eye, EyeOff, ListChecks, Loader2, Repeat, RotateCcw, Search, SlidersHorizontal, Wand2, X } from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { GrammarModal } from "@/components/word-modal/GrammarModal";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { VerbsQuiz } from "@/components/verbs/VerbsQuiz";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { classifyGermanVerb, GERMAN_VERB_CLASS_HINT, GERMAN_VERB_CLASS_LABEL, normalizePos, toggleGermanVerbClassSelection, type GermanVerbClass } from "@/lib/verbForms";
import { appendSearchTerm, matchesSearchTerms, parseSearchTerms } from "@/lib/search/multiTerm";
import { SearchVoiceButton } from "@/components/ui/SearchVoiceButton";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";
import { getAiHeaders } from "@/lib/ai/analyze";
import { getLocalConjugationTenses, getLocalTrainingFilter, getLocalVerbsDict, getLocalVerbsHideForms, getLocalVerbsOpenGroups, getLocalVerbsQuizModes, saveLocalConjugationTenses, saveLocalTrainingFilter, saveLocalVerbsDict, saveLocalVerbsHideForms, saveLocalVerbsOpenGroups, saveLocalVerbsQuizModes } from "@/lib/db/local";
import { CONJUGATION_TENSE_LABEL, CONJUGATION_TENSE_ORDER, QUIZ_MODE_HINT, QUIZ_MODE_LABEL, QUIZ_MODE_ORDER, type ConjugationTense, type QuizMode } from "@/lib/verbsQuizModes";
import { usePackProgress } from "@/lib/srs/usePackProgress";
import { formatTrainedAt, isCompletedToday, packCoverage, type TrainingFilter } from "@/lib/srs/packProgress";
import { isDifficultWord, isUnfamiliarWord, matchesTrainingFilter, trainingErrors } from "@/lib/srs/adaptiveDifficulty";
import { PackBar } from "@/components/ui/PackBar";
import type { UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  onBack: () => void;
};

const VERB_TYPE_ORDER: GermanVerbClass[] = ["weak", "strong", "mixed", "special", "impersonal"];

type VerbGroup = {
  key: string;
  title: string;
  createdAt: number;
  verbs: DictionaryEntry[];
};

type FillResult = { ok: true } | { ok: false; error: string };

/**
 * Every verb already in the learner's dictionary, laid out the way their
 * teacher's notebook is: Infinitiv · Präteritum · Partizip II, one pack at a
 * time. Reads the same `dictionary_entries` every other screen does, can
 * photograph a new page itself, and can ask the AI to backfill principal
 * parts for a "глагол" entry that was saved without them.
 */
export function VerbsView({ profile, onBack }: Props) {
  const { user } = useAuth();
  // Supabase hands back a brand-new `user` object on every auth event,
  // including the token refresh it fires when the tab regains focus — same
  // account, new JS reference. Depending on that object (instead of the id
  // that actually identifies it) recreated loadDictionary, and with it the
  // effect that calls it, on every single tab switch: a real network refetch
  // each time, not just on a genuine reload.
  const userId = user?.id ?? null;
  // Read once at mount so the screen shows the learner's own verbs straight
  // away — including on a hard refresh — instead of a blank spinner every
  // single time the network round trip that already ran once repeats itself.
  const cachedDict = useState(() => getLocalVerbsDict(profile.targetLanguage))[0];
  const [entries, setEntries] = useState<DictionaryEntry[]>(cachedDict?.entries ?? []);
  const [batches, setBatches] = useState<DictionaryBatch[]>(cachedDict?.batches ?? []);
  const [isLoading, setIsLoading] = useState(cachedDict === null);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(!!cachedDict && (cachedDict.entries.length > 0 || cachedDict.batches.length > 0));

  // Empty means «Все». Compatible learning groups can be selected together;
  // weak and strong are switched as one base-conjugation choice.
  const [verbTypes, setVerbTypes] = useState<Set<GermanVerbClass>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Which drills a training session runs — persisted, defaulting to just the
  // original forms drill so nobody who never opens this gets a bigger session.
  const [quizModes, setQuizModes] = useState<Set<QuizMode>>(() => getLocalVerbsQuizModes());
  const [modesOpen, setModesOpen] = useState(false);
  const [trainingFilter, setTrainingFilter] = useState<TrainingFilter>(() => getLocalTrainingFilter("verbs"));
  // Which tense(s) the conjugation drill covers — only meaningful once
  // "Спряжения" is one of the active modes above.
  const [conjugationTenses, setConjugationTenses] = useState<Set<ConjugationTense>>(() => getLocalConjugationTenses());
  // Covers the Präteritum/Partizip II columns so the table becomes a self-test
  // on the spot — the infinitive and its translation stay visible to ask from.
  const [hideForms, setHideForms] = useState(() => getLocalVerbsHideForms());
  // Which packs are expanded — persisted so the learner's choice survives a
  // reload, and empty by default so every pack starts closed.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => getLocalVerbsOpenGroups());

  const [conjugateEntry, setConjugateEntry] = useState<DictionaryEntry | null>(null);
  const [quizVerbs, setQuizVerbs] = useState<DictionaryEntry[] | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [fillingIds, setFillingIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // How far each pack has been worked through — the same bookkeeping the noun
  // trainer keeps, under its own module key.
  const { progress, startSession, record, completeWord, reset, resetAll } = usePackProgress("verbs");

  const loadDictionary = useCallback(async () => {
    if (!userId) { setEntries([]); setBatches([]); setIsLoading(false); return; }
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
  }, [userId, profile.targetLanguage]);

  useEffect(() => { void loadDictionary(); }, [loadDictionary]);

  // The connected tutor may add a pack while this tab is open. Refresh when
  // the learner returns to the app so the verb practice remains a live view of
  // the same dictionary rather than a snapshot from the first render.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadDictionary();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadDictionary]);

  useEffect(() => {
    hasDataRef.current = entries.length > 0 || batches.length > 0;
  }, [entries, batches]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Opening a verb from the results must not throw the search away —
      // only an empty box is allowed to close on its own.
      if (!target.closest(".dict-search-float, .dict-search-toggle") && !query.trim()) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [query]);

  // Every "глагол" entry in the dictionary, whether or not it has forms yet —
  // used to split into the real table below and the "Без форм" backlog.
  const allGlagolEntries = useMemo(
    () => entries.filter((e) => (e.content_type ?? "word") === "word" && normalizePos(e.part_of_speech).includes("глагол")),
    [entries],
  );

  // The teacher's table is only for verbs with a complete principal-parts
  // record. A partial AI response must stay visible in the repair backlog,
  // instead of looking like a valid training card.
  const allVerbs = useMemo(
    () => allGlagolEntries.filter((e) => isCompleteGermanVerbForms(e.forms)),
    [allGlagolEntries],
  );

  // Saved as verbs, but with a partial or missing principal-parts record —
  // typed in by hand, added by an assistant, or read from a photo the model
  // missed. Shown separately with a way to ask the AI to fill every required
  // field in one validated response.
  const missingForms = useMemo(
    () => allGlagolEntries.filter((e) => !isCompleteGermanVerbForms(e.forms)),
    [allGlagolEntries],
  );

  const verbs = useMemo(() => {
    // Comma-separated terms match independently (OR) — "regn, sala" finds
    // every verb starting with either fragment, from just a couple of letters.
    const terms = parseSearchTerms(query);
    return allVerbs.filter((e) => {
      if (verbTypes.size > 0 && !verbTypes.has(classifyGermanVerb(e.lemma, e.headword, e.forms))) return false;
      return matchesSearchTerms([e.headword, e.lemma, e.translation], terms);
    });
  }, [allVerbs, verbTypes, query]);

  const trainingVerbs = useMemo(
    () => verbs.filter((entry) => !isCompletedToday(progress.words[entry.id]) && matchesTrainingFilter(progress.words[entry.id], trainingFilter)),
    [verbs, progress.words, trainingFilter],
  );
  const unfamiliarCount = useMemo(
    () => allVerbs.filter((entry) => !isCompletedToday(progress.words[entry.id]) && isUnfamiliarWord(progress.words[entry.id])).length,
    [allVerbs, progress.words],
  );
  const difficultCount = useMemo(
    () => allVerbs.filter((entry) => !isCompletedToday(progress.words[entry.id]) && isDifficultWord(progress.words[entry.id])).length,
    [allVerbs, progress.words],
  );

  // A search or type filter narrows the table — the matching packs should be
  // visible right away, not stuck behind the "closed by default" rule that
  // exists for browsing, not for looking something specific up.
  const isNarrowed = query.trim().length > 0 || verbTypes.size > 0;

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

  function toggleMode(mode: QuizMode) {
    setQuizModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      // Never let the session end up with nothing to ask — fall back to the
      // original drill rather than an empty quiz.
      const safe = next.size ? next : new Set<QuizMode>(["forms"]);
      saveLocalVerbsQuizModes(safe);
      return safe;
    });
  }

  function toggleVerbType(type: GermanVerbClass) {
    setVerbTypes((prev) => toggleGermanVerbClassSelection(prev, type));
  }

  function chooseTrainingFilter(filter: TrainingFilter) {
    setTrainingFilter(filter);
    saveLocalTrainingFilter("verbs", filter);
  }

  function toggleConjugationTense(tense: ConjugationTense) {
    setConjugationTenses((prev) => {
      const next = new Set(prev);
      if (next.has(tense)) next.delete(tense);
      else next.add(tense);
      // At least one tense, same reasoning as the modes themselves.
      const safe = next.size ? next : new Set<ConjugationTense>(["present"]);
      saveLocalConjugationTenses(safe);
      return safe;
    });
  }

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveLocalVerbsOpenGroups(next);
      return next;
    });

  // On this screen every row is a verb and the reason to tap one is always the
  // conjugation, so the table opens it directly instead of going through the
  // generic word modal first.
  function openEntry(entry: DictionaryEntry) {
    setConjugateEntry(entry);
  }

  /** Asks the AI for one verb's principal parts and saves them, merged into whatever `forms` it already has. */
  async function fillEntryForms(entry: DictionaryEntry): Promise<FillResult> {
    try {
      const res = await freshFetch("/api/ai/verb-forms", {
        method: "POST",
        headers: await getAiHeaders(),
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
      if (!isCompleteGermanVerbForms(forms)) {
        throw new Error(`ИИ вернул неполные формы «${entry.headword}». Нужны Präteritum, Partizip II, вспомогательный глагол и признак отделяемости.`);
      }

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

  const activeFilterCount = verbTypes.size;

  /** Starts a session on one pack — stamps it, then hands the words to the quiz. */
  function trainPack(packKey: string, packVerbs: DictionaryEntry[]) {
    if (packVerbs.length === 0) return;
    startSession(packKey);
    setQuizVerbs(packVerbs);
  }

  function resetAllTrainingProgress() {
    if (typeof window !== "undefined" && !window.confirm("Сбросить прогресс всех пачек глаголов?")) return;
    resetAll();
    setToast("Прогресс всех пачек сброшен");
  }

  if (quizVerbs) {
    return (
      <VerbsQuiz
        verbs={quizVerbs}
        targetLanguage={profile.targetLanguage}
        nativeLanguage={profile.nativeLanguage}
        modes={quizModes}
        conjugationTenses={conjugationTenses}
        onExit={onBack}
        onRecord={record}
        onComplete={completeWord}
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
          {allVerbs.length > 0 && (
            <div className="dict-toolbar-row">
              <span className="dict-toolbar-count">{verbs.length} {verbNoun(verbs.length)}</span>
              <button
                type="button"
                className={`icon-btn dict-search-toggle${searchOpen || query ? " active" : ""}`}
                aria-label={searchOpen ? "Закрыть поиск" : "Поиск по глаголам"}
                onClick={(e) => {
                  e.stopPropagation();
                  // The first tap while there is text just clears it; the
                  // next one (now empty) actually closes the search box.
                  if (searchOpen && query.trim()) { setQuery(""); return; }
                  if (searchOpen) { setSearchOpen(false); return; }
                  setQuery("");
                  setSearchOpen(true);
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
                    placeholder="Инфинитив или перевод, через запятую"
                    aria-label="Поиск по глаголам"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="search"
                  />
                  <SearchVoiceButton
                    languages={[profile.nativeLanguage, profile.targetLanguage]}
                    onResult={(text) => setQuery((prev) => appendSearchTerm(prev, text))}
                  />
                  {query.length > 0 && (
                    <button type="button" className="dict-search-clear-btn" aria-label="Очистить поле поиска" onClick={() => setQuery("")}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

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
            {allVerbs.length > 0 && (
              <button
                type="button"
                className={`all-filter-toggle dict-filter-toggle ${modesOpen || trainingFilter !== "all" ? "active" : ""}`}
                onClick={() => setModesOpen((v) => !v)}
              >
                <ListChecks size={15} /> Режимы
                <span className="all-filter-count">{quizModes.size + (trainingFilter !== "all" ? 1 : 0)}</span>
                <ChevronDown size={12} />
              </button>
            )}
            {verbs.length > 0 && (
              <button type="button" className="dict-train-btn verbs-train-all-btn" disabled={trainingVerbs.length === 0} onClick={() => trainPack("__all__", trainingVerbs)} title={trainingVerbs.length === 0 ? "Для этого фильтра пока нет слов" : undefined}>
                <Dumbbell size={14} /> {trainingFilter === "all" ? "Тренировать всё" : `Тренировать ${trainingFilter === "difficult" ? "сложные" : "незнакомые"}`}
              </button>
            )}
            {Object.keys(progress.words).length > 0 && (
              <button type="button" className="icon-btn training-reset-all-btn" onClick={resetAllTrainingProgress} aria-label="Сбросить прогресс всех пачек" title="Сбросить прогресс всех пачек">
                <RotateCcw size={15} />
              </button>
            )}
          </div>

          {filtersOpen && allVerbs.length > 0 && (
            <div className="all-filter-panel">
              <div className="filter-group">
                <div className="filter-group-label">Тип спряжения</div>
                <div className="filter-chips">
                  <button type="button" className={`filter-chip ${verbTypes.size === 0 ? "active" : ""}`} onClick={() => setVerbTypes(new Set())} aria-pressed={verbTypes.size === 0}>Все</button>
                  {VERB_TYPE_ORDER.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`filter-chip verb-type-chip verb-type-${type} ${verbTypes.has(type) ? "active" : ""}`}
                      onClick={() => toggleVerbType(type)}
                      title={GERMAN_VERB_CLASS_HINT[type]}
                      aria-pressed={verbTypes.has(type)}
                    >
                      {GERMAN_VERB_CLASS_LABEL[type]}
                    </button>
                  ))}
                </div>
                <p className="verb-modes-hint">Можно выбрать несколько типов: «сильный», «смешанный», «особый» и «безличный» объединяются. «Слабый» и «сильный» — взаимоисключающие базовые группы.</p>
              </div>
            </div>
          )}

          {modesOpen && allVerbs.length > 0 && (
            <div className="all-filter-panel">
              <div className="filter-group">
                <div className="filter-group-label">Фильтр слов для тренировки</div>
                <div className="filter-chips">
                  <button type="button" className={`filter-chip ${trainingFilter === "all" ? "active" : ""}`} onClick={() => chooseTrainingFilter("all")}>Все</button>
                  <button type="button" className={`filter-chip ${trainingFilter === "unfamiliar" ? "active" : ""}`} onClick={() => chooseTrainingFilter("unfamiliar")}>Незнакомые ({unfamiliarCount})</button>
                  <button type="button" className={`filter-chip ${trainingFilter === "difficult" ? "active" : ""}`} onClick={() => chooseTrainingFilter("difficult")}>Сложные ({difficultCount})</button>
                </div>
                <p className="verb-modes-hint">«Незнакомые» — последняя попытка с ошибкой. «Сложные» — слова с повторными ошибками, рассчитанные по вашей локальной истории. Слово, полностью пройденное сегодня, до завтра больше не показывается.</p>
              </div>
              <div className="filter-group">
                <div className="filter-group-label">Что тренировать</div>
                <div className="filter-chips">
                  {QUIZ_MODE_ORDER.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`filter-chip ${quizModes.has(mode) ? "active" : ""}`}
                      onClick={() => toggleMode(mode)}
                      title={QUIZ_MODE_HINT[mode]}
                    >
                      {QUIZ_MODE_LABEL[mode]}
                    </button>
                  ))}
                </div>
                <p className="verb-modes-hint">
                  Несколько режимов — по каждому слову подряд: {QUIZ_MODE_ORDER.map((m) => QUIZ_MODE_LABEL[m]).join(" → ")}.
                </p>
              </div>

              {quizModes.has("conjugation") && (
                <div className="filter-group">
                  <div className="filter-group-label">Времена для спряжений</div>
                  <div className="filter-chips">
                    {CONJUGATION_TENSE_ORDER.map((tense) => (
                      <button
                        key={tense}
                        type="button"
                        className={`filter-chip ${conjugationTenses.has(tense) ? "active" : ""}`}
                        onClick={() => toggleConjugationTense(tense)}
                      >
                        {CONJUGATION_TENSE_LABEL[tense]}
                      </button>
                    ))}
                  </div>
                  <p className="verb-modes-hint">
                    Местоимение уже в подписи поля — писать его снова не нужно. «Прошедшее (книжное)» — Präteritum одним словом («sang»); «Прошедшее (разговорное)» и «Будущее» — со вспомогательным глаголом («habe gesungen», «werde singen»), это и проверяется. Каждое время — отдельным шагом.
                  </p>
                </div>
              )}
            </div>
          )}

          {allVerbs.length > 0 && groups.length === 0 && <p className="dict-nothing">Ничего не нашлось.</p>}

          {allVerbs.length > 0 && (
            <div className="verbs-groups">
              {groups.map((group) => {
                const open = isNarrowed || openGroups.has(group.key);
                const nonStandardCount = group.verbs.filter((v) => classifyGermanVerb(v.lemma, v.headword, v.forms) !== "weak").length;
                const coverage = packCoverage(progress, group.key, group.verbs.map((v) => v.id));
                const trainedAt = formatTrainedAt(coverage.lastTrainedAt);
                const unfamiliar = group.verbs.filter((entry) => isUnfamiliarWord(progress.words[entry.id]));
                const trainable = group.verbs.filter((entry) => !isCompletedToday(progress.words[entry.id]) && matchesTrainingFilter(progress.words[entry.id], trainingFilter));
                const sessionVerbs = trainable;
                return (
                  <section key={group.key} className="dict-batch">
                    <button type="button" className="dict-batch-head" onClick={() => toggleGroup(group.key)}>
                      <div className="dict-batch-title-wrap">
                        <strong className="dict-batch-title">{group.title}</strong>
                        <span className="dict-batch-meta">
                          {group.verbs.length} {verbNoun(group.verbs.length)}
                          {nonStandardCount > 0 && ` · ${nonStandardCount} нестандартных`}
                          {trainedAt ? ` · тренировка ${trainedAt}` : " · ещё не тренировали"}
                        </span>
                      </div>
                      <span className={`dict-batch-pct${coverage.percent >= 100 ? " done" : ""}`}>{coverage.percent}%</span>
                      <ChevronDown size={17} className={`dict-batch-chevron${open ? " open" : ""}`} />
                    </button>

                    <PackBar coverage={coverage} />

                    <div className="dict-batch-actions">
                      <button type="button" className="dict-train-btn" disabled={sessionVerbs.length === 0} onClick={() => trainPack(group.key, sessionVerbs)} title={sessionVerbs.length === 0 ? "Все слова этой пачки уже пройдены сегодня" : undefined}>
                        <Dumbbell size={14} />
                        {sessionVerbs.length === 0 && trainingFilter === "all" ? "Сегодня всё пройдено" : trainingFilter !== "all" ? `${trainingFilter === "difficult" ? "Сложные" : "Незнакомые"} (${trainable.length})` : coverage.percent === 0 ? "Тренировать эту пачку" : coverage.percent >= 100 ? "Повторить пачку" : "Продолжить пачку"}
                      </button>
                      {unfamiliar.length > 0 && (
                        <button
                          type="button"
                          className="dict-train-btn"
                          onClick={() => trainPack(group.key, unfamiliar)}
                        >
                          Незнакомые ({unfamiliar.length})
                        </button>
                      )}
                      {coverage.learned + coverage.seen > 0 && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Сбросить прогресс пачки"
                          title="Сбросить прогресс этой пачки"
                          onClick={() => reset(group.verbs.map((v) => v.id), group.key)}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>

                    {open && (
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
                                const verbClass = classifyGermanVerb(entry.lemma, entry.headword, entry.forms);
                                const state = progress.words[entry.id];
                                const difficult = isDifficultWord(state);
                                const errors = trainingErrors(state);
                                return (
                                  <tr
                                    key={entry.id}
                                    className={`verb-row verb-row-${verbClass}${difficult ? " verb-row-difficult" : ""}`}
                                    title={GERMAN_VERB_CLASS_HINT[verbClass]}
                                    onClick={() => openEntry(entry)}
                                  >
                                    <td className="verb-cell-infinitive">
                                      <span className="verb-form-row">
                                      <span className="verb-infinitive">
                                        {entry.headword}
                                        <span className={`verb-type-badge verb-type-${verbClass}`} title={GERMAN_VERB_CLASS_HINT[verbClass]}>{GERMAN_VERB_CLASS_LABEL[verbClass]}</span>
                                        {difficult && <span className="training-difficulty-badge" title={`Ошибок: ${errors}`}>сложно</span>}
                                      </span>
                                        <SpeakButton text={entry.headword} lang={profile.targetLanguage} size={13} />
                                      </span>
                                      {entry.translation && (
                                        <span className={`verb-translation${hideForms ? " verb-translation-hidden" : ""}`}>
                                          {entry.translation}
                                        </span>
                                      )}
                                    </td>
                                    <td className={hideForms ? "verb-cell-hidden" : undefined}>
                                      {entry.forms?.praeteritum ? (
                                        <>
                                          <span className="verb-form-row">
                                            <span>{entry.forms.praeteritum}</span>
                                            <SpeakButton text={praeteritumFirstPerson(entry)} lang={profile.targetLanguage} size={13} />
                                          </span>
                                          <span className="verb-form-example">{praeteritumFirstPerson(entry)}</span>
                                        </>
                                      ) : "—"}
                                    </td>
                                    <td className={hideForms ? "verb-cell-hidden" : undefined}>
                                      {entry.forms?.partizip2 ? (
                                        <>
                                          <span className="verb-form-row">
                                            <span>{partizipCell(entry)}</span>
                                            <SpeakButton text={partizipFirstPerson(entry)} lang={profile.targetLanguage} size={13} />
                                          </span>
                                          <span className="verb-form-example">{partizipFirstPerson(entry)}</span>
                                        </>
                                      ) : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
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

      {/* Float above the bottom bar rather than sitting in the toolbar: both are
          reached with the thumb, and the eye is wanted mid-scroll — while
          looking at a row — not back at the top of the page. */}
      {!hasNothing && !isLoading && !error && (
        <div className="verbs-fabs">
          <button
            type="button"
            className={`verbs-fab${hideForms ? " active" : ""}`}
            onClick={() => setHideForms((v) => { saveLocalVerbsHideForms(!v); return !v; })}
            aria-pressed={hideForms}
            aria-label={hideForms ? "Показать формы" : "Скрыть формы для самопроверки"}
            title={hideForms ? "Показать формы" : "Скрыть формы для самопроверки"}
          >
            {hideForms ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
          <button
            type="button"
            className="verbs-fab"
            onClick={() => setPhotoOpen(true)}
            aria-label="Сфотографировать страницу"
            title="Сфотографировать страницу"
          >
            <Camera size={19} />
          </button>
        </div>
      )}

      {conjugateEntry && (
        <GrammarModal
          word={conjugateEntry.headword}
          lemma={conjugateEntry.lemma}
          posTag="verb"
          defaultLang={profile.targetLanguage}
          nativeLang={profile.nativeLanguage}
          onClose={() => setConjugateEntry(null)}
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

// Präteritum's 1st and 3rd person singular are always identical in German
// ("ich redete" / "er redete"), so the stored form only needs the pronoun.
function praeteritumFirstPerson(entry: DictionaryEntry): string {
  const pr = (entry.forms?.praeteritum || "").trim();
  return pr ? `ich ${pr}` : "";
}

/** «ich bin geschwommen» / «ich habe gemacht» — a model sentence, not just the bare participle. */
function partizipFirstPerson(entry: DictionaryEntry): string {
  const p2 = (entry.forms?.partizip2 || "").trim();
  if (!p2) return "";
  const aux = (entry.forms?.hilfsverb || "").trim().toLowerCase();
  return aux === "sein" ? `ich bin ${p2}` : `ich habe ${p2}`;
}

function isCompleteGermanVerbForms(forms: Record<string, string> | null | undefined): boolean {
  return Boolean(
    forms?.praeteritum?.trim()
    && forms?.partizip2?.trim()
    && /^(haben|sein)$/iu.test(forms.hilfsverb?.trim() ?? "")
    && /^(да|нет)$/iu.test(forms.trennbar?.trim() ?? ""),
  );
}

function verbNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "глаголов";
  if (mod10 === 1) return "глагол";
  if (mod10 >= 2 && mod10 <= 4) return "глагола";
  return "глаголов";
}
