"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import type { HomeworkExercise, HomeworkItem } from "@/lib/ai/buildHomeworkPrompt";
import { sbAuthHeaders } from "@/lib/db/supabase";
import {
  computeHomeworkProgress, itemKey, verbKey,
  type HomeworkAnswers, type ItemAnswer,
} from "./homeworkAnswers";
import { ClozeExercise } from "./ClozeExercise";
import { ComposeExercise } from "./ComposeExercise";
import { OpenResponseExercise } from "./OpenResponseExercise";
import { ConjugationExercise } from "./ConjugationExercise";
import { HomeworkHelpPanel } from "./HomeworkHelpPanel";
import { HomeworkPrintView } from "./HomeworkPrintView";

export type HomeworkBook = {
  id: string;
  title: string;
  description: string;
  sourceKind: string;
  homeworkDate: string;
  nativeLanguage: string;
};

type Props = {
  book: HomeworkBook;
  exercises: HomeworkExercise[];
  initialAnswers: HomeworkAnswers;
  onBack: () => void;
};

const SAVE_DEBOUNCE_MS = 1200;

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export function HomeworkView({ book, exercises, initialAnswers, onBack }: Props) {
  const [answers, setAnswers] = useState<HomeworkAnswers>(initialAnswers);
  const [helpTarget, setHelpTarget] = useState<{ instruction: string; item: HomeworkItem; bank?: string[] } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        <div className="hw-meta">
          {book.sourceKind && <span>{book.sourceKind}</span>}
          <span>На {formatDate(book.homeworkDate)}</span>
          <span className="hw-meta-progress">{progress}% заполнено</span>
        </div>
        {book.description && <p className="hw-desc">{book.description}</p>}

        {exercises.map((exercise) => {
          const bindHelp = (item: HomeworkItem) => setHelpTarget({ instruction: exercise.instruction, item, bank: item.bank ?? exercise.bank });
          return (
            <section key={exercise.number} className="hw-exercise">
              <h2 className="hw-exercise-title">{exercise.number}. {exercise.instruction}</h2>
              {exercise.widget === "cloze" && (
                <ClozeExercise exercise={exercise} answers={answers} onHelp={bindHelp}
                  onBlankChange={(itemNumber, blankIndex, value) => onBlankChange(exercise.number, itemNumber, blankIndex, value)} />
              )}
              {exercise.widget === "compose" && (
                <ComposeExercise exercise={exercise} answers={answers} onHelp={bindHelp}
                  onItemChange={(itemNumber, value) => setItemValue(exercise.number, itemNumber, value)} />
              )}
              {exercise.widget === "open" && (
                <OpenResponseExercise exercise={exercise} answers={answers} onHelp={bindHelp}
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
          );
        })}
      </div>

      {helpTarget && (
        <HomeworkHelpPanel
          instruction={helpTarget.instruction}
          itemText={helpTarget.item.text}
          bank={helpTarget.bank}
          nativeLanguage={book.nativeLanguage}
          onClose={() => setHelpTarget(null)}
        />
      )}

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

  .hw-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 40px; }
  .hw-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
  .hw-meta-progress { color: var(--accent); font-weight: 600; }
  .hw-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; }

  .hw-exercise { margin-bottom: 26px; }
  .hw-exercise-title { font-size: 14.5px; font-weight: 700; margin-bottom: 10px; }
  .hw-text-note { font-size: 13px; color: var(--text-muted); font-style: italic; }

  .hw-items { display: flex; flex-direction: column; gap: 10px; }
  .hw-item { display: flex; align-items: flex-start; gap: 6px; font-size: 14.5px; line-height: 1.8; }
  .hw-item-block { flex-direction: column; align-items: stretch; gap: 6px; }
  .hw-item-row { display: flex; align-items: flex-start; gap: 6px; }
  .hw-item-number { flex-shrink: 0; color: var(--text-muted); }
  .hw-item-text { flex: 1; margin: 0; }
  .hw-help-btn { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 0; border-radius: 50%; background: rgba(212,168,71,0.12); color: var(--accent); align-self: flex-start; }

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

  .hw-popup-backdrop { position: fixed; inset: 0; z-index: 140; display: flex; align-items: flex-end; background: rgba(0,0,0,0.5); }
  .hw-popup, .hw-help-panel {
    width: 100%; max-height: 78vh; overflow-y: auto;
    background: var(--bg-secondary); border-radius: 16px 16px 0 0;
    padding: 16px 18px max(16px, env(safe-area-inset-bottom));
  }
  .hw-popup-header { display: flex; align-items: center; justify-content: space-between; font-size: 16px; font-weight: 700; margin-bottom: 14px; }
  .hw-popup-close { border: 0; background: transparent; color: var(--text-muted); }
  .hw-popup-fields { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
  .hw-popup-field { display: flex; align-items: center; gap: 10px; }
  .hw-popup-field label { width: 90px; flex-shrink: 0; font-size: 13px; color: var(--text-muted); }
  .hw-popup-field input {
    flex: 1; height: 40px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px;
    background: rgba(240,230,211,0.04); color: var(--text-primary); font-size: 14px;
  }
  .hw-popup-done {
    display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 42px;
    border: 0; border-radius: 11px; background: var(--accent); color: var(--text-dark); font-weight: 700;
  }

  .hw-help-messages { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; max-height: 40vh; overflow-y: auto; }
  .hw-help-msg { margin: 0; font-size: 13.5px; line-height: 1.6; padding: 9px 11px; border-radius: 10px; }
  .hw-help-tutor { background: rgba(212,168,71,0.1); color: var(--text-primary); }
  .hw-help-learner { background: rgba(240,230,211,0.06); color: var(--text-muted); align-self: flex-end; }
  .hw-help-loading { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); }
  .hw-help-error { color: #e2a0a0; font-size: 13px; }
  .hw-help-input-row { display: flex; gap: 8px; }
  .hw-help-input-row input {
    flex: 1; height: 40px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px;
    background: rgba(240,230,211,0.04); color: var(--text-primary); font-size: 13.5px;
  }
  .hw-help-input-row button {
    width: 40px; height: 40px; border: 0; border-radius: 9px; background: var(--accent); color: var(--text-dark);
    display: flex; align-items: center; justify-content: center;
  }
  .hw-help-input-row button:disabled { opacity: 0.5; }
`;
