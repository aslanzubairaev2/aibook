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

/** A whole sentence with nothing to key a blank off — translation, an answer to a question, a word formed from an example. */
export function OpenResponseExercise({ exercise, answers, onItemChange, onHelp }: Props) {
  return (
    <div className="hw-items">
      {(exercise.items ?? []).map((item) => {
        const key = itemKey(exercise.number, item.number);
        const value = typeof answers.items[key] === "string" ? answers.items[key] as string : "";
        return (
          <div key={item.number} className="hw-item hw-item-block">
            <div className="hw-item-row">
              <span className="hw-item-number">{item.number}.</span>
              <p className="hw-item-text">{item.text}</p>
              <button type="button" className="hw-help-btn" onClick={() => onHelp(item)} aria-label="Помощь ИИ" title="Помощь ИИ">
                <HelpCircle size={15} />
              </button>
            </div>
            <textarea
              className="hw-open-input"
              value={value}
              onChange={(e) => onItemChange(item.number, e.target.value)}
              rows={2}
              placeholder="Ваш ответ"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        );
      })}
    </div>
  );
}
