"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { analyzeSelection } from "@/lib/ai/analyze";
import { getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { sbGetCachedWord, sbSaveCachedWord } from "@/lib/db/supabase";
import type { AiAnalysis } from "@/lib/types";

// Only elements that already implement word lookup. Never intercept ordinary text or links.
const WORDS = '.sub-interactive-word, .discuss-clickable-word, .panel-clickable-word, .hw-tappable-word, .livechat-clickable-word, .read-along-word[role="button"], .text-token[role="button"], [data-token-id][role="button"]';
const CONTEXT = '[data-word-context], [data-cue-text], .discuss-learning-text, .modal-example-text, .read-along-text, p';
const pending = new Map<string, Promise<AiAnalysis | null>>();

async function lookup(word: string, sentence: string, targetLanguage: string, nativeLanguage: string) {
  const key = makeAiCacheKey("word", word, targetLanguage, nativeLanguage);
  const local = getLocalAiAnalysis(key);
  if (local?.word) return local;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const cached = await sbGetCachedWord(word, targetLanguage, nativeLanguage);
    if (cached?.word) { saveLocalAiAnalysis(key, cached); return cached; }
    const result = await analyzeSelection({ mode: "word", word, text: word, sentence, sentenceBefore: "", sentenceAfter: "", targetLanguage, nativeLanguage });
    if (result?.word) {
      saveLocalAiAnalysis(key, result);
      void sbSaveCachedWord(word, targetLanguage, nativeLanguage, result);
    }
    return result;
  })();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}

type Preview = { word: string; rect: DOMRect; pinned: boolean; loading: boolean; analysis?: AiAnalysis | null; error?: string };

export function QuickWordPreview({ nativeLanguage, targetLanguage }: { nativeLanguage: string; targetLanguage: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [portal, setPortal] = useState<Element | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let anchor: HTMLElement | null = null;
    let pinned = false;
    let touchOrigin: { x: number; y: number } | null = null;
    let suppressClickUntil = 0;
    const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
    const close = () => { cancelTimer(); requestId.current++; pinned = false; anchor = null; setPreview(null); };
    const wordElement = (event: Event) => {
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>(WORDS) : null;
      return el && !el.matches('[disabled], [aria-hidden="true"], [aria-disabled="true"]') ? el : null;
    };
    const show = async (element: HTMLElement, persist: boolean) => {
      cancelTimer();
      const word = (element.textContent || "").replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
      if (!word) return;
      anchor = element;
      pinned = persist;
      const id = ++requestId.current;
      const container = element.closest<HTMLElement>(CONTEXT);
      const context = container?.dataset.wordContext || container?.textContent || word;
      const lang = element.closest<HTMLElement>('[data-word-language]')?.dataset.wordLanguage || targetLanguage;
      setPortal(document.fullscreenElement || document.body);
      setPreview({ word, rect: element.getBoundingClientRect(), pinned: persist, loading: true });
      try {
        const analysis = await lookup(word, context, lang, nativeLanguage);
        if (id === requestId.current) setPreview(current => current && { ...current, loading: false, analysis });
      } catch {
        if (id === requestId.current) setPreview(current => current && { ...current, loading: false, error: "Не удалось загрузить перевод. Повторите правый клик." });
      }
    };
    const menu = (event: MouseEvent) => {
      const element = wordElement(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      touchOrigin = null;
      void show(element, true);
    };
    const down = (event: PointerEvent) => {
      // A new gesture must not inherit suppression of the previous long press.
      suppressClickUntil = 0;
      cancelTimer();
      if (popup.current?.contains(event.target as Node)) return;
      close();
      const element = wordElement(event);
      if (!element || event.pointerType !== "touch") return;
      touchOrigin = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        touchOrigin = null;
        suppressClickUntil = Date.now() + 1200;
        void show(element, true);
      }, 650);
    };
    const move = (event: PointerEvent) => {
      if (touchOrigin && Math.hypot(event.clientX - touchOrigin.x, event.clientY - touchOrigin.y) > 8) {
        touchOrigin = null;
        cancelTimer();
      }
    };
    const up = () => { touchOrigin = null; cancelTimer(); };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); suppressClickUntil = 0; }
    };
    const over = (event: PointerEvent) => {
      if (pinned || event.buttons || event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const element = wordElement(event);
      if (!element?.matches('.sub-interactive-word') || element === anchor) return;
      close();
      anchor = element;
      timer = setTimeout(() => void show(element, false), 1000);
    };
    const out = (event: PointerEvent) => {
      if (!pinned && anchor && !anchor.contains(event.relatedTarget as Node | null)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && anchor) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener("contextmenu", menu, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("click", click, true);
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("fullscreenchange", close);
    window.addEventListener("resize", close);
    return () => {
      close();
      document.removeEventListener("contextmenu", menu, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("fullscreenchange", close);
      window.removeEventListener("resize", close);
    };
  }, [nativeLanguage, targetLanguage]);

  useLayoutEffect(() => {
    if (!preview || !popup.current) return;
    const node = popup.current;
    const { width, height } = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(preview.rect.left, innerWidth - width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(preview.rect.top >= height + 8 ? preview.rect.top - height - 8 : preview.rect.bottom + 8, innerHeight - height - 8))}px`;
  }, [preview]);

  if (!preview || !portal) return null;
  const word = preview.analysis?.word;
  const details = word?.verbDetails;
  return createPortal(
    <div ref={popup} className="quick-word-preview" role={preview.pinned ? "dialog" : "tooltip"} aria-label={`Быстрый разбор: ${preview.word}`} style={{ pointerEvents: preview.pinned ? "auto" : "none" }} onClick={e => e.stopPropagation()}>
      <strong>{preview.word}</strong>
      <div role="status">{preview.loading ? "Загружаем перевод…" : preview.error || word?.translation || "Перевод недоступен"}</div>
      {word?.partOfSpeech && <small>{word.partOfSpeech}</small>}
      {details && <small>{[details.infinitive, details.tense, details.person].filter(Boolean).join(" · ")}</small>}
      {preview.pinned && <small>Закрыть: Escape или нажатие вне подсказки</small>}
    </div>, portal,
  );
}
