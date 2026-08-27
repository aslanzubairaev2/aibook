"use client";

import { useRef } from "react";
import type { HomeworkExercise, HomeworkItem } from "@/lib/ai/buildHomeworkPrompt";
import { itemKey, type HomeworkAnswers } from "./homeworkAnswers";
import { TappableText } from "./TappableText";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onBlankChange: (itemNumber: number, blankIndex: number, value: string) => void;
  onWordTap: (word: string, contextSentence: string) => void;
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

function ClozeItem({
  exercise, item, answers, onBlankChange, onWordTap, startIndex, totalBlanks, registerRef, onEnterAt,
}: {
  exercise: HomeworkExercise;
  item: HomeworkItem;
  answers: HomeworkAnswers;
  onBlankChange: (itemNumber: number, blankIndex: number, value: string) => void;
  onWordTap: (word: string, contextSentence: string) => void;
  startIndex: number;
  totalBlanks: number;
  registerRef: (globalIndex: number, el: HTMLInputElement | HTMLSelectElement | null) => void;
  onEnterAt: (globalIndex: number) => void;
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
          if ("text" in piece) return <TappableText key={i} text={piece.text} onWordTap={onWordTap} />;
          const blank = item.blanks?.[piece.blank];
          const value = values[piece.blank] ?? "";
          const globalIndex = startIndex + piece.blank;
          const isLast = globalIndex === totalBlanks - 1;
          const handleEnter = (e: React.KeyboardEvent) => {
            if (e.key !== "Enter" || isLast) return;
            e.preventDefault();
            onEnterAt(globalIndex);
          };
          if (blank?.select && bank.length > 0) {
            return (
              <select
                key={i}
                ref={(el) => registerRef(globalIndex, el)}
                className="hw-blank hw-blank-select"
                value={value}
                onChange={(e) => onBlankChange(item.number, piece.blank, e.target.value)}
                onKeyDown={handleEnter}
              >
                <option value="" />
                {bank.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            );
          }
          return (
            <input
              key={i}
              ref={(el) => registerRef(globalIndex, el)}
              type="text"
              className="hw-blank"
              value={value}
              size={Math.max(3, value.length || 4)}
              onChange={(e) => onBlankChange(item.number, piece.blank, e.target.value)}
              onKeyDown={handleEnter}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          );
        })}
      </p>
    </div>
  );
}

/** Where each item's blanks start in the exercise-wide Enter-navigation order. */
function computeStartIndices(items: HomeworkItem[]): number[] {
  const indices: number[] = [];
  let running = 0;
  for (const item of items) {
    indices.push(running);
    running += item.blanks?.length ?? 0;
  }
  return indices;
}

export function ClozeExercise({ exercise, answers, onBlankChange, onWordTap }: Props) {
  const items = exercise.items ?? [];
  const totalBlanks = items.reduce((sum, item) => sum + (item.blanks?.length ?? 0), 0);
  const startIndices = computeStartIndices(items);
  const inputRefs = useRef<Array<HTMLInputElement | HTMLSelectElement | null>>([]);

  return (
    <div className="hw-items">
      {items.map((item, i) => (
        <ClozeItem
          key={item.number}
          exercise={exercise}
          item={item}
          answers={answers}
          onBlankChange={onBlankChange}
          onWordTap={onWordTap}
          startIndex={startIndices[i]}
          totalBlanks={totalBlanks}
          registerRef={(idx, el) => { inputRefs.current[idx] = el; }}
          onEnterAt={(idx) => inputRefs.current[idx + 1]?.focus()}
        />
      ))}
    </div>
  );
}
