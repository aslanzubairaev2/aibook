"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookA, Camera } from "lucide-react";
import { DictionaryPanel, entryToAnalysis, entryToCardText } from "@/components/dictionary/DictionaryPanel";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { WordModal } from "@/components/word-modal/WordModal";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import {
  invalidateDictionaryCache, isDictionaryFresh, readDictionaryCache, writeDictionaryCache,
} from "@/lib/db/dictionaryCache";
import { useQuickWord } from "@/components/word-modal/useQuickWord";
import type { TrainBatch } from "@/lib/cards";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { sbAuthHeaders, sbInsertFlashcard } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";
import { useAuth } from "@/lib/auth/useAuth";
import type { AiAnalysis, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  profile: UserProfile;
  onAddCard?: (card: Flashcard) => void;
  /** «Тренировать эту пачку» — the pack carries its own training setup, if it has one. */
  onTrainWords?: (batch: TrainBatch) => void;
  /** Reload user flashcards from the server when a pack is added or re-linked. */
  onReloadCards?: () => void;
  /** Delete a whole group of cards at once — a pack that is nothing but its cards. */
  onDeleteCards?: (ids: string[]) => void;
  /**
   * Turn a pack into something to read or work through. The dictionary itself
   * has no lesson composer; it hands the pack to «Каталог», which does.
   */
  onCreateFromPack?: (pack: { title: string; brief: string; words: string[] }) => void;
};

/**
 * The learner's own words, as a screen of their own.
 *
 * It used to be the last tab of «Каталог» — a source of texts — which put the
 * one thing consulted every day behind a tab of a browsing screen. Everything
 * about the list itself still lives in DictionaryPanel; this is what feeds it:
 * the read, the deletes, the photograph, and the shared word modal.
 */
