"use client";

import { useCallback, useState } from "react";
import { QuickWordPopover } from "@/components/word-modal/QuickWordPopover";
import type { QuickWordHints } from "@/lib/grammar/quickWord";

type Open = { word: string; anchor: DOMRect; hints?: QuickWordHints };

type Options = {
  targetLanguage: string;
  nativeLanguage: string;
  authHeaders: () => Promise<Record<string, string>>;
  /** «Раскрыть» из подсказки — обычно та же функция, что и по одиночному клику. */
  onExpand?: (word: string) => void;
};

/**
 * Быстрое превью форм слова — на всех экранах одинаково.
 *
 * Экран вызывает `openQuickWord(слово, прямоугольник)` из жеста удержания и
 * рендерит `quickWordPopover` где угодно в своём дереве: подсказка всё равно
 * уходит порталом в body.
 */
export function useQuickWord({ targetLanguage, nativeLanguage, authHeaders, onExpand }: Options) {
  const [open, setOpen] = useState<Open | null>(null);

  const openQuickWord = useCallback((word: string, anchor: DOMRect, hints?: QuickWordHints) => {
    const clean = word.trim();
    if (clean) setOpen({ word: clean, anchor, hints });
  }, []);

  const quickWordPopover = open ? (
    <QuickWordPopover
      word={open.word}
      anchor={open.anchor}
      hints={open.hints}
      targetLanguage={targetLanguage}
      nativeLanguage={nativeLanguage}
      authHeaders={authHeaders}
      onExpand={onExpand}
      onClose={() => setOpen(null)}
    />
  ) : null;

  return { openQuickWord, quickWordPopover, isQuickWordOpen: open !== null };
}
