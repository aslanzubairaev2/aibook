"use client";

// The keyboard shortcuts, on request.
//
// They used to be printed under the card as a permanent row of eleven grey
// captions. That is a lot of furniture under the one thing the screen exists
// for, and it is read exactly once — after that it is noise a learner has to
// look past on every single card. So: one small line saying the shortcuts
// exist, and this sheet when someone wants them.

import { X } from "lucide-react";

type Props = {
  onClose: () => void;
};

type Row = { keys: string[]; label: string; note?: string };

const CARD_KEYS: Row[] = [
  { keys: ["1", "2", "3", "4"], label: "Оценка", note: "забыл · трудно · хорошо · легко" },
  { keys: ["5"], label: "Озвучить" },
  { keys: ["+"], label: "Переозвучить", note: "заново, не из кеша" },
  { keys: ["6"], label: "Перевернуть карточку" },
  { keys: ["7"], label: "Мини-рассказ" },
  { keys: ["8"], label: "Обсудить с AI" },
  { keys: ["←", "→"], label: "История", note: "пройденные карточки" },
  { keys: ["0"], label: "Вернуться к текущей" },
  { keys: ["Esc"], label: "Выйти из дзен-режима" },
];

const PLAYER_KEYS: Row[] = [
  { keys: ["2"], label: "Повтор" },
  { keys: ["3"], label: "Закрыть плеер" },
];

const DISCUSS_KEYS: Row[] = [
  { keys: ["1", "2", "3"], label: "Вопросы, которые предлагает AI" },
  { keys: ["4"], label: "Формы слова" },
  { keys: ["5"], label: "Микрофон" },
  { keys: ["9"], label: "Закрыть" },
];

function KeyRows({ rows }: { rows: Row[] }) {
  return (
    <div className="keys-modal-rows">
      {rows.map((row) => (
        <div className="keys-modal-row" key={row.label}>
          <span className="keys-modal-keys">
            {row.keys.map((key) => <kbd key={key}>{key}</kbd>)}
          </span>
          <span className="keys-modal-copy">
            <strong>{row.label}</strong>
            {row.note && <small>{row.note}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TrainerKeysModal({ onClose }: Props) {
  return (
    <div className="modal-backdrop word-modal-backdrop" onClick={onClose}>
      <section
        className="word-modal keys-modal"
        role="dialog"
        aria-modal
        aria-label="Горячие клавиши"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-top-bar">
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
          <strong className="keys-modal-title">Горячие клавиши</strong>
        </div>

        <p className="keys-modal-intro">
          Работают и на цифровой клавиатуре справа, и на верхнем ряду цифр.
        </p>

        <div className="keys-modal-section">Карточка</div>
        <KeyRows rows={CARD_KEYS} />

        <div className="keys-modal-section">Пока открыт плеер</div>
        <p className="keys-modal-hint">
          Остальные клавиши по-прежнему относятся к карточке — только эти две переходят к плееру.
        </p>
        <KeyRows rows={PLAYER_KEYS} />

        <div className="keys-modal-section">В окне «Обсудить с AI»</div>
        <KeyRows rows={DISCUSS_KEYS} />
      </section>
    </div>
  );
}