export function DictionaryView({
  cards, profile, onAddCard, onTrainWords, onReloadCards, onDeleteCards, onCreateFromPack,
}: Props) {
  const { user } = useAuth();
  // Supabase hands back a new `user` object on every token refresh; keying the
  // load on the id keeps a tab switch from refetching the whole dictionary.
  const userId = user?.id ?? null;

  // Список берётся из кэша сессии сразу же — возврат на этот экран не должен
  // выглядеть как первый заход.
  const cached = userId ? readDictionaryCache(userId, profile.targetLanguage) : null;
  const [entries, setEntries] = useState<DictionaryEntry[]>(cached?.entries ?? []);
  const [batches, setBatches] = useState<DictionaryBatch[]>(cached?.batches ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The dictionary reuses the app-wide word modal rather than inventing its own.
  const [word, setWord] = useState<{ entry: DictionaryEntry; analysis: AiAnalysis } | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2400);
  }, []);

  /**
   * Читает словарь, показывая при этом уже известное.
   *
   * `force` — после фотографии или удаления, когда снимок заведомо устарел.
   * Обычный вход на экран внутри окна свежести не ходит в сеть вообще, а за
   * его пределами перечитывает молча, оставляя старый список на экране: он
   * верен ровно до тех пор, пока не придёт новый.
   */
  const loadDictionary = useCallback(async (force = false) => {
    if (!userId) { setEntries([]); setBatches([]); return; }

    const snapshot = readDictionaryCache(userId, profile.targetLanguage);
    if (snapshot) {
      setEntries(snapshot.entries);
      setBatches(snapshot.batches);
      if (!force && isDictionaryFresh(snapshot)) return;
    }

    // Спиннер показывается только тогда, когда показывать больше нечего.
    if (!snapshot) setIsLoading(true);
    setError(null);
    try {
      const res = await freshFetch(`/api/dictionary?language=${encodeURIComponent(profile.targetLanguage)}`, {
        headers: await sbAuthHeaders(),
      });
      const data = await res.json() as { entries?: DictionaryEntry[]; batches?: DictionaryBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить словарь.");
      const fresh = { entries: data.entries ?? [], batches: data.batches ?? [] };
      setEntries(fresh.entries);
      setBatches(fresh.batches);
      writeDictionaryCache(userId, profile.targetLanguage, fresh);
    } catch (err) {
      // Устаревший список полезнее пустого экрана с ошибкой, поэтому ошибка
      // показывается только когда показывать больше нечего.
      if (!snapshot) setError(err instanceof Error ? err.message : "Не удалось загрузить словарь.");
    } finally {
      setIsLoading(false);
    }
  }, [userId, profile.targetLanguage]);

  useEffect(() => { void loadDictionary(); }, [loadDictionary]);

  const reloadDictionary = useCallback(() => {
    if (userId) invalidateDictionaryCache(userId, profile.targetLanguage);
    void loadDictionary(true);
  }, [loadDictionary, userId, profile.targetLanguage]);

  /**
   * Быстрое превью форм по удержанию.
   *
   * Словарная статья знает о слове почти всё, что нужно подсказке — перевод,
   * часть речи, артикль, множественное число, сохранённые формы глагола, —
   * поэтому здесь она открывается вообще без обращения к сети.
   */
  const { openQuickWord, quickWordPopover } = useQuickWord({
    targetLanguage: profile.targetLanguage,
    nativeLanguage: profile.nativeLanguage,
    authHeaders: sbAuthHeaders,
    onExpand: () => { /* карточка уже открыта коротким тапом */ },
  });

  const holdEntry = useCallback((entry: DictionaryEntry, anchor: DOMRect) => {
    openQuickWord(entry.lemma || entry.headword, anchor, {
      lemma: entry.lemma || entry.headword,
      translation: entry.translation,
      partOfSpeech: entry.part_of_speech,
      article: entry.article,
      plural: entry.plural,
      forms: entry.forms,
      context: entry.example,
    });
  }, [openQuickWord]);

  // Which words are already flashcards, so adding one says so instead of
  // silently making a duplicate.
  const cardFronts = useMemo(
    () => new Set(cards.map((c) => c.front.trim().toLowerCase())),
    [cards],
  );

  function addCardFromEntry(entry: DictionaryEntry) {
    if (!onAddCard) return;
    const { front, back } = entryToCardText(entry);
    if (cardFronts.has(front.trim().toLowerCase())) {
      showToast("Такая карточка уже есть");
      return;
    }
    const srs = createDefaultSrsFields(null, "Словарь");
    const card: Flashcard = {
      id: `card-${Date.now()}`,
      type: "word",
      source: "Словарь",
      addedAt: new Date().toISOString(),
      ...srs,
      front,
      back,
    };
    onAddCard(card);
    showToast("✓ Карточка добавлена");
    if (user) {
      void sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: card.front,
        back: card.back,
        source_book_title: "Словарь",
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

  async function deleteEntry(id: string) {
    // Кэш обновляется вместе с экраном: иначе возврат на словарь воскресил бы
    // удалённое слово из снимка, снятого до удаления.
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (userId) writeDictionaryCache(userId, profile.targetLanguage, { entries: next, batches });
      return next;
    });
    try {
      await fetch(`/api/dictionary?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await sbAuthHeaders(),
      });
    } catch {
      void loadDictionary();
    }
  }

  async function deleteBatch(batchId: string) {
    const nextEntries = entries.filter((e) => e.batch_id !== batchId);
    const nextBatches = batches.filter((b) => b.id !== batchId);
    setEntries(nextEntries);
    setBatches(nextBatches);
    if (userId) writeDictionaryCache(userId, profile.targetLanguage, { entries: nextEntries, batches: nextBatches });
    try {
      await fetch(`/api/dictionary?batchId=${encodeURIComponent(batchId)}`, {
        method: "DELETE",
        headers: await sbAuthHeaders(),
      });
    } catch {
      void loadDictionary();
    }
  }

  /**
   * Give a group of cards that only share a source name the pack row it lacks.
   * Afterwards it is an ordinary pack, with every card's schedule untouched.
   */
  async function registerLoosePack(title: string) {
    try {
      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({ title, language: profile.targetLanguage }),
      });
      const data = await res.json() as { adopted?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось оформить пачку.");
      reloadDictionary();
      onReloadCards?.();
      showToast(`Пачка «${title}» оформлена — карточек: ${data.adopted ?? 0}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Не удалось оформить пачку.");
    }
  }

  /**
   * Opening a word shows the same modal as everywhere else, instantly, from
   * what the entry already knows — then quietly upgrades it with the full AI
   * analysis. The textbook's own facts win where they overlap: its article,
   * plural and level are the course's word, not the model's guess.
   */
  async function openWord(entry: DictionaryEntry) {
    const base = entryToAnalysis(entry);
    setWord({ entry, analysis: base });

    const lookup = entry.lemma || entry.headword;
    const cacheKey = makeAiCacheKey("word", lookup, profile.targetLanguage, profile.nativeLanguage);
    try {
      let full = getLocalAiAnalysis(cacheKey);
      if (!full?.word) {
        full = await analyzeSelection({
          mode: "word",
          word: lookup,
          text: lookup,
          sentence: entry.example || lookup,
          sentenceBefore: "",
          sentenceAfter: "",
          nativeLanguage: profile.nativeLanguage,
          targetLanguage: profile.targetLanguage,
        });
        if (full?.word) saveLocalAiAnalysis(cacheKey, full);
      }
      if (!full?.word) return;

      const merged = mergeEntryWithAnalysis(entry, base, full);
      setWord((cur) => (cur && cur.entry.id === entry.id ? { entry, analysis: merged } : cur));
    } catch {
      // The entry-only view is already complete enough to be useful.
    }
  }

  return (
    <section className="screen dictionary-view">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Словарь</p>
          <h1>Мои слова</h1>
        </div>
      </header>

      {!user ? (
        <div className="seed-card">
          <BookA size={42} style={{ color: "var(--accent)" }} />
          <h3>Войдите, чтобы вести словарь</h3>
          <p>Слова сохраняются в вашем аккаунте и видны только вам.</p>
        </div>
      ) : (
        <>
          <DictionaryPanel
            entries={entries}
            batches={batches}
            cards={cards}
            isLoading={isLoading}
            error={error}
            language={profile.targetLanguage}
            nativeLanguage={profile.nativeLanguage}
            onPhotograph={() => setPhotoOpen(true)}
            onOpenEntry={(entry) => void openWord(entry)}
            onHoldEntry={holdEntry}
            onDeleteEntry={(id) => void deleteEntry(id)}
            onDeleteBatch={(id) => void deleteBatch(id)}
            onTrainBatch={(batch) => onTrainWords?.(batch)}
            onCreateFromPack={onCreateFromPack}
            onRegisterPack={(title) => void registerLoosePack(title)}
            onDeleteCards={onDeleteCards}
          />
          <button
            type="button"
            className="add-lesson-fab"
            onClick={() => setPhotoOpen(true)}
            aria-label="Сфотографировать слова"
            title="Сфотографировать слова"
          >
            <Camera size={22} />
          </button>
        </>
      )}

      {word && (
        <WordModal
          analysis={word.analysis}
          isOpen
          lang={profile.targetLanguage}
          nativeLang={profile.nativeLanguage}
          selectedWord={word.entry.headword}
          onClose={() => setWord(null)}
          onAddCard={() => addCardFromEntry(word.entry)}
          onAddExample={(text, translation) => {
            if (!onAddCard) return;
            const srs = createDefaultSrsFields(null, "Словарь");
            onAddCard({
              id: `card-${Date.now()}`,
              type: "phrase",
              source: "Словарь",
              addedAt: new Date().toISOString(),
              ...srs,
              front: text,
              back: translation,
            });
            showToast("✓ Карточка добавлена");
          }}
        />
      )}

      {photoOpen && (
        <PhotoLessonModal
          targetLanguage={profile.targetLanguage}
          nativeLanguage={profile.nativeLanguage}
          mode="dictionary"
          authHeaders={sbAuthHeaders}
          onClose={() => setPhotoOpen(false)}
          onCreated={() => setPhotoOpen(false)}
          onWordsAdded={({ added, updated, warning }) => {
            setPhotoOpen(false);
            reloadDictionary();
            onReloadCards?.();
            showToast(
              warning
                ? warning
                : updated > 0
                  ? `Добавлено слов: ${added}, обновлено: ${updated}`
                  : `Добавлено слов: ${added}`,
            );
          }}
        />
      )}

      {quickWordPopover}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

/**
 * The AI analysis, overruled by the entry wherever the entry actually knows
 * better: its article, plural, level and part of speech come from the
 * learner's own coursebook, not from a model's guess about the word.
 */
function mergeEntryWithAnalysis(entry: DictionaryEntry, base: AiAnalysis, full: AiAnalysis): AiAnalysis {
  const aiWord = full.word!;
  const baseWord = base.word!;
  const examples = [
    ...(entry.example ? [{ text: entry.example, translation: entry.example_translation }] : []),
    ...(full.examples ?? []),
  ].filter((ex, i, list) => list.findIndex((o) => o.text.trim() === ex.text.trim()) === i);

  return {
    word: {
      ...aiWord,
      text: entry.headword,
      lemma: aiWord.lemma || entry.lemma,
      partOfSpeech: entry.part_of_speech || aiWord.partOfSpeech,
      posTag: baseWord.posTag !== "other" ? baseWord.posTag : aiWord.posTag,
      gender: entry.article || aiWord.gender,
      cefr: entry.cefr || aiWord.cefr,
      translation: aiWord.translation || entry.translation,
      explanation: [entry.note, aiWord.explanation].filter(Boolean).join("\n"),
      nounDetails: {
        article: entry.article || aiWord.nounDetails?.article,
        plural: entry.plural || aiWord.nounDetails?.plural,
      },
      verbDetails: aiWord.verbDetails ?? baseWord.verbDetails,
    },
    examples,
  };
}
