"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Dumbbell, Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { PrepositionQuiz } from "@/components/otherpos/PrepositionQuiz";
import { AdjectiveQuiz } from "@/components/otherpos/AdjectiveQuiz";
import { CASE_LABEL, isPrepositionEntry, prepositionCaseFor } from "@/lib/prepositionForms";
import { isAdjectiveEntry } from "@/lib/adjectiveEndings";
import { bareNoun, isNounEntry, nounGender, type NounGender } from "@/lib/nounForms";
import { OTHER_POS_CATEGORY_LABEL, OTHER_POS_CATEGORY_ORDER, type OtherPosCategory } from "@/lib/otherPosQuizModes";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";
import {
  getLocalOtherPosDict, getLocalOtherPosOpenGroups, getLocalTrainingFilter,
  saveLocalOtherPosDict, saveLocalOtherPosOpenGroups, saveLocalTrainingFilter,
} from "@/lib/db/local";
import { usePackProgress } from "@/lib/srs/usePackProgress";
import { formatTrainedAt, packCoverage, type TrainingFilter } from "@/lib/srs/packProgress";
import { isDifficultWord, isUnfamiliarWord, matchesTrainingFilter } from "@/lib/srs/adaptiveDifficulty";
import { PackBar } from "@/components/ui/PackBar";
import type { UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  onBack: () => void;
};

type OtherPosGroup = {
  key: string;
  title: string;
  createdAt: number;
  entries: DictionaryEntry[];
};

/**
 * Практика for every part of speech that isn't a noun or a verb — starting
 * with the two whose rule is a fixed grammatical table rather than lexical
 * data, so no AI backfill is needed: preposition case government, and
 * adjective ending declension. A segmented switch keeps the future additions
 * (particles, conjunctions) behind the same door instead of a new tile each.
 */
