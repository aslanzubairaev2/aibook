"use client";

import { Printer, X } from "lucide-react";
import type { HomeworkExercise, HomeworkItem } from "@/lib/ai/buildHomeworkPrompt";
import { FALLBACK_PRONOUNS, itemKey, verbKey, type HomeworkAnswers } from "./homeworkAnswers";

type Props = {
  title: string;
  sourceKind: string;
  homeworkDate: string;
  exercises: HomeworkExercise[];
  answers: HomeworkAnswers;
  onClose: () => void;
};

const BLANK_RE = /\{\{\d+\}\}/g;

/** The item's own text with each "{{n}}" swapped for the learner's answer, or a visible gap when it was left empty. */
function clozeLine(exercise: HomeworkExercise, item: HomeworkItem, answers: HomeworkAnswers): (string | { answer: string })[] {
  const key = itemKey(exercise.number, item.number);
  const stored = answers.items[key];
  const values = Array.isArray(stored) ? stored : [];
  let i = 0;
  const parts = item.text.split(BLANK_RE);
  const out: (string | { answer: string })[] = [];
  parts.forEach((part, idx) => {
    out.push(part);
    if (idx < parts.length - 1) {
      out.push({ answer: values[i] ?? "" });
      i += 1;
    }
  });
  return out;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/**
 * The printable/exportable result: the page as it was formulated, with the
 * learner's own answers written in — in a handwriting-style font and a pen
 * colour, so a teacher can tell at a glance what is print and what the
 * learner wrote, exactly like marking up a real worksheet.
 */
export function HomeworkPrintView({ title, sourceKind, homeworkDate, exercises, answers, onClose }: Props) {
  return (
    <div className="hw-print-overlay">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="hw-print-toolbar no-print">
        <button type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        <button type="button" className="hw-print-go" onClick={() => window.print()}><Printer size={16} />Печать / Сохранить PDF</button>
      </div>

      <div className="hw-print-page">
        <header className="hw-print-header">
          <h1>{title}</h1>
          <div className="hw-print-meta">
            {sourceKind && <span>{sourceKind}</span>}
            <span>Домашнее задание на {formatDate(homeworkDate)}</span>
          </div>
        </header>

        {exercises.map((exercise) => (
          <section key={exercise.number} className="hw-print-exercise">
            <h2>{exercise.number}. {exercise.instruction}</h2>

            {exercise.widget === "conjugation" && (
              <div className="hw-print-conjugations">
                {(exercise.verbs ?? []).map((verb) => {
                  const pronouns = exercise.pronouns?.length ? exercise.pronouns : FALLBACK_PRONOUNS;
                  const forms = answers.conjugations[verbKey(exercise.number, verb)] ?? [];
                  return (
                    <div key={verb} className="hw-print-verb">
                      <strong>{verb}</strong>
                      <ul>
                        {pronouns.map((pronoun, i) => (
                          <li key={pronoun}>
                            {pronoun} — <span className="hw-print-answer">{forms[i] || "…"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {exercise.widget === "cloze" && (exercise.items ?? []).map((item) => (
              <p key={item.number} className="hw-print-item">
                {item.number}.{" "}
                {clozeLine(exercise, item, answers).map((piece, i) =>
                  typeof piece === "string"
                    ? <span key={i}>{piece}</span>
                    : <span key={i} className="hw-print-answer">{piece.answer || "…"}</span>,
                )}
              </p>
            ))}

            {(exercise.widget === "compose" || exercise.widget === "open") && (exercise.items ?? []).map((item) => {
              const value = answers.items[itemKey(exercise.number, item.number)];
              const answer = typeof value === "string" ? value : "";
              return (
                <p key={item.number} className="hw-print-item">
                  {item.number}. {item.text}
                  {" — "}
                  <span className="hw-print-answer">{answer || "…"}</span>
                </p>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

const PRINT_STYLES = `
  .hw-print-overlay {
    position: fixed;
    inset: 0;
    z-index: 130;
    overflow-y: auto;
    background: #fff;
    color: #1a1a1a;
  }
  .hw-print-toolbar {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #f0e6d3;
    border-bottom: 1px solid #ddd;
  }
  .hw-print-toolbar button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: #1a1a1a; font-size: 13px; font-weight: 600; }
  .hw-print-go { padding: 8px 14px; border-radius: 9px; background: #1a1a1a; color: #fff !important; }

  .hw-print-page { max-width: 720px; margin: 0 auto; padding: 28px 24px 60px; }
  .hw-print-header h1 { font-size: 20px; margin-bottom: 4px; }
  .hw-print-meta { display: flex; gap: 12px; font-size: 12.5px; color: #666; margin-bottom: 20px; }
  .hw-print-exercise { margin-bottom: 22px; }
  .hw-print-exercise h2 { font-size: 14.5px; font-weight: 700; margin-bottom: 8px; }
  .hw-print-item { font-size: 14px; line-height: 1.9; margin-bottom: 6px; }
  .hw-print-verb { margin-bottom: 10px; font-size: 14px; }
  .hw-print-verb ul { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; }

  .hw-print-answer {
    font-family: "Caveat", cursive;
    font-size: 19px;
    font-weight: 600;
    color: #1d4ed8;
  }

  @media print {
    .no-print { display: none !important; }
    .hw-print-overlay { position: static; overflow: visible; }
    .hw-print-page { max-width: none; padding: 0; }
  }
`;
