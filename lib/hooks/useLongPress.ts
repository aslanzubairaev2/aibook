"use client";

import { useCallback, useRef } from "react";

export type LongPressPoint = {
  /** Куда ставить подсказку — прямоугольник самого слова, а не точка пальца. */
  rect: DOMRect;
};

type Options = {
  /** Сколько держать, прежде чем это считается удержанием. */
  delayMs?: number;
  /** Насколько палец может уехать, оставаясь удержанием, а не прокруткой. */
  moveTolerancePx: number;
};

/**
 * Долгое удержание на телефоне и правая кнопка на компьютере — один жест.
 *
 * Тонкость, из-за которой наивная реализация не работает на телефоне: пока
 * палец лежит на слове, браузер сам через ~500 мс показывает своё меню выделения
 * текста и «съедает» жест. Поэтому здесь отменяется `contextmenu`, а на самом
 * элементе выключается `touch-callout` — см. `.quick-press-target` в стилях.
 */
export function useLongPress(
  onTrigger: (point: LongPressPoint) => void,
  { delayMs = 450, moveTolerancePx = 10 }: Partial<Options> = {},
) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Правая кнопка обрабатывается через onContextMenu — здесь только палец
      // и левая кнопка, иначе жест сработает дважды.
      if (e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      const target = e.currentTarget;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onTrigger({ rect: target.getBoundingClientRect() });
      }, delayMs);
    },
    [onTrigger, delayMs],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!start.current) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      // Палец поехал — это прокрутка списка, а не удержание слова.
      if (dx > moveTolerancePx || dy > moveTolerancePx) clear();
    },
    [clear, moveTolerancePx],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      clear();
      fired.current = true;
      onTrigger({ rect: e.currentTarget.getBoundingClientRect() });
    },
    [onTrigger, clear],
  );

  /** Был ли последний жест удержанием — чтобы обычный клик не сработал следом. */
  const consumedLongPress = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu,
    },
    consumedLongPress,
  };
}
