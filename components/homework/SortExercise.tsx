"use client";

import { useState } from "react";
import type { HomeworkExercise } from "@/lib/ai/buildHomeworkPrompt";
import { itemKey, type HomeworkAnswers } from "./homeworkAnswers";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onCategoryChange: (categoryNumber: number, value: string) => void;
};

/** A low-friction reconstruction for picture/diagram sorting tasks. */
export function SortExercise({ exercise, answers, onCategoryChange }: Props) {
  const categories = exercise.categories ?? [];
  const bank = exercise.bank ?? [];
  const [selectedCategory, setSelectedCategory] = useState(0);
  const addWord = (word: string) => {
    if (!categories.length) return;
    const key = itemKey(exercise.number, selectedCategory + 1);
    const current = typeof answers.items[key] === "string" ? answers.items[key] as string : "";
    if (current.split(/\s*,\s*/u).some((item) => item === word)) return;
    onCategoryChange(selectedCategory + 1, current ? `${current}, ${word}` : word);
  };
  return (
    <div className="hw-sort">
      {bank.length > 0 && (
        <div className="hw-sort-bank">
          <span className="hw-sort-label">Слова из словаря</span>
          <div className="hw-bank">
            {bank.map((word) => (
              <button key={word} type="button" className="hw-chip" onClick={() => addWord(word)} title={categories.length ? `Добавить в «${categories[selectedCategory]}»` : undefined}>{word}</button>
            ))}
          </div>
        </div>
      )}
      {categories.map((category, index) => {
        const key = itemKey(exercise.number, index + 1);
        const value = typeof answers.items[key] === "string" ? answers.items[key] as string : "";
        return (
          <label key={`${category}-${index}`} className="hw-sort-category">
            <span>{category}</span>
            <textarea onFocus={() => setSelectedCategory(index)} value={value} onChange={(event) => onCategoryChange(index + 1, event.target.value)} rows={2} placeholder="Запишите слова этой категории" />
          </label>
        );
      })}
      {categories.length === 0 && <p className="hw-text-note">Распределите слова по категориям, указанным на фотографии.</p>}
    </div>
  );
}
