"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAiHeaders } from "@/lib/ai/analyze";
import {
  getFastWordCache,
  saveFastWordCache,
  type FastWordInfo,
} from "@/lib/ai/fastWord";

const WORD_SELECTOR = ".sub-interactive-word";
const HOVER_DELAY_MS = 1000;

type Preview = {
  word: string;
  rect: DOMRect;
  loading: boolean;
  info?: FastWordInfo;
  error?: string;
};

function cleanWord(value: string) {
  return value.trim().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
}

function previewDetails(info: FastWordInfo) {
  if (info.partOfSpeech === "verb" && info.verbForms?.length === 3) {
    return info.verbForms.join(" · ");
  }
  if (info.partOfSpeech === "noun" && info.plural) {
    return "мн. ч.: " + info.plural;
  }
  return info.baseForm || info.shortInfo || "";
}

function previewHeadword(info: FastWordInfo) {
  return info.partOfSpeech === "noun" && info.article
    ? info.article + " " + info.word
    : info.word;
}

export function QuickWordPreview({
  nativeLanguage,
  targetLanguage,
}: {
  nativeLanguage: string;
  targetLanguage: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [portal, setPortal] = useState<Element | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let anchor: HTMLElement | null = null;
    let controller: AbortController | null = null;

    const cancelPending = () => {
      clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      controller = null;
    };

    const close = () => {
      cancelPending();
      requestId.current++;
      anchor = null;
      setPreview(null);
    };

    const show = async (element: HTMLElement) => {
      timer = undefined;
      const word = cleanWord(element.dataset.wordText || element.textContent || "");
      if (!word || element !== anchor) return;

      const sentence = element.dataset.wordContext || word;
      const language =
        element.closest<HTMLElement>("[data-word-language]")?.dataset.wordLanguage ||
        targetLanguage;
      const rect = element.getBoundingClientRect();
      const cached = getFastWordCache(word, language, nativeLanguage);

      setPortal(document.fullscreenElement || document.body);
      if (cached) {
        setPreview({ word, rect, loading: false, info: cached });
        return;
      }

      const id = ++requestId.current;
      const requestController = new AbortController();
      controller = requestController;
      setPreview({ word, rect, loading: true });

      try {
        const response = await fetch("/api/ai/fast-word", {
          method: "POST",
          headers: await getAiHeaders(),
          body: JSON.stringify({
            word,
            sentence,
            nativeLanguage,
            targetLanguage: language,
          }),
          signal: requestController.signal,
        });
        const info = await response.json() as FastWordInfo & { error?: string };
        if (!response.ok) throw new Error(info.error || "Fast word lookup failed");
        saveFastWordCache(word, language, nativeLanguage, info);
        if (id === requestId.current && element === anchor) {
          setPreview({ word, rect, loading: false, info });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (id === requestId.current && element === anchor) {
          setPreview({
            word,
            rect,
            loading: false,
            error: "Перевод недоступен",
          });
        }
      } finally {
        if (controller === requestController) controller = null;
      }
    };

    const over = (event: PointerEvent) => {
      if (
        event.buttons ||
        event.pointerType !== "mouse" ||
        !matchMedia("(hover: hover) and (pointer: fine)").matches
      ) {
        return;
      }
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(WORD_SELECTOR)
          : null;
      if (!element || element === anchor) return;

      close();
      anchor = element;
      timer = setTimeout(() => {
        void show(element);
      }, HOVER_DELAY_MS);
    };

    const out = (event: PointerEvent) => {
      if (anchor && !anchor.contains(event.relatedTarget as Node | null)) close();
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && anchor) close();
    };

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("fullscreenchange", close);
    window.addEventListener("resize", close);

    return () => {
      close();
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
    node.style.left =
      Math.max(8, Math.min(preview.rect.left, innerWidth - width - 8)) + "px";
    node.style.top =
      Math.max(
        8,
        Math.min(
          preview.rect.top >= height + 8
            ? preview.rect.top - height - 8
            : preview.rect.bottom + 8,
          innerHeight - height - 8,
        ),
      ) + "px";
  }, [preview]);

  if (!preview || !portal) return null;

  const info = preview.info;
  const details = info ? previewDetails(info) : "";

  return createPortal(
    <div
      ref={popup}
      className="quick-word-preview"
      role="tooltip"
      aria-label={"Быстрый перевод: " + preview.word}
    >
      <strong>{info ? previewHeadword(info) : preview.word}</strong>
      <div className="quick-word-preview-translation" role="status">
        {preview.loading
          ? "Загружаем перевод…"
          : preview.error || info?.translation || "Перевод недоступен"}
      </div>
      {details ? <small>{details}</small> : null}
    </div>,
    portal,
  );
}
