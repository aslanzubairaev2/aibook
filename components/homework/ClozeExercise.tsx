"use client";

import { HelpCircle } from "lucide-react";
import type { HomeworkExercise, HomeworkItem } from "@/lib/ai/buildHomeworkPrompt";
import { itemKey, type HomeworkAnswers } from "./homeworkAnswers";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onBlankChange: (itemNumber: number, blankIndex: number, value: string) => void;
  onHelp: (item: HomeworkItem) => void;
};

const BLANK_RE = /\{\{(\d+)\}\}/g;

/** Split "Ich sprech{{0}} Französisch." into alternating text/blank pieces. */
function splitText(text: string): Array<{ text: string } | { blank: number }> {
  const pieces: Array<{ text: string } | { blank: number }> = [];
  let last = 0;
  for (const match of text.matchAll(BLANK_RE)) {
    if (match.index! > last) pieces.push({ text: text.slice(last, match.index) });
    pieces.push({ blank: Number(match[1]) });
    last = match.index! + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });
  return pieces;
}

function ClozeItem({ exercise, item, answers, onBlankChange, onHelp }: {
  exercise: HomeworkExercise;
  item: HomeworkItem;
  answers: HomeworkAnswers;
  onBlankChange: (itemNumber: number, blankIndex: number, value: string) => void;
  onHelp: (item: HomeworkItem) => void;
}) {
  const key = itemKey(exercise.number, item.number);
  const stored = answers.items[key];
  const values = Array.isArray(stored) ? stored : [];
  const bank = item.bank ?? exercise.bank ?? [];
  const pieces = splitText(item.text);

  return (
    <div className="hw-item">
      <span className="hw-item-number">{item.number}.</span>
      <p className="hw-item-text">
        {pieces.map((piece, i) => {
          if ("text" in piece) return <span key={i}>{piece.text}</span>;
          const blank = item.blanks?.[piece.blank];
          const value = values[piece.blank] ?? "";
          if (blank?.select && bank.length > 0) {
            return (
              <select
                key={i}
                className="hw-blank hw-blank-select"
                value={value}
                onChange={(e) => onBlankChange(item.number, piece.blank, e.target.value)}
              >
                <option value="" />
                {bank.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            );
          }
          return (
            <input
              key={i}
              type="text"
              className="hw-blank"
              value={value}
              size={Math.max(3, value.length || 4)}
              onChange={(e) => onBlankChange(item.number, piece.blank, e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          );
        })}
      </p>
      <button type="button" className="hw-help-btn" onClick={() => onHelp(item)} aria-label="Помощь ИИ" title="Помощь ИИ">
        <HelpCircle size={15} />
      </button>
    </div>
  );
}

export function ClozeExercise({ exercise, answers, onBlankChange, onHelp }: Props) {
  return (
    <div className="hw-items">
      {(exercise.items ?? []).map((item) => (
        <ClozeItem key={item.number} exercise={exercise} item={item} answers={answers} onBlankChange={onBlankChange} onHelp={onHelp} />
      ))}
    </div>
  );
}
