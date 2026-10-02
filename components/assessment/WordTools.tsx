"use client";

// Tap any word in a task: «Показать перевод» or «Не знаю это слово». Both are
// saved with the attempt, so the teacher agent learns exactly which words were
// unknown — in a diagnostic test the lookup is allowed but reported, never
// hidden.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Languages, Loader2, X } from "lucide-react";
import { getAiHeaders } from "@/lib/ai/analyze";
import { wordKey, type ViewWordMark } from "./types";

type MarkPatch = { unknown?: boolean; translation?: string };

type WordToolsValue = {
  enabled: boolean;
  language: string;
  marks: Map<string, ViewWordMark>;
  mark: (sectionId: string, itemId: string | null, word: string, context: string, patch: MarkPatch) => Promise<void>;
};

const WordToolsContext = createContext<WordToolsValue | null>(null);

export function WordToolsProvider({ value, children }: { value: WordToolsValue; children: ReactNode }) {
  return <WordToolsContext.Provider value={value}>{children}</WordToolsContext.Provider>;
}

type Open = { word: string; context: string; x: number; y: number; sectionId: string; itemId: string | null };

const WORD = /(\p{L}[\p{L}\p{M}'’-]*)/u;

/** Text whose words can be tapped. Falls back to plain text when lookup is off. */
export function TappableText({ text, sectionId, itemId = null }: { text: string; sectionId: string; itemId?: string | null }) {
  const tools = useContext(WordToolsContext);
  const [open, setOpen] = useState<Open | null>(null);
  if (!tools?.enabled) return <>{text}</>;
  const parts = text.split(WORD);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const mark = tools.marks.get(wordKey(sectionId, itemId, part));
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            className={`asm-word${mark?.unknown ? " is-unknown" : ""}${mark?.translation ? " is-looked-up" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              setOpen({ word: part, context: text.slice(0, 300), x: rect.left + rect.width / 2, y: rect.bottom, sectionId, itemId });
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              setOpen({ word: part, context: text.slice(0, 300), x: rect.left + rect.width / 2, y: rect.bottom, sectionId, itemId });
            }}
          >
            {part}
          </span>
        );
      })}
      {/* Portalled: the word sits inside a <p>, which may not contain the menu. */}
      {open && createPortal(<WordMenu open={open} tools={tools} onClose={() => setOpen(null)} />, document.body)}
    </>
  );
}

function WordMenu({ open, tools, onClose }: { open: Open; tools: WordToolsValue; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mark = tools.marks.get(wordKey(open.sectionId, open.itemId, open.word));
  const [translation, setTranslation] = useState<string | null>(mark?.translation ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const away = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const translate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/fast-word", {
        method: "POST",
        headers: await getAiHeaders(),
        body: JSON.stringify({ word: open.word, sentence: open.context, nativeLanguage: "ru", targetLanguage: tools.language }),
      });
      const info = await response.json() as { translation?: string; article?: string; error?: string };
      if (!response.ok || !info.translation) throw new Error(info.error || "Перевод не найден");
      setTranslation(info.translation);
      await tools.mark(open.sectionId, open.itemId, open.word, open.context, { translation: info.translation });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось перевести");
    } finally {
      setLoading(false);
    }
  };

  const width = 240;
  const left = Math.max(8, Math.min(open.x - width / 2, window.innerWidth - width - 8));
  const top = Math.min(open.y + 6, window.innerHeight - 170);

  return (
    <div ref={ref} className="asm-word-menu" style={{ left, top, width }} role="dialog" aria-label={`Слово ${open.word}`}>
      <div className="asm-word-menu-head">
        <strong>{open.word}</strong>
        <button type="button" className="asm-icon-btn" onClick={onClose} aria-label="Закрыть"><X size={14} /></button>
      </div>
      {translation
        ? <p className="asm-word-translation">{translation}</p>
        : (
          <button type="button" className="asm-menu-btn" onClick={translate} disabled={loading}>
            {loading ? <Loader2 size={15} className="asm-spin" /> : <Languages size={15} />} Показать перевод
          </button>
        )}
      {error && <p className="asm-status is-wrong">{error}</p>}
      <button
        type="button"
        className={`asm-menu-btn${mark?.unknown ? " is-on" : ""}`}
        onClick={async () => { await tools.mark(open.sectionId, open.itemId, open.word, open.context, { unknown: !mark?.unknown }); onClose(); }}
      >
        <HelpCircle size={15} /> {mark?.unknown ? "Снять отметку «не знаю»" : "Не знаю это слово"}
      </button>
      <p className="asm-muted asm-small">Преподаватель увидит, какие слова вы отметили или переводили.</p>
    </div>
  );
}
