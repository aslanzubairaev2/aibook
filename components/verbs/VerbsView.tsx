"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, Dumbbell, Eye, EyeOff, ListChecks, Loader2, Repeat, Search, SlidersHorizontal, Wand2, X } from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { GrammarModal } from "@/components/word-modal/GrammarModal";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { VerbsQuiz } from "@/components/verbs/VerbsQuiz";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { isIrregularGermanVerb, normalizePos } from "@/lib/verbForms";
import { appendSearchTerm, matchesSearchTerms, parseSearchTerms } from "@/lib/search/multiTerm";
import { SearchVoiceButton } from "@/components/ui/SearchVoiceButton";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";
import { getLocalConjugationTenses, getLocalVerbsDict, getLocalVerbsHideForms, getLocalVerbsOpenGroups, getLocalVerbsQuizModes, saveLocalConjugationTenses, saveLocalVerbsDict, saveLocalVerbsHideForms, saveLocalVerbsOpenGroups, saveLocalVerbsQuizModes } from "@/lib/db/local";
import { CONJUGATION_TENSE_LABEL, CONJUGATION_TENSE_ORDER, QUIZ_MODE_HINT, QUIZ_MODE_LABEL, QUIZ_MODE_ORDER, type ConjugationTense, type QuizMode } from "@/lib/verbsQuizModes";
import type { UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
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

  const [verbType, setVerbType] = useState<VerbType>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Which drills a training session runs — persisted, defaulting to just the
  // original forms drill so nobody who never opens this gets a bigger session.
  const [quizModes, setQuizModes] = useState<Set<QuizMode>>(() => getLocalVerbsQuizModes());
  const [modesOpen, setModesOpen] = useState(false);
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
    // Comma-separated terms match independently (OR) — "regn, sala" finds
    // every verb starting with either fragment, from just a couple of letters.
    const terms = parseSearchTerms(query);
    return allVerbs.filter((e) => {
      if (verbType !== "all") {
        const irregular = isIrregularGermanVerb(e.lemma, e.headword, e.forms);
        if (verbType === "irregular" ? !irregular : irregular) return false;
      }
      return matchesSearchTerms([e.headword, e.lemma, e.translation], terms);
    });
  }, [allVerbs, verbType, query]);

  // A search or type filter narrows the table — the matching packs should be
  // visible right away, not stuck behind the "closed by default" rule that
  // exists for browsing, not for looking something specific up.
  const isNarrowed = query.trim().length > 0 || verbType !== "all";

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
        nativeLanguage={profile.nativeLanguage}
        modes={quizModes}
        conjugationTenses={conjugationTenses}
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
                className={`all-filter-toggle dict-filter-toggle ${modesOpen ? "active" : ""}`}
                onClick={() => setModesOpen((v) => !v)}
              >
                <ListChecks size={15} /> Режимы
                <span className="all-filter-count">{quizModes.size}</span>
                <ChevronDown size={12} />
              </button>
            )}
            {verbs.length > 0 && (
              <button type="button" className="dict-train-btn verbs-train-all-btn" onClick={() => setQuizVerbs(verbs)}>
                <Dumbbell size={14} /> Тренировать всё
              </button>
            )}
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

          {modesOpen && allVerbs.length > 0 && (
            <div className="all-filter-panel">
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
                const irregularCount = group.verbs.filter((v) => isIrregularGermanVerb(v.lemma, v.headword, v.forms)).length;
                return (
                  <section key={group.key} className="dict-batch">
                    <button type="button" className="dict-batch-head" onClick={() => toggleGroup(group.key)}>
                      <div className="dict-batch-title-wrap">
                        <strong className="dict-batch-title">{group.title}</strong>
                        <span className="dict-batch-meta">
                          {group.verbs.length} {verbNoun(group.verbs.length)}
                          {irregularCount > 0 && ` · ${irregularCount} неправильных`}
                        </span>
                      </div>
                      <ChevronDown size={17} className={`dict-batch-chevron${open ? " open" : ""}`} />
                    </button>

                    <div className="dict-batch-actions">
                      <button type="button" className="dict-train-btn" onClick={() => setQuizVerbs(group.verbs)}>
                        <Dumbbell size={14} /> Тренировать эту пачку
                      </button>
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
                                const irregular = isIrregularGermanVerb(entry.lemma, entry.headword, entry.forms);
                                return (
                                  <tr
                                    key={entry.id}
                                    className={`verb-row ${irregular ? "verb-row-irregular" : "verb-row-regular"}`}
                                    onClick={() => openEntry(entry)}
                                  >
                                    <td className="verb-cell-infinitive">
                                      <span className="verb-form-row">
                                        <span className="verb-infinitive">{entry.headword}</span>
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

function verbNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "глаголов";
  if (mod10 === 1) return "глагол";
  if (mod10 >= 2 && mod10 <= 4) return "глагола";
  return "глаголов";
}
