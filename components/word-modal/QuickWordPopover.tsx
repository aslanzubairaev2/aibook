"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2 } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { fetchQuickWord, localQuickWord, type QuickWord, type QuickWordHints } from "@/lib/grammar/quickWord";

type Props = {
  word: string;
  /** Прямоугольник слова, у которого всплывает подсказка. */
  anchor: DOMRect;
  targetLanguage: string;
  nativeLanguage: string;
  hints?: QuickWordHints;
  authHeaders: () => Promise<Record<string, string>>;
  onClose: () => void;
  /** «Раскрыть» — та же большая модалка слова, что и по обычному клику. */
  onExpand?: (word: string) => void;
};

const GAP = 8;
const WIDTH = 268;

/** Позиция всплывашки: под словом, если снизу есть место, иначе над ним. */
function place(anchor: DOMRect, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = anchor.bottom + GAP;
  const fitsBelow = below + height <= vh - GAP;

  return {
    // Прижимаем к краям экрана, а не выпускаем за них: подсказка у слова в
    // конце строки иначе наполовину уезжает за правую границу.
    left: Math.min(Math.max(GAP, anchor.left + anchor.width / 2 - WIDTH / 2), vw - WIDTH - GAP),
    top: fitsBelow ? below : Math.max(GAP, anchor.top - GAP - height),
  };
}

export function QuickWordPopover({
  word, anchor, targetLanguage, nativeLanguage, hints, authHeaders, onClose, onExpand,
}: Props) {
  // Первый слой — синхронно, до первой отрисовки: подсказка появляется уже
  // заполненной, а не как пустая рамка со спиннером.
  const [data, setData] = useState<QuickWord>(() =>
    localQuickWord(word, targetLanguage, nativeLanguage, hints),
  );
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const height = boxRef.current?.offsetHeight ?? 120;
    setPos(place(anchor, height));
  }, [anchor, data]);

  // Второй слой — сеть, только если локально чего-то не хватило.
  useEffect(() => {
    if (!data.pending) return;
    const controller = new AbortController();
    let active = true;
    fetchQuickWord(data, targetLanguage, nativeLanguage, hints ?? {}, authHeaders, controller.signal)
      .then((full) => { if (active) setData(full); })
      .catch(() => { if (active) setData((cur) => ({ ...cur, pending: false })); });
    return () => { active = false; controller.abort(); };
    // Запрос уходит ровно один раз на открытие подсказки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Закрытие: тап мимо, прокрутка под подсказкой, Escape.
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { verb, noun } = data;
  const title = noun?.article ? `${noun.article} ${data.lemma.replace(/^(der|die|das)\s+/i, "")}` : data.lemma;

  const body = (
    <>
      <div className="quick-pop-backdrop" onPointerDown={onClose} />
      <div
        ref={boxRef}
        className="quick-pop"
        role="dialog"
        aria-label={`Формы слова ${data.lemma}`}
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          width: WIDTH,
          // До первого замера — за кадром, чтобы не мигнуть в углу экрана.
          visibility: pos ? "visible" : "hidden",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="quick-pop-head">
          <strong className="quick-pop-word">{title}</strong>
          <SpeakButton text={title} lang={targetLanguage} size={14} />
          {onExpand && (
            <button
              type="button"
              className="quick-pop-expand"
              aria-label="Открыть карточку слова"
              onClick={() => { onClose(); onExpand(data.word); }}
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>

        <div className="quick-pop-translation">
          {data.translation || (data.pending ? <span className="quick-pop-dim">…</span> : "—")}
          {data.pending && <Loader2 size={11} className="spin quick-pop-spin" />}
        </div>

        {/* Формы, за которые модуль не ручается (сильный глагол вне таблицы),
            не показываются вообще — вместо них ожидание ответа модели. Учить
            по «gehte» хуже, чем подождать полсекунды. */}
        {verb && verb.provisional ? (
          <div className="quick-pop-forms quick-pop-waiting">
            {data.pending ? (
              <><Loader2 size={12} className="spin" /> уточняю формы…</>
            ) : (
              "формы не подтверждены"
            )}
          </div>
        ) : verb ? (
          <>
            <div className="quick-pop-forms">
              <span className="quick-pop-form">{verb.praeteritum}</span>
              <span className="quick-pop-sep">·</span>
              <span className="quick-pop-form">
                {verb.hilfsverb === "sein" ? "ist " : "hat "}
                {verb.partizip2}
              </span>
            </div>
            <div className="quick-pop-grid">
              <span><i>ich</i> {verb.present.ich}</span>
              <span><i>du</i> {verb.present.du}</span>
              <span><i>er</i> {verb.present.er}</span>
            </div>
            {verb.separablePrefix && (
              <div className="quick-pop-note">отделяемая приставка: {verb.separablePrefix}-</div>
            )}
          </>
        ) : null}

        {noun && (
          <div className="quick-pop-forms">
            <span className="quick-pop-form">
              Pl. {noun.plural || (data.pending ? "…" : "—")}
            </span>
            {noun.predicted && <span className="quick-pop-note">артикль по окончанию</span>}
          </div>
        )}
      </div>
    </>
  );

  // Портал обязателен: карточка в тренажёре живёт внутри 3D-трансформации, а
  // `position: fixed` внутри трансформированного предка отсчитывается от него,
  // а не от экрана — подсказка уезжала бы вместе с переворотом карточки.
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
