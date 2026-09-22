"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { HomeworkExercise, HomeworkSortRow } from "@/lib/ai/buildHomeworkPrompt";
import {
  exerciseAnswerKey,
  itemKey,
  sortSelectionKey,
  normalizeHomeworkBank,
  type HomeworkAnswers,
  type SortSelection,
} from "./homeworkAnswers";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onSelectionChange: (rowNumber: number, selection: SortSelection) => void;
};

function legacyWords(answers: HomeworkAnswers, exercise: HomeworkExercise, rowNumber: number): string[] {
  const raw = answers.items[itemKey(exerciseAnswerKey(exercise), rowNumber)];
  if (typeof raw !== "string") return [];
  return raw.split(/\s*,\s*/u).map((word) => word.trim()).filter(Boolean);
}

function rowsForExercise(exercise: HomeworkExercise): HomeworkSortRow[] {
  if (exercise.sortRows?.length) return exercise.sortRows;
  return (exercise.categories ?? []).map((category, index) => ({ number: index + 1, category }));
}

function initialSelection(
  answers: HomeworkAnswers,
  exercise: HomeworkExercise,
  row: HomeworkSortRow,
): SortSelection {
  const saved = answers.sortSelections?.[sortSelectionKey(exercise, row.number)];
  if (saved) return saved;
  const words = legacyWords(answers, exercise, row.number);
  return {
    category: row.category,
    words: words.length > 0 ? words : (row.fixed ?? []),
  };
}

function isSameWord(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/**
 * A word-bank sorter for diagram and vocabulary tasks. The bank stays above
 * the fields so the learner can pick one field and then add several words in
 * quick succession. A word used in one row disappears from the bank until its
 * chip is removed again.
 */
export function SortExercise({ exercise, answers, onSelectionChange }: Props) {
  const rows = rowsForExercise(exercise);
  const bank = normalizeHomeworkBank(exercise.bank ?? []);
  const categories = Array.from(new Set([
    ...(exercise.categories ?? []),
    ...rows.map((row) => row.category ?? "").filter(Boolean),
  ]));
  const [activeRowNumber, setActiveRowNumber] = useState<number | null>(null);
  const selections = new Map(rows.map((row) => [row.number, initialSelection(answers, exercise, row)]));
  const usedWords = new Set(
    Array.from(selections.values()).flatMap((selection) => selection.words.map((word) => word.trim().toLocaleLowerCase())),
  );
  const activeRow = rows.find((row) => row.number === activeRowNumber);
  const activeSelection = activeRow ? selections.get(activeRow.number) ?? { words: [] } : null;
  const availableBank = bank.filter((word) => !usedWords.has(word.trim().toLocaleLowerCase()));

  const chooseCategory = (row: HomeworkSortRow, category: string) => {
    const current = selections.get(row.number) ?? { words: [] };
    onSelectionChange(row.number, { ...current, category });
  };

  const chooseWord = (word: string) => {
    if (!activeRow) return;
    const row = activeRow;
    const current = selections.get(row.number) ?? { words: [] };
    if (current.words.some((item) => isSameWord(item, word))) return;
    if (usedWords.has(word.trim().toLocaleLowerCase())) return;
    if (row.slots && current.words.length >= row.slots) return;
    onSelectionChange(row.number, { ...current, words: [...current.words, word] });
  };

  const removeWord = (row: HomeworkSortRow, word: string) => {
    if ((row.fixed ?? []).some((fixed) => isSameWord(fixed, word))) return;
    const current = selections.get(row.number) ?? { words: [] };
    onSelectionChange(row.number, { ...current, words: current.words.filter((item) => !isSameWord(item, word)) });
  };

  return (
    <div className="hw-sort">
      <div className="hw-sort-help">Выберите поле, затем нажимайте слова сверху. Использованные слова исчезают из списка.</div>
      {bank.length > 0 && (
        <div className="hw-sort-bank" role="group" aria-label="Слова для выбора">
          <div className="hw-sort-bank-heading">
            <span>Слова для выбора</span>
            {activeRow && <span className="hw-sort-bank-target">→ строка {activeRow.number}</span>}
          </div>
          <div className="hw-sort-bank-chips">
            {availableBank.length > 0 ? availableBank.map((word) => {
              const isFull = Boolean(activeRow?.slots && activeSelection && activeSelection.words.length >= activeRow.slots);
              return (
                <button
                  key={word}
                  type="button"
                  className="hw-sort-bank-chip"
                  disabled={!activeRow || isFull}
                  onClick={() => chooseWord(word)}
                  title={!activeRow ? "Сначала выберите поле" : isFull ? "В этом поле больше нет мест" : `Добавить в строку ${activeRow.number}`}
                >
                  {word}
                </button>
              );
            }) : (
              <span className="hw-text-note">Все слова уже распределены. Удалите чип из поля, чтобы выбрать его снова.</span>
            )}
          </div>
          {!activeRow && availableBank.length > 0 && <span className="hw-sort-bank-note">Сначала нажмите на поле, куда добавить слово.</span>}
        </div>
      )}
      {rows.map((row) => {
        const selection = selections.get(row.number) ?? { words: [] };
        const fixedWords = new Set((row.fixed ?? []).map((word) => word.toLocaleLowerCase()));
        return (
          <div key={row.number} className="hw-sort-row">
            <div className="hw-sort-row-heading">
              <span className="hw-sort-row-number">{row.number}.</span>
              {row.category ? (
                <span className="hw-sort-category-name">{row.category}</span>
              ) : categories.length > 0 ? (
                <select
                  className="hw-sort-category-select"
                  value={selection.category ?? ""}
                  onChange={(event) => chooseCategory(row, event.target.value)}
                  aria-label={`Категория для строки ${row.number}`}
                >
                  <option value="">Выберите категорию</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              ) : (
                <span className="hw-sort-category-name">Категория</span>
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              className={`hw-sort-field${activeRowNumber === row.number ? " active" : ""}`}
              onClick={() => setActiveRowNumber(row.number)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveRowNumber(row.number);
                }
              }}
              aria-label={`Выбрать слова для строки ${row.number}`}
            >
              {selection.words.length > 0 ? selection.words.map((word) => (
                <span key={word} className={`hw-sort-chip${fixedWords.has(word.toLocaleLowerCase()) ? " fixed" : ""}`}>
                  {word}
                  {!fixedWords.has(word.toLocaleLowerCase()) && (
                    <button
                      type="button"
                      className="hw-sort-chip-remove"
                      onClick={(event) => { event.stopPropagation(); removeWord(row, word); }}
                      aria-label={`Убрать ${word}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              )) : (
                <span className="hw-sort-placeholder">Тапните, чтобы выбрать слово</span>
              )}
            </div>
          </div>
        );
      })}

      {rows.length === 0 && <p className="hw-text-note">Распределите слова по категориям, указанным на фотографии.</p>}
      {bank.length === 0 && rows.length > 0 && <p className="hw-text-note">Список слов не распознан. Откройте обсуждение упражнения или перефотографируйте страницу крупнее.</p>}
    </div>
  );
}
