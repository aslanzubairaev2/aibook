"use client";

import { useRef } from "react";
import type { HomeworkExercise } from "@/lib/ai/buildHomeworkPrompt";
import { itemKey, type HomeworkAnswers } from "./homeworkAnswers";
import { TappableText } from "./TappableText";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onItemChange: (itemNumber: number, value: string) => void;
  onWordTap: (word: string, contextSentence: string) => void;
};

/** A whole sentence with nothing to key a blank off — translation, an answer to a question, a word formed from an example. */
export function OpenResponseExercise({ exercise, answers, onItemChange, onWordTap }: Props) {
  const items = exercise.items ?? [];
  const inputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

  return (
    <div className="hw-items">
      {items.map((item, index) => {
        const key = itemKey(exercise.number, item.number);
        const value = typeof answers.items[key] === "string" ? answers.items[key] as string : "";
        const isLast = index === items.length - 1;
        return (
          <div key={item.number} className="hw-item hw-item-block">
            <div className="hw-item-row">
              <span className="hw-item-number">{item.number}.</span>
              <p className="hw-item-text"><TappableText text={item.text} onWordTap={onWordTap} /></p>
            </div>
            <textarea
              ref={(el) => { inputRefs.current[index] = el; }}
              className="hw-open-input"
              value={value}
              onChange={(e) => onItemChange(item.number, e.target.value)}
              onKeyDown={(e) => {
                // Enter (without Shift, which stays a newline) moves to the next
                // item instead of submitting anything — there is nothing to submit.
                if (e.key !== "Enter" || e.shiftKey || isLast) return;
                e.preventDefault();
                inputRefs.current[index + 1]?.focus();
              }}
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
