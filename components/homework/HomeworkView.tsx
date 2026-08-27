"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import type { HomeworkExercise } from "@/lib/ai/buildHomeworkPrompt";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { analyzeSelection } from "@/lib/ai/analyze";
import { findDuplicateCard } from "@/lib/cards";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import type { AiAnalysis, DiscussMessage, Flashcard } from "@/lib/types";
import { WordModal } from "@/components/word-modal/WordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import {
  computeHomeworkProgress, itemKey, verbKey,
  type HomeworkAnswers, type ItemAnswer,
} from "./homeworkAnswers";
import { ClozeExercise } from "./ClozeExercise";
import { ComposeExercise } from "./ComposeExercise";
import { OpenResponseExercise } from "./OpenResponseExercise";
import { ConjugationExercise } from "./ConjugationExercise";
import { HomeworkPrintView } from "./HomeworkPrintView";

export type HomeworkBook = {
  id: string;
  title: string;
  description: string;
  sourceKind: string;
  homeworkDate: string;
  targetLanguage: string;
  nativeLanguage: string;
};

type Props = {
  book: HomeworkBook;
  exercises: HomeworkExercise[];
  initialAnswers: HomeworkAnswers;
  cards: Flashcard[];
  onAddCard: (card: Flashcard) => void;
  onBack: () => void;
};

const SAVE_DEBOUNCE_MS = 1200;

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** What an exercise's own text is, for the "Обсудить" chat's context — the verb list for a conjugation drill, the item sentences for everything else. */
function exerciseTextForDiscuss(exercise: HomeworkExercise): string[] {
  if (exercise.widget === "conjugation") return exercise.verbs ?? [];
  return (exercise.items ?? []).map((item) => item.text);
}

