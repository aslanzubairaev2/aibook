"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { HomeworkExercise } from "@/lib/ai/buildHomeworkPrompt";
import { FALLBACK_PRONOUNS, verbKey, type HomeworkAnswers } from "./homeworkAnswers";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onFormsChange: (verb: string, forms: string[]) => void;
};

function ConjugationPopup({ verb, pronouns, forms, onChange, onClose }: {
  verb: string;
  pronouns: string[];
  forms: string[];
  onChange: (forms: string[]) => void;
  onClose: () => void;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  const setForm = (i: number, value: string) => {
    const next = [...forms];
    next[i] = value;
    onChange(next);
  };

  return (
    <div className="hw-popup-backdrop" onClick={onClose}>
      <div className="hw-popup" onClick={(e) => e.stopPropagation()}>
        <div className="hw-popup-header">
          <span>{verb}</span>
          <button type="button" className="hw-popup-close" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="hw-popup-fields">
          {pronouns.map((pronoun, i) => (
            <div key={pronoun} className="hw-popup-field">
              <label htmlFor={`hw-conj-${verb}-${i}`}>{pronoun}</label>
              <input
                id={`hw-conj-${verb}-${i}`}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                value={forms[i] ?? ""}
                onChange={(e) => setForm(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (i === pronouns.length - 1) onClose();
                  else inputRefs.current[i + 1]?.focus();
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
        <button type="button" className="hw-popup-done" onClick={onClose}><Check size={16} />Готово</button>
      </div>
    </div>
  );
}

/** A verb list where tapping one opens a small pronoun-by-pronoun form, Enter hopping from field to field. */
export function ConjugationExercise({ exercise, answers, onFormsChange }: Props) {
  const [openVerb, setOpenVerb] = useState<string | null>(null);
  const pronouns = exercise.pronouns?.length ? exercise.pronouns : FALLBACK_PRONOUNS;

  return (
    <div className="hw-verb-list">
      {(exercise.verbs ?? []).map((verb) => {
        const forms = answers.conjugations[verbKey(exercise.number, verb)] ?? [];
        const filledCount = forms.filter((f) => f.trim()).length;
        return (
          <button
            key={verb}
            type="button"
            className={`hw-verb-chip${filledCount === pronouns.length ? " done" : ""}`}
            onClick={() => setOpenVerb(verb)}
          >
            {verb}
            {filledCount > 0 && <span className="hw-verb-count">{filledCount}/{pronouns.length}</span>}
          </button>
        );
      })}

      {openVerb && (
        <ConjugationPopup
          verb={openVerb}
          pronouns={pronouns}
          forms={answers.conjugations[verbKey(exercise.number, openVerb)] ?? []}
          onChange={(forms) => onFormsChange(openVerb, forms)}
          onClose={() => setOpenVerb(null)}
        />
      )}
    </div>
  );
}