export function OtherPosView({ profile, onBack }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const cachedDict = useState(() => getLocalOtherPosDict(profile.targetLanguage))[0];
  const [entries, setEntries] = useState<DictionaryEntry[]>(cachedDict?.entries ?? []);
  const [batches, setBatches] = useState<DictionaryBatch[]>(cachedDict?.batches ?? []);
  const [isLoading, setIsLoading] = useState(cachedDict === null);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(!!cachedDict && (cachedDict.entries.length > 0 || cachedDict.batches.length > 0));

  const [category, setCategory] = useState<OtherPosCategory>("prepositions");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => getLocalOtherPosOpenGroups());
  const [quizEntries, setQuizEntries] = useState<DictionaryEntry[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [trainingFilter, setTrainingFilter] = useState<TrainingFilter>(() => getLocalTrainingFilter("otherpos"));

  const { progress, startSession, record, reset, resetAll } = usePackProgress("otherpos");

  const loadDictionary = useCallback(async () => {
    if (!userId) { setEntries([]); setBatches([]); setIsLoading(false); return; }
    if (!hasDataRef.current) setIsLoading(true);
    setError(null);
    try {
      const res = await freshFetch(`/api/dictionary?language=${encodeURIComponent(profile.targetLanguage)}`, {
        headers: await sbAuthHeaders(),
      });
      const data = await res.json() as { entries?: DictionaryEntry[]; batches?: DictionaryBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить слова.");
      const nextEntries = data.entries ?? [];
      const nextBatches = data.batches ?? [];
      setEntries(nextEntries);
      setBatches(nextBatches);
      saveLocalOtherPosDict(profile.targetLanguage, nextEntries, nextBatches);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить слова.";
      if (hasDataRef.current) setToast(message);
      else setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [userId, profile.targetLanguage]);

  useEffect(() => { void loadDictionary(); }, [loadDictionary]);

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

  const prepositionEntries = useMemo(
    () => entries.filter((e) => isPrepositionEntry(e) && prepositionCaseFor(e) !== null),
    [entries],
  );
  const missingCasePrepositions = useMemo(
    () => entries.filter((e) => isPrepositionEntry(e) && prepositionCaseFor(e) === null),
    [entries],
  );
  const adjectiveEntries = useMemo(() => entries.filter(isAdjectiveEntry), [entries]);

  // Adjective frames borrow real nouns from the learner's own dictionary so
  // the drill reads like a sentence instead of a grammar-table abstraction;
  // AdjectiveQuiz falls back to a small static list per gender when a gender
  // has nothing here yet.
  const nounsByGender = useMemo(() => {
    const map: Record<NounGender, string[]> = { m: [], f: [], n: [], pl: [] };
    for (const entry of entries) {
      if (!isNounEntry(entry)) continue;
      const gender = nounGender(entry);
      if (!gender) continue;
      const bare = bareNoun(entry);
      if (bare) map[gender].push(bare);
    }
    return map;
  }, [entries]);

  const activeEntries = category === "prepositions" ? prepositionEntries : adjectiveEntries;

  const trainableEntries = useMemo(
    () => activeEntries.filter((entry) => matchesTrainingFilter(progress.words[entry.id], trainingFilter)),
    [activeEntries, progress.words, trainingFilter],
  );
  const unfamiliarCount = useMemo(
    () => activeEntries.filter((entry) => isUnfamiliarWord(progress.words[entry.id])).length,
    [activeEntries, progress.words],
  );
  const difficultCount = useMemo(
    () => activeEntries.filter((entry) => isDifficultWord(progress.words[entry.id])).length,
    [activeEntries, progress.words],
  );

  const groups = useMemo<OtherPosGroup[]>(() => {
    const byBatch = new Map<string, DictionaryEntry[]>();
    const loose: DictionaryEntry[] = [];
    for (const entry of activeEntries) {
      if (entry.batch_id) {
        const list = byBatch.get(entry.batch_id) ?? [];
        list.push(entry);
        byBatch.set(entry.batch_id, list);
      } else {
        loose.push(entry);
      }
    }
    const result: OtherPosGroup[] = [];
    for (const batch of batches) {
      const batchEntries = byBatch.get(batch.id) ?? [];
      if (batchEntries.length === 0) continue;
      result.push({ key: batch.id, title: batch.title, createdAt: Date.parse(batch.created_at) || 0, entries: batchEntries });
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    if (loose.length > 0) result.push({ key: "loose", title: "Без пачки", createdAt: 0, entries: loose });
    return result;
  }, [activeEntries, batches]);

  function chooseTrainingFilter(filter: TrainingFilter) {
    setTrainingFilter(filter);
    saveLocalTrainingFilter("otherpos", filter);
  }

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveLocalOtherPosOpenGroups(next);
      return next;
    });

  function trainPack(packKey: string, packEntries: DictionaryEntry[]) {
    if (packEntries.length === 0) return;
    startSession(packKey);
    setQuizEntries(packEntries);
  }

  function resetAllTrainingProgress() {
    if (typeof window !== "undefined" && !window.confirm("Сбросить прогресс всех пачек?")) return;
    resetAll();
    setToast("Прогресс всех пачек сброшен");
  }

  if (quizEntries) {
    return category === "prepositions" ? (
      <PrepositionQuiz
        entries={quizEntries}
        targetLanguage={profile.targetLanguage}
        onExit={onBack}
        onRecord={record}
      />
    ) : (
      <AdjectiveQuiz
        entries={quizEntries}
        nounsByGender={nounsByGender}
        onExit={onBack}
        onRecord={record}
      />
    );
  }

  const hasNothing = !isLoading && !error && prepositionEntries.length === 0 && adjectiveEntries.length === 0;

  return (
    <section className="screen verbs-view nouns-view">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Другие части речи</p>
          <h1>Предлоги и прилагательные</h1>
        </div>
      </header>

      {isLoading ? (
        <div className="dict-loading">
          <Loader2 className="spin" size={22} /> Загружаю слова...
        </div>
      ) : error ? (
        <div className="empty-state">
          <strong>Не удалось загрузить</strong>
          <p>{error}</p>
        </div>
      ) : hasNothing ? (
        <div className="empty-state">
          <strong>Пока нечего показать</strong>
          <p>Предлоги и прилагательные из Словаря появляются здесь сами.</p>
        </div>
      ) : (
        <>
          <div className="filter-chips" style={{ padding: "0 4px 12px" }}>
            {OTHER_POS_CATEGORY_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                className={`filter-chip ${category === c ? "active" : ""}`}
                onClick={() => setCategory(c)}
              >
                {OTHER_POS_CATEGORY_LABEL[c]}
                {" "}({c === "prepositions" ? prepositionEntries.length : adjectiveEntries.length})
              </button>
            ))}
          </div>

          <div className="verbs-toolbar">
            <button
              type="button"
              className={`all-filter-toggle dict-filter-toggle ${filtersOpen || trainingFilter !== "all" ? "active" : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal size={15} /> Фильтр
              {trainingFilter !== "all" && <span className="all-filter-count">1</span>}
              <ChevronDown size={12} />
            </button>
            {activeEntries.length > 0 && (
              <button
                type="button"
                className="dict-train-btn verbs-train-all-btn"
                disabled={trainableEntries.length === 0}
                onClick={() => trainPack(`${category}:__all__`, trainableEntries)}
                title={trainableEntries.length === 0 ? "Для этого фильтра пока нет слов" : undefined}
              >
                <Dumbbell size={14} /> {trainingFilter === "all" ? "Тренировать всё" : `Тренировать ${trainingFilter === "difficult" ? "сложные" : "незнакомые"}`}
              </button>
            )}
            <button type="button" className="icon-btn training-reset-all-btn" onClick={resetAllTrainingProgress} aria-label="Сбросить прогресс всех пачек" title="Сбросить прогресс всех пачек">
              <RotateCcw size={15} />
            </button>
          </div>

          {filtersOpen && (
            <div className="all-filter-panel">
              <div className="filter-group">
                <div className="filter-group-label">Фильтр слов для тренировки</div>
                <div className="filter-chips">
                  <button type="button" className={`filter-chip ${trainingFilter === "all" ? "active" : ""}`} onClick={() => chooseTrainingFilter("all")}>Все</button>
                  <button type="button" className={`filter-chip ${trainingFilter === "unfamiliar" ? "active" : ""}`} onClick={() => chooseTrainingFilter("unfamiliar")}>Незнакомые ({unfamiliarCount})</button>
                  <button type="button" className={`filter-chip ${trainingFilter === "difficult" ? "active" : ""}`} onClick={() => chooseTrainingFilter("difficult")}>Сложные ({difficultCount})</button>
                </div>
                <p className="verb-modes-hint">«Незнакомые» — последняя попытка с ошибкой. «Сложные» — слова с повторными ошибками, рассчитанные по вашей локальной истории.</p>
              </div>
            </div>
          )}

          {groups.length === 0 && <p className="dict-nothing">{OTHER_POS_CATEGORY_LABEL[category]} пока не найдены.</p>}

          <div className="verbs-groups">
            {groups.map((group) => {
              const open = openGroups.has(group.key);
              const coverage = packCoverage(progress, `${category}:${group.key}`, group.entries.map((e) => e.id));
              const trainedAt = formatTrainedAt(coverage.lastTrainedAt);
              const trainable = group.entries.filter((entry) => matchesTrainingFilter(progress.words[entry.id], trainingFilter));
              const sessionEntries = trainingFilter === "all" ? group.entries : trainable;
              return (
                <section key={group.key} className="dict-batch">
                  <button type="button" className="dict-batch-head" onClick={() => toggleGroup(group.key)}>
                    <div className="dict-batch-title-wrap">
                      <strong className="dict-batch-title">{group.title}</strong>
                      <span className="dict-batch-meta">
                        {group.entries.length}
                        {trainedAt ? ` · тренировка ${trainedAt}` : " · ещё не тренировали"}
                      </span>
                    </div>
                    <span className={`dict-batch-pct${coverage.percent >= 100 ? " done" : ""}`}>{coverage.percent}%</span>
                    <ChevronDown size={17} className={`dict-batch-chevron${open ? " open" : ""}`} />
                  </button>

                  <PackBar coverage={coverage} />

                  <div className="dict-batch-actions">
                    <button
                      type="button"
                      className="dict-train-btn"
                      disabled={sessionEntries.length === 0}
                      onClick={() => trainPack(`${category}:${group.key}`, sessionEntries)}
                      title={sessionEntries.length === 0 ? "Для этого фильтра пока нет слов" : undefined}
                    >
                      <Dumbbell size={14} />
                      {trainingFilter !== "all"
                        ? `${trainingFilter === "difficult" ? "Сложные" : "Незнакомые"} (${trainable.length})`
                        : coverage.percent === 0 ? "Тренировать эту пачку" : coverage.percent >= 100 ? "Повторить пачку" : "Продолжить пачку"}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Сбросить прогресс пачки"
                      title="Сбросить прогресс этой пачки"
                      onClick={() => reset(group.entries.map((e) => e.id), `${category}:${group.key}`)}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>

                  {open && (
                    <div className="verb-table-wrap">
                      <table className="verb-table">
                        <thead>
                          <tr>
                            <th>{category === "prepositions" ? "Предлог" : "Слово"}</th>
                            <th>{category === "prepositions" ? "Падеж" : "Перевод"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.entries.map((entry) => {
                            const word = entry.lemma || entry.headword;
                            const prepCase = category === "prepositions" ? prepositionCaseFor(entry) : null;
                            return (
                              <tr key={entry.id} className="verb-row">
                                <td className="verb-cell-infinitive">
                                  <span className="verb-form-row">
                                    <span>{word}</span>
                                    <SpeakButton text={word} lang={profile.targetLanguage} size={13} />
                                  </span>
                                  {category === "prepositions" && entry.example && (
                                    <span className="verb-translation">{entry.example}</span>
                                  )}
                                </td>
                                <td>{category === "prepositions" ? (prepCase ? CASE_LABEL[prepCase] : "—") : (entry.translation || "—")}</td>
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

          {category === "prepositions" && missingCasePrepositions.length > 0 && (
            <section className="verb-missing">
              <div className="verb-missing-head">
                <strong>Без данных о падеже — {missingCasePrepositions.length}</strong>
              </div>
              <p className="verb-missing-hint">
                Эти предлоги не попали в таблицу управления падежом — редкие или составные формы. Они не участвуют в тренировке.
              </p>
              <div className="verb-missing-list">
                {missingCasePrepositions.map((entry) => (
                  <div key={entry.id} className="verb-missing-row">
                    <span className="verb-missing-word">{entry.headword}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
