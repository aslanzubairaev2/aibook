"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookA, Camera, ChevronDown, Dumbbell, Eye, EyeOff, GraduationCap, ListChecks, Loader2, RotateCcw, Search, SlidersHorizontal, Wand2, X } from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { GrammarModal } from "@/components/word-modal/GrammarModal";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { NounsQuiz } from "@/components/nouns/NounsQuiz";
import { GenderRulesSheet } from "@/components/nouns/GenderRulesSheet";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { bareNoun, GENDER_CHIP, GENDER_ORDER, isNounEntry, nounArticle, nounGender, nounWordForm, type NounGender } from "@/lib/nounForms";
import { appendSearchTerm, matchesSearchTerms, parseSearchTerms } from "@/lib/search/multiTerm";
import { SearchVoiceButton } from "@/components/ui/SearchVoiceButton";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";
import {
  getLocalNounsDict, getLocalNounsHideArticles, getLocalNounsHideForms, getLocalNounsOpenGroups, getLocalNounsQuizModes,
  saveLocalNounsDict, saveLocalNounsHideArticles, saveLocalNounsHideForms, saveLocalNounsOpenGroups, saveLocalNounsQuizModes,
} from "@/lib/db/local";
import { NOUN_QUIZ_MODE_HINT, NOUN_QUIZ_MODE_LABEL, NOUN_QUIZ_MODE_ORDER, type NounQuizMode } from "@/lib/nounsQuizModes";
import { usePackProgress } from "@/lib/srs/usePackProgress";
import { formatTrainedAt, packCoverage } from "@/lib/srs/packProgress";
import { PackBar } from "@/components/ui/PackBar";
import type { UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  onBack: () => void;
};

type GenderFilter = "all" | NounGender;

type NounGroup = {
  key: string;
  title: string;
  createdAt: number;
  nouns: DictionaryEntry[];
};

type FillResult = { ok: true } | { ok: false; error: string };

/**
 * Every noun already in the learner's dictionary, laid out the way the gender
 * actually has to be learned: der/die/das up front and colour-coded, singular
 * next to plural, one pack at a time. Reads the same `dictionary_entries` the
 * verb table and the dictionary itself read, so a word photographed today is
 * here without any extra step; can photograph a page itself; and can ask the
 * AI to backfill the article of a noun that was saved without one.
 */
