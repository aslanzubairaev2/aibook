"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { analyzeSelection } from "@/lib/ai/analyze";
import { splitIntoTokens, normalizeToken, splitSentencesWithRanges, findPhraseOffsets } from "@/lib/selector/text";
import { saveLocalProgress, saveLocalBook } from "@/lib/db/local";
import { sbUpsertProgress, sbInsertFlashcard } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
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
  paraIndex: number;
  tokIdxInPara: number;
  sentStart: number;
  sentEnd: number;
  phraseStart: number;
  phraseEnd: number;
  sentence: string;
  phraseText: string;
  sentenceBefore: string;
  sentenceAfter: string;
};

export function ReaderView({ book, profile, onBack, onAddCard, onProgressUpdate }: Props) {
  const { user } = useAuth();
  const [active, setActive] = useState<ActiveToken | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to last read paragraph on mount
  useEffect(() => {
    if (book.paragraphIndex <= 0) return;
    const t = setTimeout(() => {
      const els = contentRef.current?.querySelectorAll("p[data-idx]");
      const el = els?.[Math.min(book.paragraphIndex, (els?.length ?? 1) - 1)];
      el?.scrollIntoView({ behavior: "instant", block: "start" });
    }, 200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!contentRef.current) return;
      const els = Array.from(contentRef.current.querySelectorAll("p[data-idx]"));
      const mid = window.innerHeight / 2;
      let best = 0, bestDist = Infinity;
      for (const el of els) {
        const d = Math.abs(el.getBoundingClientRect().top - mid);
        if (d < bestDist) { bestDist = d; best = Number((el as HTMLElement).dataset.idx ?? 0); }
      }
      const progress = Math.round((best / Math.max(book.paragraphs.length - 1, 1)) * 100);
      const updated = { ...book, paragraphIndex: best, progress };

      // Save locally (instant)
      saveLocalProgress(book.id, best);
      saveLocalBook(updated);
      onProgressUpdate(updated);

      // Sync to Supabase in background
      if (user) {
        void sbUpsertProgress({
          user_id: user.id,
          book_id: book.id,
          chapter_index: 0,
          paragraph_index: best,
          scroll_pos: Math.round(window.scrollY),
          percentage: progress,
          last_read_at: new Date().toISOString(),
          total_time_ms: 0,
        });
      }
    }, APP_CONFIG.progressSaveDebounceMs);
  }, [book, user, onProgressUpdate]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  async function handleTokenTap(token: string, paraIndex: number, tokIdxInPara: number) {
    const norm = normalizeToken(token);
    if (!norm) return;

    const para = book.paragraphs[paraIndex];

    const tokens = splitIntoTokens(para);
    const offsets: number[] = [];
    let off = 0;
    for (const t of tokens) { offsets.push(off); off += t.length; }

    const targetChar = offsets[tokIdxInPara];

    const sentRanges = splitSentencesWithRanges(para);
    let sentStart = 0, sentEnd = para.length, sentText = para, sentIdx = 0;
    for (let i = 0; i < sentRanges.length; i++) {
      if (targetChar >= sentRanges[i].start && targetChar < sentRanges[i].end) {
        ({ start: sentStart, end: sentEnd, text: sentText } = sentRanges[i]);
        sentIdx = i;
        break;
      }
    }

    const [phraseStart, phraseEnd] = findPhraseOffsets(para, sentStart, sentEnd, targetChar);
    const phraseText = para.slice(phraseStart, phraseEnd).trim();

    const newActive: ActiveToken = {
      token, paraIndex, tokIdxInPara,
      sentStart, sentEnd, phraseStart, phraseEnd,
      sentence: sentText.trim(),
      phraseText,
      sentenceBefore: sentRanges[sentIdx - 1]?.text.trim() ?? book.paragraphs[paraIndex - 1] ?? "",
      sentenceAfter: sentRanges[sentIdx + 1]?.text.trim() ?? book.paragraphs[paraIndex + 1] ?? "",
    };

    setActive(newActive);
    setAnalysis(null);
    setIsLoading(true);

    try {
      const result = await analyzeSelection({
        word: token,
        sentence: newActive.sentence,
        sentenceBefore: newActive.sentenceBefore,
        sentenceAfter: newActive.sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: profile.targetLanguage,
      });
      setAnalysis(result);
    } catch (err) {
      console.error("AI analysis failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleWordTapInPanel(word: string) {
    if (!active) return;
    const norm = normalizeToken(word);
    if (!norm) return;
    setAnalysis(null);
    setIsLoading(true);
    setIsWordModalOpen(true);
    try {
      const result = await analyzeSelection({
        word,
        sentence: active.sentence,
        sentenceBefore: active.sentenceBefore,
        sentenceAfter: active.sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: profile.targetLanguage,
      });
      setAnalysis(result);
    } catch (err) {
      console.error("Panel word tap failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddCard(type: Flashcard["type"]) {
    if (!analysis || !active) return;
    const map = {
      word:     { front: analysis.word.lemma,  back: analysis.word.translation },
      phrase:   { front: active.phraseText,    back: analysis.phrase.translation },
      sentence: { front: active.sentence,      back: analysis.sentence.translation },
    };
    const localCard: Flashcard = {
      id: `card-${Date.now()}`,
      type,
      source: book.title,
      addedAt: new Date().toISOString(),
      status: "new",
      ...map[type],
    };
    onAddCard(localCard);

    // Sync to Supabase in background
    if (user) {
      const dbId = await sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: localCard.front,
        back: localCard.back,
        source_book_title: book.title,
        selection_type: type,
        repetitions: 0,
        easiness_factor: 2.5,
        interval_days: 1,
        next_review_at: null,
        last_reviewed_at: null,
      });
      if (dbId) {
        // Update local card id to match DB
        localCard.id = dbId;
      }
    }

    showToast("✓ Карточка добавлена");
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  return (
    <div className="reader-screen">
      <header className="reader-toolbar">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div className="reader-toolbar-info">
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <span className="reader-pct">{Math.round(book.progress)}%</span>
      </header>

      <div className="reading-progress-bar">
        <div className="reading-progress-fill" style={{ width: `${book.progress}%` }} />
      </div>

      <div className="reader-content" ref={contentRef}>
        <article className="reader-text">
          {book.paragraphs.map((para, paraIndex) => {
            const isParaActive = active?.paraIndex === paraIndex;

            const tokens = splitIntoTokens(para);
            const offsets: number[] = [];
            let off = 0;
            for (const t of tokens) { offsets.push(off); off += t.length; }

            return (
              <p key={paraIndex} data-idx={paraIndex}>
                {tokens.map((token, tokIdx) => {
                  const norm = normalizeToken(token);
                  if (!norm) return <span key={tokIdx}>{token}</span>;

                  const charPos = offsets[tokIdx];
                  const isWord = isParaActive && tokIdx === active!.tokIdxInPara;
                  const inSent = isParaActive &&
                    charPos >= active!.sentStart && charPos < active!.sentEnd;
                  const isPhrase = inSent && !isWord &&
                    charPos >= active!.phraseStart && charPos < active!.phraseEnd;

                  const cls = [
                    "text-token",
                    isWord   ? "hl-word"         : "",
                    isPhrase ? "hl-phrase"       : "",
                    inSent && !isWord && !isPhrase ? "hl-sentence-tok" : "",
                  ].filter(Boolean).join(" ");

                  return (
                    <span
                      key={tokIdx}
                      role="button"
                      tabIndex={0}
                      className={cls}
                      onClick={() => void handleTokenTap(token, paraIndex, tokIdx)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleTokenTap(token, paraIndex, tokIdx); }}
                    >
                      {token}
                    </span>
                  );
                })}
              </p>
            );
          })}
        </article>
      </div>

      {active && (
        <AiPanel
          selection={active}
          analysis={analysis}
          isLoading={isLoading}
          lang={profile.targetLanguage}
          onClose={() => { setActive(null); setAnalysis(null); }}
          onOpenWordModal={() => setIsWordModalOpen(true)}
          onAddCard={(type) => void handleAddCard(type)}
          onWordTap={handleWordTapInPanel}
        />
      )}

      {analysis && (
        <WordModal
          analysis={analysis}
          isOpen={isWordModalOpen}
          isLoading={isLoading}
          lang={profile.targetLanguage}
          onClose={() => setIsWordModalOpen(false)}
          onAddCard={() => { void handleAddCard("word"); setIsWordModalOpen(false); }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