export function HomeworkView({ book, exercises, initialAnswers, cards, onAddCard, onBack }: Props) {
  const [answers, setAnswers] = useState<HomeworkAnswers>(initialAnswers);
  const [printOpen, setPrintOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Обсудить" — one shared DiscussAiModal, addressed at whichever exercise's
  // button was tapped; history kept per exercise so switching back and forth
  // doesn't lose the conversation.
  const [discussExercise, setDiscussExercise] = useState<number | null>(null);
  const [discussMessages, setDiscussMessages] = useState<Record<number, DiscussMessage[]>>({});

  // Tap any German word — in an item, or inside the chat's own examples — and
  // it opens the same "Слово" modal the reader uses.
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [wordModalSelection, setWordModalSelection] = useState("");
  const [wordModalAnalysis, setWordModalAnalysis] = useState<AiAnalysis | null>(null);
  const [isWordModalLoading, setIsWordModalLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const progress = computeHomeworkProgress(exercises, answers);

  const save = useCallback((current: HomeworkAnswers, percentage: number) => {
    void (async () => {
      try {
        await fetch("/api/lesson-progress", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
          body: JSON.stringify({
            shared_book_id: book.id,
            status: percentage >= 100 ? "completed" : percentage > 0 ? "in_progress" : "not_started",
            percentage,
            completed_at: percentage >= 100 ? new Date().toISOString() : null,
            answers: current,
          }),
        });
      } catch {
        // Best-effort: the answers stay in state either way, and the next edit retries the save.
      }
    })();
  }, [book.id]);

  // Debounced so every keystroke doesn't fire a request — only a pause in typing does.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(answers, progress), SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const setItemValue = (exerciseNumber: number, itemNumber: number, value: ItemAnswer) => {
    setAnswers((prev) => ({ ...prev, items: { ...prev.items, [itemKey(exerciseNumber, itemNumber)]: value } }));
  };

  const onBlankChange = (exerciseNumber: number, itemNumber: number, blankIndex: number, value: string) => {
    setAnswers((prev) => {
      const key = itemKey(exerciseNumber, itemNumber);
      const existing = prev.items[key];
      const values = Array.isArray(existing) ? [...existing] : [];
      values[blankIndex] = value;
      return { ...prev, items: { ...prev.items, [key]: values } };
    });
  };

  const onFormsChange = (exerciseNumber: number, verb: string, forms: string[]) => {
    setAnswers((prev) => ({ ...prev, conjugations: { ...prev.conjugations, [verbKey(exerciseNumber, verb)]: forms } }));
  };

  async function loadWordModalAnalysis(word: string, contextSentence: string) {
    setIsWordModalLoading(true);
    setWordModalAnalysis(null);
    try {
      const result = await analyzeSelection({
        mode: "word",
        word,
        sentence: contextSentence,
        sentenceBefore: "",
        sentenceAfter: "",
        nativeLanguage: book.nativeLanguage,
        targetLanguage: book.targetLanguage,
      });
      setWordModalAnalysis(result);
    } catch {
      // WordModal renders its own empty state for a null analysis; nothing more to show.
    } finally {
      setIsWordModalLoading(false);
    }
  }

  function handleWordTap(word: string, contextSentence: string) {
    setWordModalSelection(word);
    setIsWordModalOpen(true);
    void loadWordModalAnalysis(word, contextSentence);
  }

  function addFlashcard(front: string, back: string, type: Flashcard["type"]) {
    if (!front.trim() || !back.trim()) return;
    if (findDuplicateCard(front, cards)) { setToast("Такая карточка уже добавлена"); return; }
    const card: Flashcard = {
      id: `card-${Date.now()}`,
      type,
      source: book.title,
      addedAt: new Date().toISOString(),
      ...createDefaultSrsFields(book.id, book.title),
      front,
      back,
    };
    onAddCard(card);
    setToast("Добавлено в карточки");
  }

  const activeDiscussExercise = discussExercise !== null ? exercises.find((e) => e.number === discussExercise) : undefined;

  return (
    <div className="hw-view">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header className="hw-bar">
        <button type="button" className="hw-icon-btn" onClick={onBack} aria-label="Назад"><ArrowLeft size={20} /></button>
        <span className="hw-bar-title">{book.title}</span>
        <button type="button" className="hw-icon-btn" onClick={() => setPrintOpen(true)} aria-label="Печать" title="Печать / сохранить">
          <Printer size={19} />
        </button>
      </header>

      <div className="hw-progress-track"><div className="hw-progress-fill" style={{ width: `${progress}%` }} /></div>

      <div className="hw-scroll">
       <div className="hw-scroll-inner">
        <div className="hw-meta">
          {book.sourceKind && <span>{book.sourceKind}</span>}
          <span>На {formatDate(book.homeworkDate)}</span>
          <span className="hw-meta-progress">{progress}% заполнено</span>
        </div>
        {book.description && <p className="hw-desc">{book.description}</p>}

        {exercises.map((exercise) => (
          <section key={exercise.number} className="hw-exercise">
            <div className="hw-exercise-header">
              <h2 className="hw-exercise-title">{exercise.number}. {exercise.instruction}</h2>
              {exercise.widget !== "text" && (
                <button
                  type="button"
                  className="hw-discuss-btn"
                  onClick={() => setDiscussExercise(exercise.number)}
                  aria-label="Обсудить"
                  title="Обсудить"
                >
                  <MessageCircle size={15} />
                </button>
              )}
            </div>
            {exercise.widget === "cloze" && (
              <ClozeExercise exercise={exercise} answers={answers} onWordTap={handleWordTap}
                onBlankChange={(itemNumber, blankIndex, value) => onBlankChange(exercise.number, itemNumber, blankIndex, value)} />
            )}
            {exercise.widget === "compose" && (
              <ComposeExercise exercise={exercise} answers={answers} onWordTap={handleWordTap}
                onItemChange={(itemNumber, value) => setItemValue(exercise.number, itemNumber, value)} />
            )}
            {exercise.widget === "open" && (
              <OpenResponseExercise exercise={exercise} answers={answers} onWordTap={handleWordTap}
                onItemChange={(itemNumber, value) => setItemValue(exercise.number, itemNumber, value)} />
            )}
            {exercise.widget === "conjugation" && (
              <ConjugationExercise exercise={exercise} answers={answers}
                onFormsChange={(verb, forms) => onFormsChange(exercise.number, verb, forms)} />
            )}
            {exercise.widget === "text" && (
              <p className="hw-text-note">См. текст, указанный в задании — на этом снимке его нет.</p>
            )}
          </section>
        ))}
       </div>
      </div>

      {activeDiscussExercise && (
        <DiscussAiModal
          isOpen
          mode="homework"
          selectedText={activeDiscussExercise.instruction}
          sentence={exerciseTextForDiscuss(activeDiscussExercise).join(" / ")}
          nativeLanguage={book.nativeLanguage}
          targetLanguage={book.targetLanguage}
          messages={discussMessages[activeDiscussExercise.number] ?? []}
          onMessagesChange={(msgs) => setDiscussMessages((prev) => ({ ...prev, [activeDiscussExercise.number]: msgs }))}
          onClose={() => setDiscussExercise(null)}
          onWordTap={handleWordTap}
          onAddExample={(text, translation) => addFlashcard(text, translation, "phrase")}
          homeworkContext={{
            instruction: activeDiscussExercise.instruction,
            items: exerciseTextForDiscuss(activeDiscussExercise),
          }}
        />
      )}

      <WordModal
        analysis={wordModalAnalysis}
        isOpen={isWordModalOpen}
        isLoading={isWordModalLoading}
        lang={book.targetLanguage}
        nativeLang={book.nativeLanguage}
        selectedWord={wordModalSelection}
        onClose={() => { setIsWordModalOpen(false); setWordModalAnalysis(null); setWordModalSelection(""); }}
        onAddCard={() => addFlashcard(wordModalSelection, wordModalAnalysis?.word?.translation ?? "", "word")}
        onAddLemma={(lemma) => addFlashcard(lemma, wordModalAnalysis?.word?.translation ?? "", "word")}
        onWordTap={handleWordTap}
        onAddExample={(text, translation) => addFlashcard(text, translation, "phrase")}
      />

      {printOpen && (
        <HomeworkPrintView
          title={book.title}
          sourceKind={book.sourceKind}
          homeworkDate={book.homeworkDate}
          exercises={exercises}
          answers={answers}
          onClose={() => setPrintOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const STYLES = `
  .hw-view { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-primary); color: var(--text-primary); }
  .hw-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; padding-top: max(10px, env(safe-area-inset-top));
    border-bottom: 1px solid var(--border);
  }
  .hw-bar-title { flex: 1; text-align: center; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hw-icon-btn { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border: 0; border-radius: 50%; background: transparent; color: var(--text-primary); }

  .hw-progress-track { height: 3px; background: var(--border); }
  .hw-progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }

  /* Same reading width as the rest of the app's content screens (.screen) —
     a page of exercises is text to work through, not something that needs
     the full width of a wide desktop window. */
  .hw-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 40px; }
  .hw-scroll-inner { max-width: 640px; margin: 0 auto; }
  .hw-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
  .hw-meta-progress { color: var(--accent); font-weight: 600; }
  .hw-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; }

  .hw-exercise { margin-bottom: 26px; }
  .hw-exercise-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .hw-exercise-title { flex: 1; font-size: 14.5px; font-weight: 700; margin: 0; }
  .hw-discuss-btn {
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border: 0; border-radius: 50%;
    background: rgba(212,168,71,0.12); color: var(--accent);
  }
  .hw-text-note { font-size: 13px; color: var(--text-muted); font-style: italic; }

  .hw-items { display: flex; flex-direction: column; gap: 10px; }
  .hw-item { font-size: 14.5px; line-height: 1.8; }
  .hw-item-block { display: flex; flex-direction: column; gap: 6px; }
  .hw-item-row { display: flex; align-items: flex-start; gap: 6px; }
  .hw-item-number { flex-shrink: 0; color: var(--text-muted); }
  .hw-item-text { flex: 1; margin: 0; display: inline; }

  .hw-tappable-word { cursor: pointer; border-bottom: 1px dotted rgba(240,230,211,0.35); }
  .hw-tappable-word:active { color: var(--accent); }

  .hw-blank {
    display: inline-block; min-width: 44px; margin: 0 2px;
    border: 0; border-bottom: 2px solid var(--accent); background: transparent;
    color: var(--text-primary); font-size: 14.5px; font-family: inherit; text-align: center;
    padding: 0 2px;
  }
  .hw-blank-select { min-width: 90px; text-align: left; }

  .hw-compose-input, .hw-open-input {
    width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 9px;
    background: rgba(240,230,211,0.04); color: var(--text-primary); font-size: 14px; font-family: inherit;
  }
  .hw-open-input { resize: vertical; }

  .hw-bank { display: flex; flex-wrap: wrap; gap: 6px; }
  .hw-chip {
    padding: 5px 10px; border: 1px solid var(--border); border-radius: 999px;
    background: rgba(212,168,71,0.08); color: var(--text-primary); font-size: 13px;
  }
  .hw-chip:active { background: rgba(212,168,71,0.2); }

  .hw-verb-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .hw-verb-chip {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border: 1px solid var(--border); border-radius: 11px;
    background: rgba(240,230,211,0.04); color: var(--text-primary); font-size: 14px; font-weight: 600;
  }
  .hw-verb-chip.done { border-color: var(--accent); color: var(--accent); }
  .hw-verb-count { font-size: 11px; color: var(--text-muted); font-weight: 500; }

  .hw-popup-backdrop { position: fixed; inset: 0; z-index: 140; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,0.5); }
  /* .verb-quiz-card supplies the look (same card the Глаголы trainer's own
     conjugation drill uses); this only adds what a bottom-sheet popup needs
     on top of it — a width cap so it reads as a compact dialog even on a
     wide desktop window, a scroll limit, and the sheet's rounded top edge. */
  .hw-conj-popup {
    width: 100%; max-width: 420px; max-height: 78vh; overflow-y: auto;
    border-radius: 16px 16px 0 0;
    padding-bottom: max(20px, env(safe-area-inset-bottom));
  }
  .hw-popup-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .hw-popup-close { border: 0; background: transparent; color: var(--text-muted); }
  .hw-popup-done {
    display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 42px;
    border: 0; border-radius: 11px; background: var(--accent); color: var(--text-dark); font-weight: 700;
  }
`;
