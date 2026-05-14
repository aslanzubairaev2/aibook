"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { analyzeSelection } from "@/lib/ai/analyze";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";
import { saveLocalProgress, saveLocalBook } from "@/lib/db/local";
import { APP_CONFIG } from "@/lib/config";
import type { AiAnalysis, Book, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  book: Book;
  profile: UserProfile;
  onBack: () => void;
  onAddCard: (card: Flashcard) => void;
  onProgressUpdate: (book: Book) => void;
};

type ActiveToken = {
  token: string;
  normalized: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
};

export function ReaderView({ book, profile, onBack, onAddCard, onProgressUpdate }: Props) {
  const [active, setActive] = useState<ActiveToken | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to last saved position
  useEffect(() => {
    if (book.paragraphIndex > 0 && contentRef.current) {
      const paragraphs = contentRef.current.querySelectorAll("p[data-idx]");
      const target = paragraphs[Math.min(book.paragraphIndex, paragraphs.length - 1)];
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [book.paragraphIndex]);

  // Auto-save progress on scroll
  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!contentRef.current) return;
      const paragraphs = Array.from(contentRef.current.querySelectorAll("p[data-idx]"));
      const viewportMid = window.innerHeight / 2;
      let closestIdx = 0;
      let minDist = Infinity;
      for (const p of paragraphs) {
        const rect = p.getBoundingClientRect();
        const dist = Math.abs(rect.top - viewportMid);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = Number((p as HTMLElement).dataset.idx ?? 0);
        }
      }
      const progress = Math.round((closestIdx / Math.max(book.paragraphs.length - 1, 1)) * 100);
      const updated = { ...book, paragraphIndex: closestIdx, progress };
      saveLocalProgress(book.id, closestIdx);
      saveLocalBook(updated);
      onProgressUpdate(updated);
    }, APP_CONFIG.progressSaveDebounceMs);
  }, [book, onProgressUpdate]);

  const sentences = book.paragraphs; // each paragraph is treated as a sentence-group

  async function handleTokenTap(token: string, paraIndex: number) {
    const normalized = normalizeToken(token);
    if (!normalized) return;

    const sentence = book.paragraphs[paraIndex];
    const sentenceBefore = book.paragraphs[paraIndex - 1] ?? "";
    const sentenceAfter = book.paragraphs[paraIndex + 1] ?? "";

    setActive({ token, normalized, sentence, sentenceBefore, sentenceAfter });
    setAnalysis(null);
    setIsLoading(true);

    try {
      const result = await analyzeSelection({
        word: token,
        sentence,
        sentenceBefore,
        sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: profile.targetLanguage,
      });
      setAnalysis(result);
    } catch (err) {
      console.error("AI analysis failed:", err);
      setAnalysis(null);
    } finally {
      setIsLoading(false);
    }
  }

  function handleAddCard(type: Flashcard["type"]) {
    if (!analysis) return;
    const cardByType = {
      word:     { front: analysis.word.lemma,     back: analysis.word.translation },
      phrase:   { front: analysis.phrase.text,    back: analysis.phrase.translation },
      sentence: { front: analysis.sentence.text,  back: analysis.sentence.translation },
    };
    const card: Flashcard = {
      id: `card-${Date.now()}`,
      type,
      source: book.title,
      addedAt: new Date().toISOString(),
      status: "new",
      ...cardByType[type],
    };
    onAddCard(card);
    showToast("✓ Карточка добавлена");
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const phraseWords = analysis?.phrase.text.toLowerCase().split(/\s+/) ?? [];

  return (
    <div className="reader-screen" onScroll={handleScroll}>
      {/* Toolbar */}
      <header className="reader-toolbar">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div className="reader-toolbar-info">
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", flexShrink: 0 }}>
          {Math.round(book.progress)}%
        </span>
      </header>

      {/* Progress bar */}
      <div className="reading-progress-bar">
        <div className="reading-progress-fill" style={{ width: `${book.progress}%` }} />
      </div>

      {/* Text */}
      <div className="reader-content" ref={contentRef}>
        <article className="reader-text">
          {book.paragraphs.map((para, paraIndex) => {
            const isSentenceActive = active?.sentence === para;
            return (
              <p
                key={paraIndex}
                data-idx={paraIndex}
                className={isSentenceActive ? "hl-sentence" : undefined}
              >
                {splitIntoTokens(para).map((token, tokIdx) => {
                  const norm = normalizeToken(token);
                  if (!norm) return <span key={tokIdx}>{token}</span>;

                  const isWord   = isSentenceActive && active?.normalized === norm;
                  const isPhrase = isSentenceActive && phraseWords.some((pw) => normalizeToken(pw) === norm);

                  const cls = [
                    "text-token",
                    isWord   ? "hl-word"   : "",
                    isPhrase && !isWord ? "hl-phrase" : "",
                  ].filter(Boolean).join(" ");

                  return (
                    <button
                      key={tokIdx}
                      type="button"
                      className={cls}
                      onClick={() => void handleTokenTap(token, paraIndex)}
                    >
                      {token}
                    </button>
                  );
                })}
              </p>
            );
          })}
        </article>
      </div>

      {/* AI Panel */}
      {active && (
        <AiPanel
          selection={active}
          analysis={analysis}
          isLoading={isLoading}
          onClose={() => { setActive(null); setAnalysis(null); }}
          onOpenWordModal={() => setIsWordModalOpen(true)}
          onAddCard={handleAddCard}
        />
      )}

      {/* Word Modal */}
      {analysis && (
        <WordModal
          analysis={analysis}
          isOpen={isWordModalOpen}
          onClose={() => setIsWordModalOpen(false)}
          onAddCard={() => { handleAddCard("word"); setIsWordModalOpen(false); }}
        />
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
