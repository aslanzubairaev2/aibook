"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import type { HomeworkExercise, HomeworkResponseField } from "@/lib/ai/buildHomeworkPrompt";
import { itemKey, type HomeworkAnswers } from "./homeworkAnswers";

type Props = {
  exercise: HomeworkExercise;
  answers: HomeworkAnswers;
  onFieldsChange: (itemNumber: number, fields: string[]) => void;
};

const FALLBACK_FIELD: HomeworkResponseField = { key: "answer", label: "Ответ" };

function fieldsForItem(exercise: HomeworkExercise, itemNumber: number): HomeworkResponseField[] {
  const item = exercise.items?.find((candidate) => candidate.number === itemNumber);
  return item?.fields ?? exercise.fields ?? [FALLBACK_FIELD];
}

function labelForField(field: HomeworkResponseField): string {
  if (field.label.trim()) return field.label;
  switch (field.key.toLocaleLowerCase()) {
    case "word": return "Слово";
    case "article_word": return "Слово с артиклем";
    case "feminine": return "Женская форма";
    case "plural": return "Множественное число";
    case "translation": return "Перевод";
    default: return "Ответ";
  }
}

function valuesForItem(answers: HomeworkAnswers, exerciseNumber: number, itemNumber: number): string[] {
  const raw = answers.items[itemKey(exerciseNumber, itemNumber)];
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

function FormationPopup({
  source,
  fields,
  values,
  onChange,
  onClose,
}: {
  source: string;
  fields: HomeworkResponseField[];
  values: string[];
  onChange: (values: string[]) => void;
  onClose: () => void;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  const setField = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (index === fields.length - 1) onClose();
    else inputRefs.current[index + 1]?.focus();
  };

  return (
    <div className="hw-popup-backdrop" onClick={onClose}>
      <div
        className="hw-formation-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hw-formation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hw-popup-header">
          <div>
            <span className="hw-formation-kicker">Образуйте из</span>
            <h3 id="hw-formation-title" className="hw-formation-source">{source}</h3>
          </div>
          <button type="button" className="hw-popup-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="hw-formation-fields">
          {fields.map((field, index) => (
            <label key={`${field.key}-${index}`} className="hw-formation-field" htmlFor={`hw-formation-${index}`}>
              <span className="hw-formation-label">{labelForField(field)}</span>
              <input
                id={`hw-formation-${index}`}
                ref={(element) => { inputRefs.current[index] = element; }}
                type="text"
                className="hw-form-input"
                value={values[index] ?? ""}
                onChange={(event) => setField(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
          ))}
        </div>

        <button type="button" className="hw-popup-done" onClick={onClose}>
          <Check size={16} />Готово
        </button>
      </div>
    </div>
  );
}

/**
 * A generic word-formation exercise. The AI supplies the source words and
 * response fields; this component only renders those fields and stores the
 * learner's answers. It therefore works for noun formation, feminine/plural
 * variants, translations, and similar transformations without a new hardcoded
 * modal for every textbook exercise.
 */
export function FormationExercise({ exercise, answers, onFieldsChange }: Props) {
  const [openItemNumber, setOpenItemNumber] = useState<number | null>(null);
  const items = exercise.items ?? [];
  const openItem = items.find((item) => item.number === openItemNumber) ?? null;
  const openFields = openItem ? fieldsForItem(exercise, openItem.number) : [];

  return (
    <div className="hw-formation-list">
      {items.map((item) => {
        const fields = fieldsForItem(exercise, item.number);
        const values = valuesForItem(answers, exercise.number, item.number);
        const filledCount = values.filter((value) => value.trim()).length;
        return (
          <button
            key={item.number}
            type="button"
            className={`hw-form-chip${filledCount === fields.length ? " done" : ""}`}
            onClick={() => setOpenItemNumber(item.number)}
            aria-haspopup="dialog"
          >
            <span className="hw-form-number">{item.number}.</span>
            <span className="hw-form-source">{item.text}</span>
            {filledCount > 0 && <span className="hw-form-count">{filledCount}/{fields.length}</span>}
          </button>
        );
      })}

      {openItem && (
        <FormationPopup
          source={openItem.text}
          fields={openFields}
          values={valuesForItem(answers, exercise.number, openItem.number)}
          onChange={(values) => onFieldsChange(openItem.number, values)}
          onClose={() => setOpenItemNumber(null)}
        />
      )}
    </div>
  );
}
