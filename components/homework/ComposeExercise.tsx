"use client";

import { HelpCircle } from "lucide-react";
import type { HomeworkExercise, HomeworkItem } from "@/lib/ai/buildHomeworkPrompt";
import { itemKey, type HomeworkAnswers } from "./homeworkAnswers";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onItemChange: (itemNumber: number, value: string) => void;
  onHelp: (item: HomeworkItem) => void;
};

/**
 * Build the answer out of a given word bank — by tapping words in, or by
 * typing/editing the same field by hand. Tapping just inserts text into an
 * ordinary input; it never locks the field or spends a word once used, since
 * a real answer often needs the same word twice ("Wer ist das? — Das ist
 * Monika Weker, sie ist ...").
 */
export function ComposeExercise({ exercise, answers, onItemChange, onHelp }: Props) {
  return (
    <div className="hw-items">
      {(exercise.items ?? []).map((item) => {
        const key = itemKey(exercise.number, item.number);
        const value = typeof answers.items[key] === "string" ? answers.items[key] as string : "";
        const bank = item.bank ?? exercise.bank ?? [];

        const tap = (word: string) => {
          const sep = value && !value.endsWith(" ") ? " " : "";
          onItemChange(item.number, `${value}${sep}${word} `);
        };

        return (
          <div key={item.number} className="hw-item hw-item-block">
            <div className="hw-item-row">
              <span className="hw-item-number">{item.number}.</span>
              <p className="hw-item-text">{item.text}</p>
              <button type="button" className="hw-help-btn" onClick={() => onHelp(item)} aria-label="Помощь ИИ" title="Помощь ИИ">
                <HelpCircle size={15} />
              </button>
            </div>
            <input
              type="text"
              className="hw-compose-input"
              value={value}
              onChange={(e) => onItemChange(item.number, e.target.value)}
              placeholder="Ответ — тапайте слова или пишите сами"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {bank.length > 0 && (
              <div className="hw-bank">
                {bank.map((word, i) => (
                  <button key={`${word}-${i}`} type="button" className="hw-chip" onClick={() => tap(word)}>
                    {word}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