export function NounsView({ profile, onBack }: Props) {
  const { user } = useAuth();
  // Same reasoning as the verb screen: depending on the `user` object rather
  // than its id would refetch on every tab focus, since Supabase hands back a
  // brand-new object on each token refresh.
  const userId = user?.id ?? null;
  // Read the cache at mount so the table is on screen immediately, including
  // after a hard refresh, instead of a spinner while a round trip that already
  // ran once repeats itself.
  const cachedDict = useState(() => getLocalNounsDict(profile.targetLanguage))[0];
  const [entries, setEntries] = useState<DictionaryEntry[]>(cachedDict?.entries ?? []);
  const [batches, setBatches] = useState<DictionaryBatch[]>(cachedDict?.batches ?? []);
  const [isLoading, setIsLoading] = useState(cachedDict === null);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(!!cachedDict && (cachedDict.entries.length > 0 || cachedDict.batches.length > 0));

  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [quizModes, setQuizModes] = useState<Set<NounQuizMode>>(() => getLocalNounsQuizModes());
  const [modesOpen, setModesOpen] = useState(false);
  // Covers the translation and the plural so the table becomes a self-test —
  // the singular with its article stays visible to ask from.
  const [hideForms, setHideForms] = useState(() => getLocalNounsHideForms());
  // The harder self-test: the articles go too, and only the bare noun is left.
  const [hideArticles, setHideArticles] = useState(() => getLocalNounsHideArticles());
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => getLocalNounsOpenGroups());

  const [grammarEntry, setGrammarEntry] = useState<DictionaryEntry | null>(null);
  const [quizNouns, setQuizNouns] = useState<DictionaryEntry[] | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [fillingIds, setFillingIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const { progress, startSession, record, reset } = usePackProgress("nouns");

  const loadDictionary = useCallback(async () => {
    if (!userId) { setEntries([]); setBatches([]); setIsLoading(false); return; }
    if (!hasDataRef.current) setIsLoading(true);
    setError(null);
    try {
      const res = await freshFetch(`/api/dictionary?language=${encodeURIComponent(profile.targetLanguage)}`, {
        headers: await sbAuthHeaders(),
      });
      const data = await res.json() as { entries?: DictionaryEntry[]; batches?: DictionaryBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить существительные.");
      const nextEntries = data.entries ?? [];
      const nextBatches = data.batches ?? [];
      setEntries(nextEntries);
      setBatches(nextBatches);
      saveLocalNounsDict(profile.targetLanguage, nextEntries, nextBatches);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить существительные.";
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
      if (!target.closest(".dict-search-float, .dict-search-toggle") && !query.trim()) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [query]);

  // Every noun in the dictionary, with or without a gender yet — split below
  // into the real table and the «Без артикля» backlog.
  const allNounEntries = useMemo(
    () => entries.filter((e) => isNounEntry(e)),
    [entries],
  );

  // The table is about nouns whose article is known: a noun with no gender and
  // no article has nothing to show in the column the screen exists for.
  const allNouns = useMemo(
    () => allNounEntries.filter((e) => nounGender(e) !== null),
    [allNounEntries],
  );

  const missingArticles = useMemo(
    () => allNounEntries.filter((e) => nounGender(e) === null),
    [allNounEntries],
  );

  const nouns = useMemo(() => {
    const terms = parseSearchTerms(query);
    return allNouns.filter((e) => {
      if (genderFilter !== "all" && nounGender(e) !== genderFilter) return false;
      return matchesSearchTerms([e.headword, e.lemma, e.translation, e.plural], terms);
    });
  }, [allNouns, genderFilter, query]);

  // A search or a gender filter narrows the table — matching packs should be
  // open right away, not stuck behind the «closed by default» browsing rule.
  const isNarrowed = query.trim().length > 0 || genderFilter !== "all";

  const groups = useMemo<NounGroup[]>(() => {
    const byBatch = new Map<string, DictionaryEntry[]>();
    const loose: DictionaryEntry[] = [];
    for (const n of nouns) {
      if (n.batch_id) {
        const list = byBatch.get(n.batch_id) ?? [];
        list.push(n);
        byBatch.set(n.batch_id, list);
      } else {
        loose.push(n);
      }
    }

    const result: NounGroup[] = [];
    for (const batch of batches) {
      const batchNouns = byBatch.get(batch.id) ?? [];
      if (batchNouns.length === 0) continue;
      result.push({ key: batch.id, title: batch.title, createdAt: Date.parse(batch.created_at) || 0, nouns: batchNouns });
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    if (loose.length > 0) {
      result.push({ key: "loose", title: "Без пачки", createdAt: 0, nouns: loose });
    }
    return result;
  }, [nouns, batches]);

  function toggleMode(mode: NounQuizMode) {
    setQuizModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      // Never let a session end up with nothing to ask — fall back to the
      // article drill rather than an empty quiz.
      const safe = next.size ? next : new Set<NounQuizMode>(["article"]);
      saveLocalNounsQuizModes(safe);
      return safe;
    });
  }

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveLocalNounsOpenGroups(next);
      return next;
    });

  /** Starts a session on one pack — stamps it, then hands the words to the quiz. */
  function trainPack(packKey: string, packNouns: DictionaryEntry[]) {
    startSession(packKey);
    setQuizNouns(packNouns);
  }

  /** Asks the AI for one noun's gender/article/plural and saves what came back. */
  async function fillEntryNoun(entry: DictionaryEntry): Promise<FillResult> {
    try {
      const res = await freshFetch("/api/ai/noun-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          lemma: entry.lemma,
          headword: entry.headword,
          targetLanguage: profile.targetLanguage,
          nativeLanguage: profile.nativeLanguage,
        }),
      });
      const data = await res.json() as { noun?: { gender?: string; article?: string; plural?: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось получить артикль.");
      const noun = data.noun ?? {};
      if (!noun.gender && !noun.article) throw new Error(`ИИ не смог определить род «${entry.headword}»`);

      const saveRes = await freshFetch("/api/dictionary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({ id: entry.id, noun }),
      });
      const saveData = await saveRes.json() as { ok?: boolean; error?: string };
      if (!saveRes.ok) throw new Error(saveData.error ?? "Не удалось сохранить артикль.");

      setEntries((prev) => prev.map((e) => (e.id === entry.id
        ? {
            ...e,
            gender: noun.gender || e.gender,
            article: noun.article || e.article,
            plural: noun.plural || e.plural,
          }
        : e)));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Не удалось определить артикль." };
    }
  }

  async function fillOne(entry: DictionaryEntry) {
    setFillingIds((prev) => new Set(prev).add(entry.id));
    const result = await fillEntryNoun(entry);
    setFillingIds((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
    setToast(result.ok ? "✓ Артикль определён" : result.error);
  }

  async function fillAllMissing() {
    const targets = missingArticles;
    if (targets.length === 0 || bulkProgress) return;
    setBulkProgress({ done: 0, total: targets.length });
    setFillingIds(new Set(targets.map((e) => e.id)));
    let failures = 0;
    for (const entry of targets) {
      const result = await fillEntryNoun(entry);
      if (!result.ok) failures += 1;
      setFillingIds((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
      setBulkProgress((prev) => (prev ? { done: prev.done + 1, total: prev.total } : prev));
    }
    setBulkProgress(null);
    setToast(
      failures === 0
        ? `✓ Определено артиклей: ${targets.length}`
        : `Определено ${targets.length - failures} из ${targets.length}, ${failures} не удалось`,
    );
  }

  const activeFilterCount = genderFilter !== "all" ? 1 : 0;

  if (quizNouns) {
    return (
      <NounsQuiz
        nouns={quizNouns}
        targetLanguage={profile.targetLanguage}
        nativeLanguage={profile.nativeLanguage}
        modes={quizModes}
        onExit={() => setQuizNouns(null)}
        onRecord={record}
      />
    );
  }

  const hasNothing = !isLoading && !error && allNouns.length === 0 && missingArticles.length === 0;

  return (
    <section className="screen verbs-view nouns-view">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Артикли и существительные</p>
          <h1>der · die · das</h1>
        </div>
        <button
          type="button"
          className="icon-btn nouns-rules-btn"
          onClick={() => setRulesOpen(true)}
          aria-label="Шпаргалка: род по окончанию"
          title="Шпаргалка: род по окончанию"
        >
          <GraduationCap size={19} />
        </button>
      </header>

      {isLoading ? (
        <div className="dict-loading">
          <Loader2 className="spin" size={22} /> Загружаю существительные...
        </div>
      ) : error ? (
        <div className="empty-state">
          <BookA size={40} />
          <strong>Не удалось загрузить</strong>
          <p>{error}</p>
        </div>
      ) : hasNothing ? (
        <div className="empty-state">
          <BookA size={40} />
          <strong>Существительных пока нет</strong>
          <p>Слова из Словаря появляются здесь сами. Или сфотографируйте страницу — существительные с артиклями попадут сюда автоматически.</p>
          <button type="button" className="primary-btn" style={{ maxWidth: 280, margin: "12px auto 0" }} onClick={() => setPhotoOpen(true)}>
            <Camera size={16} style={{ marginRight: 6 }} />Сфотографировать слова
          </button>
        </div>
      ) : (
        <>
          {allNouns.length > 0 && (
            <div className="dict-toolbar-row">
              <span className="dict-toolbar-count">{nouns.length} {nounWordForm(nouns.length)}</span>
              <button
                type="button"
                className={`icon-btn dict-search-toggle${searchOpen || query ? " active" : ""}`}
                aria-label={searchOpen ? "Закрыть поиск" : "Поиск по существительным"}
                onClick={(e) => {
                  e.stopPropagation();
                  // The first tap while there is text just clears it; the next
                  // one (now empty) actually closes the search box.
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
                    placeholder="Слово или перевод, через запятую"
                    aria-label="Поиск по существительным"
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
            {allNouns.length > 0 && (
              <button
                type="button"
                className={`all-filter-toggle dict-filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <SlidersHorizontal size={15} /> Род
                {activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}
                <ChevronDown size={12} />
              </button>
            )}
            {allNouns.length > 0 && (
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
            {nouns.length > 0 && (
              <button type="button" className="dict-train-btn verbs-train-all-btn" onClick={() => trainPack("__all__", nouns)}>
                <Dumbbell size={14} /> Тренировать всё
              </button>
            )}
          </div>

          {filtersOpen && allNouns.length > 0 && (
            <div className="all-filter-panel">
              <div className="filter-group">
                <div className="filter-group-label">Род</div>
                <div className="filter-chips">
                  <button type="button" className={`filter-chip ${genderFilter === "all" ? "active" : ""}`} onClick={() => setGenderFilter("all")}>Все</button>
                  {GENDER_ORDER.map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={`filter-chip gender-${g} ${genderFilter === g ? "active" : ""}`}
                      onClick={() => setGenderFilter(genderFilter === g ? "all" : g)}
                    >
                      {GENDER_CHIP[g]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {modesOpen && allNouns.length > 0 && (
            <div className="all-filter-panel">
              <div className="filter-group">
                <div className="filter-group-label">Что тренировать</div>
                <div className="filter-chips">
                  {NOUN_QUIZ_MODE_ORDER.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`filter-chip ${quizModes.has(mode) ? "active" : ""}`}
                      onClick={() => toggleMode(mode)}
                      title={NOUN_QUIZ_MODE_HINT[mode]}
                    >
                      {NOUN_QUIZ_MODE_LABEL[mode]}
                    </button>
                  ))}
                </div>
                <p className="verb-modes-hint">
                  Несколько режимов — по каждому слову подряд: {NOUN_QUIZ_MODE_ORDER.map((m) => NOUN_QUIZ_MODE_LABEL[m]).join(" → ")}.
                  «Артикль» — выбор из der / die / das с подсказкой по правилу окончания.
                </p>
              </div>
            </div>
          )}

          {allNouns.length > 0 && groups.length === 0 && <p className="dict-nothing">Ничего не нашлось.</p>}

          {allNouns.length > 0 && (
            <div className="verbs-groups">
              {groups.map((group) => {
                const open = isNarrowed || openGroups.has(group.key);
                const coverage = packCoverage(progress, group.key, group.nouns.map((n) => n.id));
                const trainedAt = formatTrainedAt(coverage.lastTrainedAt);
                return (
                  <section key={group.key} className="dict-batch">
                    <button type="button" className="dict-batch-head" onClick={() => toggleGroup(group.key)}>
                      <div className="dict-batch-title-wrap">
                        <strong className="dict-batch-title">{group.title}</strong>
                        <span className="dict-batch-meta">
                          {group.nouns.length} {nounWordForm(group.nouns.length)}
                          {trainedAt ? ` · тренировка ${trainedAt}` : " · ещё не тренировали"}
                        </span>
                      </div>
                      <span className={`dict-batch-pct${coverage.percent >= 100 ? " done" : ""}`}>{coverage.percent}%</span>
                      <ChevronDown size={17} className={`dict-batch-chevron${open ? " open" : ""}`} />
                    </button>

                    <PackBar coverage={coverage} />

                    <div className="dict-batch-actions">
                      <button type="button" className="dict-train-btn" onClick={() => trainPack(group.key, group.nouns)}>
                        <Dumbbell size={14} />
                        {coverage.percent === 0 ? "Тренировать эту пачку" : coverage.percent >= 100 ? "Повторить пачку" : "Продолжить пачку"}
                      </button>
                      {coverage.percent < 100 && coverage.learned + coverage.seen > 0 && (
                        <button
                          type="button"
                          className="dict-train-btn"
                          onClick={() => trainPack(group.key, group.nouns.filter((n) => !progress.words[n.id]?.ok))}
                        >
                          Только незнакомые ({group.nouns.length - coverage.learned})
                        </button>
                      )}
                      {coverage.learned + coverage.seen > 0 && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Сбросить прогресс пачки"
                          title="Сбросить прогресс этой пачки"
                          onClick={() => reset(group.nouns.map((n) => n.id), group.key)}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>

                    {open && (
                      <div className="verb-table-wrap">
                        <table className="verb-table noun-table">
                          <thead>
                            <tr>
                              <th>Singular</th>
                              <th>Plural</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.nouns.map((entry) => {
                              const gender = nounGender(entry) ?? "none";
                              const article = nounArticle(entry);
                              const state = progress.words[entry.id];
                              return (
                                <tr
                                  key={entry.id}
                                  className={`verb-row noun-row gender-row-${gender}${state?.ok ? " noun-row-learned" : ""}`}
                                  onClick={() => setGrammarEntry(entry)}
                                >
                                  <td className="verb-cell-infinitive">
                                    <span className="verb-form-row">
                                      <span className="noun-headword">
                                        {article && (
                                          <span className={`noun-article gender-${gender}${hideArticles ? " noun-article-hidden" : ""}`}>
                                            {article}{" "}
                                          </span>
                                        )}
                                        <span className={`gender-${gender}`}>{bareNoun(entry)}</span>
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
                                    {entry.plural ? (
                                      <span className="verb-form-row">
                                        <span className="gender-pl">{entry.plural}</span>
                                        <SpeakButton text={entry.plural} lang={profile.targetLanguage} size={13} />
                                      </span>
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

          {missingArticles.length > 0 && (
            <section className="verb-missing">
              <div className="verb-missing-head">
                <strong>Без артикля — {missingArticles.length}</strong>
                <button
                  type="button"
                  className="dict-train-btn verb-missing-fill-all"
                  onClick={() => void fillAllMissing()}
                  disabled={bulkProgress !== null}
                >
                  {bulkProgress
                    ? `Определяю ${bulkProgress.done} из ${bulkProgress.total}…`
                    : <><Wand2 size={14} /> Дозаполнить все</>}
                </button>
              </div>
              <p className="verb-missing-hint">
                Эти слова уже в Словаре, но без рода и артикля — ИИ может определить их сам, и тогда они попадут в таблицу выше.
              </p>
              <div className="verb-missing-list">
                {missingArticles.map((entry) => (
                  <div key={entry.id} className="verb-missing-row">
                    <span className="verb-missing-word">
                      {entry.headword}
                      {entry.translation && <em> — {entry.translation}</em>}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Определить артикль для ${entry.headword}`}
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

      {/* Float above the bottom bar rather than sitting in the toolbar: the eye
          is wanted mid-scroll, while looking at a row, not back at the top. */}
      {!hasNothing && !isLoading && !error && (
        <div className="verbs-fabs">
          <div className="verbs-fab-group">
          <button
            type="button"
            className={`verbs-fab${hideArticles ? " active" : ""}`}
            onClick={() => setHideArticles((v) => { saveLocalNounsHideArticles(!v); return !v; })}
            aria-pressed={hideArticles}
            aria-label={hideArticles ? "Показать артикли" : "Скрыть артикли"}
            title={hideArticles ? "Показать артикли" : "Скрыть артикли — проверить себя"}
          >
            <span className="verbs-fab-label">der</span>
          </button>
          <button
            type="button"
            className={`verbs-fab${hideForms ? " active" : ""}`}
            onClick={() => setHideForms((v) => { saveLocalNounsHideForms(!v); return !v; })}
            aria-pressed={hideForms}
            aria-label={hideForms ? "Показать перевод и мн. число" : "Скрыть перевод и мн. число"}
            title={hideForms ? "Показать перевод и мн. число" : "Скрыть перевод и мн. число"}
          >
            {hideForms ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
          </div>
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

      {rulesOpen && <GenderRulesSheet onClose={() => setRulesOpen(false)} />}

      {grammarEntry && (
        <GrammarModal
          word={grammarEntry.headword}
          lemma={grammarEntry.lemma}
          posTag="noun"
          defaultLang={profile.targetLanguage}
          nativeLang={profile.nativeLanguage}
          onClose={() => setGrammarEntry(null)}
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
