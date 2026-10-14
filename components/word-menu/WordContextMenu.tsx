"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, type LucideIcon } from "lucide-react";
import type { Flashcard } from "@/lib/types";
import {
  findPhraseCard,
  findWordCard,
  openFlashcardPreview,
  readWordMenuTarget,
  type WordMenuTarget,
} from "@/lib/wordMenu";

type Block = "word" | "phrase";

type MenuContext = {
  target: WordMenuTarget;
  /** The card for the block this item sits in, if the learner has one. */
  card: Flashcard | null;
  close: () => void;
};

/** What one item looks like right now — or null to leave it out of the menu. */
type ItemState = { disabled?: boolean; label?: string; run?: () => void };

export type WordMenuAction = {
  id: string;
  block: Block | "both";
  label: string;
  icon: LucideIcon;
  resolve: (ctx: MenuContext) => ItemState | null;
};

// Every item of the menu, in order. A new item is one entry here; the menu
// itself, its placement and its closing rules stay as they are.
export const WORD_MENU_ACTIONS: WordMenuAction[] = [
  {
    id: "open-flashcard",
    block: "both",
    label: "Перейти к флешкарте",
    icon: Layers,
    resolve: ({ card, close }) => card
      ? { run: () => { close(); openFlashcardPreview(card.id); } }
      : { disabled: true, label: "Флешкарты пока нет" },
  },
];

type OpenMenu = { target: WordMenuTarget; x: number; y: number };

const BLOCK_TITLE: Record<Block, string> = { word: "Слово", phrase: "Фраза" };

/**
 * The app-wide right-click menu for words and phrases. Mounted once; any
 * element marked with data-word / data-word-context / data-phrase gets it.
 * A text selection keeps the browser's own menu, so «Копировать» still works.
 */
export function WordContextMenu({ cards }: { cards: Flashcard[] }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (window.getSelection()?.toString().trim()) return;
      const target = readWordMenuTarget(e.target);
      if (!target) return;
      e.preventDefault();
      setPosition(null);
      setMenu({ target, x: e.clientX, y: e.clientY });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Open at the pointer, but never past the edge of the screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin));
    const top = menu.y + height + margin > window.innerHeight
      ? Math.max(margin, menu.y - height)
      : menu.y;
    setPosition({ left, top });
  }, [menu]);

  const blocks = useMemo(() => {
    if (!menu) return [];
    const { target } = menu;
    const byId = (id?: string) => (id ? cards.find((c) => c.id === id) ?? null : null);
    const close = () => setMenu(null);
    const result: { block: Block; text: string; items: { action: WordMenuAction; state: ItemState }[] }[] = [];
    const build = (block: Block, text: string, card: Flashcard | null) => {
      const items = WORD_MENU_ACTIONS
        .filter((a) => a.block === block || a.block === "both")
        .map((action) => ({ action, state: action.resolve({ target, card, close }) }))
        .filter((i): i is { action: WordMenuAction; state: ItemState } => i.state !== null);
      if (items.length > 0) result.push({ block, text, items });
    };
    if (target.word) build("word", target.word, byId(target.wordCardId) ?? findWordCard(target.word, cards));
    if (target.phrase) build("phrase", target.phrase, byId(target.phraseCardId) ?? findPhraseCard(target.phrase, target.word, cards));
    return result;
  }, [menu, cards]);

  if (!menu || blocks.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      className="word-menu"
      role="menu"
      style={position ? { left: position.left, top: position.top } : { left: menu.x, top: menu.y, visibility: "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {blocks.map(({ block, text, items }) => (
        <div key={block} className="word-menu-block">
          <div className="word-menu-head">
            <span className="word-menu-kind">{BLOCK_TITLE[block]}</span>
            <span className="word-menu-text" title={text}>{text}</span>
          </div>
          {items.map(({ action, state }) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="word-menu-item"
                disabled={state.disabled}
                onClick={state.run}
              >
                <Icon size={15} />
                <span>{state.label ?? action.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}
