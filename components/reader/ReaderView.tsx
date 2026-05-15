"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { AudioScrubber } from "@/components/ui/AudioScrubber";
import { analyzeSelection } from "@/lib/ai/analyze";
import { splitIntoTokens, normalizeToken, splitSentencesWithRanges, findPhraseOffsets } from "@/lib/selector/text";
import { saveLocalProgress, saveLocalBook } from "@/lib/db/local";
import { sbUpsertProgress, sbInsertFlashcard, sbGetCachedWord, sbSaveCachedWord } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { APP_CONFIG } from "@/lib/config";
import { getTTSState, stopTTS, subscribeTTS, type TTSState } from "@/lib/tts";
import type { AiAnalysis, Book, Flashcard, UserProfile } from "@/lib/types";

const PAGE_TARGET_CHARS = 7200;
const PAGE_MAX_PARAGRAPHS = 28;

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

type ReaderPage = {
  start: number;
  end: number;
};

function buildReaderPages(paragraphs: string[]): ReaderPage[] {
  const pages: ReaderPage[] = [];
  let start = 0;
  let chars = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    chars += paragraphs[i].length;
    const count = i - start + 1;
    const shouldCut = chars >= PAGE_TARGET_CHARS || count >= PAGE_MAX_PARAGRAPHS;

    if (shouldCut && i >= start) {
      pages.push({ start, end: i + 1 });
      start = i + 1;
      chars = 0;
    }
  }

  if (start < paragraphs.length) pages.push({ start, end: paragraphs.length });
  return pages.length ? pages : [{ start: 0, end: 0 }];
}

function findPageIndex(pages: ReaderPage[], paraIndex: number) {
  const idx = pages.findIndex((page) => paraIndex >= page.start && paraIndex < page.end);
  return Math.max(0, idx);
}

export function ReaderView({ book, profile, onBack, onAddCard, onProgressUpdate }: Props) {
  const { user } = useAuth();
  const [active, setActive] = useState<ActiveToken | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tts, setTts] = useState<TTSState>(getTTSState());
  const contentRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoScrollRef = useRef(0);
  const sentenceCacheRef = useRef<Record<string, any>>({});
  const phraseCacheRef = useRef<Record<string, any>>({});
  const pages = useMemo(() => buildReaderPages(book.paragraphs), [book.paragraphs]);
  const [pageIndex, setPageIndex] = useState(() => findPageIndex(pages, book.paragraphIndex));
  const currentPage = pages[Math.min(pageIndex, pages.length - 1)] ?? pages[0];
  const visibleParagraphs = book.paragraphs.slice(currentPage.start, currentPage.end);

  useEffect(() => {
    setPageIndex(findPageIndex(pages, book.paragraphIndex));
  }, [book.id, book.paragraphIndex, pages]);

  useEffect(() => {
    let unmounted = false;
    let localState = getTTSState();
    let frame: number | null = null;

    const unsubscribe = subscribeTTS((state) => {
      localState = state;
      if (!unmounted) setTts(state);
    });

    const tick = () => {
      if (!unmounted && localState.status === "playing") setTts(getTTSState());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      unmounted = true;
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  function focusToken(paraIndex: number, tokIdxInPara: number, behavior: ScrollBehavior = "smooth") {
    window.setTimeout(() => {
      const target = contentRef.current?.querySelector(
        `[data-token-id="${paraIndex}-${tokIdxInPara}"]`,
      ) as HTMLElement | null;
      target?.scrollIntoView({ behavior, block: "center", inline: "nearest" });
    }, 40);
  }

  function ensurePageForParagraph(paraIndex: number) {
    const targetPage = findPageIndex(pages, paraIndex);
    if (targetPage !== pageIndex) setPageIndex(targetPage);
  }

  // Scroll to last read paragraph on mount
  useEffect(() => {
    if (book.paragraphIndex <= 0) return;
    const t = setTimeout(() => {
      const el = contentRef.current?.querySelector(`p[data-idx="${book.paragraphIndex}"]`);
      el?.scrollIntoView({ behavior: "instant", block: "start" });
    }, 200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tts.status !== "playing") return;
    const now = Date.now();
    if (now - lastAutoScrollRef.current < 650) return;
    const el = contentRef.current?.querySelector(".reader-karaoke-current") as HTMLElement | null;
    if (!el) return;
    lastAutoScrollRef.current = now;
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [tts.activeCharIndex, tts.status]);

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
    stopTTS(); // Close scrubber when selecting a new word
    
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

    ensurePageForParagraph(paraIndex);
    setActive(newActive);
    focusToken(paraIndex, tokIdxInPara);
    
    if (analysis && newActive.sentence === active?.sentence) {
      // Keep sentence analysis, but clear word to show shimmer
      const optimisticAnalysis = { ...analysis };
      optimisticAnalysis.word = { ...analysis.word, translation: "", explanation: "" };
      
      if (newActive.phraseText !== active?.phraseText) {
        optimisticAnalysis.phrase = { ...analysis.phrase, translation: "", explanation: "" };
      }
      setAnalysis(optimisticAnalysis);
    } else {
      setAnalysis(null);
    }
    
    setIsLoading(true);

    try {
      const cachedWord = await sbGetCachedWord(token, book.language, profile.nativeLanguage);
      const existingSentenceData = sentenceCacheRef.current[newActive.sentence];
      const phraseKey = `${newActive.sentence}_${token}`;
      const existingPhraseData = phraseCacheRef.current[phraseKey];

      if (cachedWord && (cachedWord.examples?.length ?? 0) >= 5) {
        setAnalysis({
          ...cachedWord,
          sentence: existingSentenceData || cachedWord.sentence,
          phrase: existingPhraseData || cachedWord.phrase,
        });
        setIsLoading(false);
        return;
      }

      const skipWord = false;
      const skipSentence = !!existingSentenceData;

      const result = await analyzeSelection({
        word: token,
        sentence: newActive.sentence,
        sentenceBefore: newActive.sentenceBefore,
        sentenceAfter: newActive.sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: book.language,
        skipWord,
        skipSentence,
      }) as Partial<AiAnalysis>;

      const finalAnalysis: AiAnalysis = {
        word: result.word!,
        phrase: result.phrase || existingPhraseData,
        sentence: existingSentenceData || result.sentence!,
        examples: result.examples || [],
      };

      setAnalysis(finalAnalysis);
      sentenceCacheRef.current[newActive.sentence] = finalAnalysis.sentence;
      phraseCacheRef.current[phraseKey] = finalAnalysis.phrase;

      void sbSaveCachedWord(token, book.language, profile.nativeLanguage, finalAnalysis);
    } catch (err) {
      console.error("AI analysis failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleWordTapInPanel(word: string, contextSentence?: string) {
    stopTTS(); // Close scrubber when opening a new word
    if (!active) return;
    const norm = normalizeToken(word);
    if (!norm) return;

    const sentenceToUse = contextSentence || active.sentence;
    const sentenceBefore = contextSentence ? "" : active.sentenceBefore;
    const sentenceAfter = contextSentence ? "" : active.sentenceAfter;

    // Check cache first to avoid flicker and latency
    const cachedWord = await sbGetCachedWord(word, book.language, profile.nativeLanguage);
    const existingSentenceData = sentenceCacheRef.current[sentenceToUse] || (sentenceToUse === active.sentence ? analysis?.sentence : null);
    const phraseKey = `${sentenceToUse}_${word}`;
    const existingPhraseData = phraseCacheRef.current[phraseKey];

    // Pre-load the modal and set state before waiting, eliminating "lag" perception
    setIsWordModalOpen(true);

    if (cachedWord && (cachedWord.examples?.length ?? 0) >= 5) {
      setAnalysis({
        ...cachedWord,
        sentence: existingSentenceData || cachedWord.sentence,
        phrase: existingPhraseData || cachedWord.phrase,
      });
      setIsLoading(false);
      return;
    }

    if (analysis) {
      const optimisticAnalysis = { ...analysis };
      optimisticAnalysis.word = { ...analysis.word, translation: "", explanation: "" };
      if (sentenceToUse === active?.sentence) {
        optimisticAnalysis.phrase = { ...analysis.phrase, translation: "", explanation: "" };
      }
      setAnalysis(optimisticAnalysis);
    }
    
    setIsLoading(true);

    try {
      const skipWord = false;
      const skipSentence = !!existingSentenceData;

      const result = await analyzeSelection({
        word,
        sentence: sentenceToUse,
        sentenceBefore,
        sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: book.language,
        skipWord,
        skipSentence,
      }) as Partial<AiAnalysis>;

      const finalAnalysis: AiAnalysis = {
        word: result.word!,
        phrase: result.phrase || existingPhraseData,
        sentence: existingSentenceData || result.sentence!,
        examples: result.examples || [],
      };

      setAnalysis(finalAnalysis);
      sentenceCacheRef.current[sentenceToUse] = finalAnalysis.sentence;
      phraseCacheRef.current[phraseKey] = finalAnalysis.phrase;

      void sbSaveCachedWord(word, book.language, profile.nativeLanguage, finalAnalysis);
    } catch (err) {
      console.error("Panel word tap failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleNextToken(level: "word" | "phrase" | "sentence" = "word") {
    if (!active) return;
    let { paraIndex, tokIdxInPara } = active;
    
    let minCharIndex = -1;
    if (level === "phrase") minCharIndex = active.phraseEnd;
    else if (level === "sentence") minCharIndex = active.sentEnd;

    // search in current paragraph
    let tokens = splitIntoTokens(book.paragraphs[paraIndex]);
    let offsets: number[] = [];
    let off = 0;
    for (const t of tokens) { offsets.push(off); off += t.length; }

    for (let i = tokIdxInPara + 1; i < tokens.length; i++) {
      if (normalizeToken(tokens[i]) && (level === "word" || offsets[i] >= minCharIndex)) {
        void handleTokenTap(tokens[i], paraIndex, i);
        return;
      }
    }
    // search in next paragraphs
    for (let p = paraIndex + 1; p < book.paragraphs.length; p++) {
      tokens = splitIntoTokens(book.paragraphs[p]);
      for (let i = 0; i < tokens.length; i++) {
        if (normalizeToken(tokens[i])) {
          void handleTokenTap(tokens[i], p, i);
          return;
        }
      }
    }
  }

  function handlePrevToken(level: "word" | "phrase" | "sentence" = "word") {
    if (!active) return;
    let { paraIndex, tokIdxInPara } = active;
    
    let maxCharIndex = Infinity;
    if (level === "phrase") maxCharIndex = active.phraseStart;
    else if (level === "sentence") maxCharIndex = active.sentStart;

    // search in current paragraph
    let tokens = splitIntoTokens(book.paragraphs[paraIndex]);
    let offsets: number[] = [];
    let off = 0;
    for (const t of tokens) { offsets.push(off); off += t.length; }

    for (let i = tokIdxInPara - 1; i >= 0; i--) {
      if (normalizeToken(tokens[i]) && (level === "word" || offsets[i] < maxCharIndex)) {
        if (level !== "word") {
          const sentRanges = splitSentencesWithRanges(book.paragraphs[paraIndex]);
          let targetSent = sentRanges.find(r => offsets[i] >= r.start && offsets[i] < r.end);
          if (targetSent) {
            let startChar = level === "sentence" ? targetSent.start : findPhraseOffsets(book.paragraphs[paraIndex], targetSent.start, targetSent.end, offsets[i])[0];
            for (let j = 0; j <= i; j++) {
              if (normalizeToken(tokens[j]) && offsets[j] >= startChar) {
                void handleTokenTap(tokens[j], paraIndex, j);
                return;
              }
            }
          }
        }
        void handleTokenTap(tokens[i], paraIndex, i);
        return;
      }
    }
    // search in previous paragraphs
    for (let p = paraIndex - 1; p >= 0; p--) {
      tokens = splitIntoTokens(book.paragraphs[p]);
      let localOffsets: number[] = [];
      let o = 0;
      for (const t of tokens) { localOffsets.push(o); o += t.length; }

      for (let i = tokens.length - 1; i >= 0; i--) {
        if (normalizeToken(tokens[i])) {
          if (level !== "word") {
            const sentRanges = splitSentencesWithRanges(book.paragraphs[p]);
            let targetSent = sentRanges.find(r => localOffsets[i] >= r.start && localOffsets[i] < r.end);
            if (targetSent) {
              let startChar = level === "sentence" ? targetSent.start : findPhraseOffsets(book.paragraphs[p], targetSent.start, targetSent.end, localOffsets[i])[0];
              for (let j = 0; j <= i; j++) {
                if (normalizeToken(tokens[j]) && localOffsets[j] >= startChar) {
                  void handleTokenTap(tokens[j], p, j);
                  return;
                }
              }
            }
          }
          void handleTokenTap(tokens[i], p, i);
          return;
        }
      }
    }
  }

  function goToPage(nextIndex: number) {
    const clamped = Math.max(0, Math.min(pages.length - 1, nextIndex));
    const target = pages[clamped];
    setPageIndex(clamped);
    setActive(null);
    setAnalysis(null);
    stopTTS();

    const best = target.start;
    const progress = Math.round((best / Math.max(book.paragraphs.length - 1, 1)) * 100);
    const updated = { ...book, paragraphIndex: best, progress };
    saveLocalProgress(book.id, best);
    saveLocalBook(updated);
    onProgressUpdate(updated);

    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  async function handleAddCard(type: Flashcard["type"]) {
    if (!analysis || !active) return;
    const map = {
      word:     { front: active.token,         back: analysis.word.translation },
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

  function getTokenKaraokeClass(paraIndex: number, tokenStart: number, tokenEnd: number, tokIdx: number) {
    if (!active || active.paraIndex !== paraIndex) return "";
    if (tts.status !== "playing" && tts.status !== "paused") return "";
    if (tts.activeCharIndex === undefined || tts.activeCharIndex < 0) return "";

    let baseStart = -1;
    let text = "";
    if (tts.text === active.sentence) {
      baseStart = active.sentStart;
      text = active.sentence;
    } else if (tts.text === active.phraseText) {
      baseStart = active.phraseStart;
      text = active.phraseText;
    } else if (tts.text === active.token && tokIdx === active.tokIdxInPara) {
      return "karaoke-spoken reader-karaoke-current";
    }

    if (baseStart < 0 || !text) return "";

    const spokenAbs = baseStart + Math.min(tts.activeCharIndex, text.length - 1);
    if (tokenEnd <= baseStart || tokenStart >= baseStart + text.length) return "";
    if (tokenStart <= spokenAbs && tokenEnd >= spokenAbs) return "karaoke-spoken reader-karaoke-current";
    if (tokenStart < spokenAbs) return "karaoke-spoken";
    return "";
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
          {pageIndex === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px 60px", marginBottom: "40px", borderBottom: "1px solid var(--border)" }}>
            <div 
              style={{
                width: 140,
                height: 210,
                margin: "0 auto 24px",
                borderRadius: 8,
                boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.8)",
                fontSize: "2rem",
                fontWeight: "bold",
                ...(book.coverUrl 
                  ? { backgroundImage: `url(${book.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" } 
                  : { background: book.coverColor })
              }}
            >
              {!book.coverUrl && book.language.toUpperCase()}
            </div>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "8px", color: "var(--text-primary)" }}>
              {book.title}
            </h1>
            <p style={{ fontSize: "1.25rem", color: "var(--text-muted)" }}>
              {book.author}
            </p>
          </div>
          )}
          {visibleParagraphs.map((para, localIndex) => {
            const paraIndex = currentPage.start + localIndex;
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
                    getTokenKaraokeClass(paraIndex, charPos, charPos + token.length, tokIdx),
                  ].filter(Boolean).join(" ");

                  return (
                    <span
                      key={tokIdx}
                      data-token-id={`${paraIndex}-${tokIdx}`}
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
          <div className="reader-page-controls">
            <button
              className="mini-btn"
              type="button"
              disabled={pageIndex <= 0}
              onClick={() => goToPage(pageIndex - 1)}
            >
              <ChevronLeft size={15} />
              Назад
            </button>
            <span>Страница {pageIndex + 1} из {pages.length}</span>
            <button
              className="mini-btn"
              type="button"
              disabled={pageIndex >= pages.length - 1}
              onClick={() => goToPage(pageIndex + 1)}
            >
              Вперёд
              <ChevronRight size={15} />
            </button>
          </div>
        </article>
      </div>

      {active && (
        <AiPanel
          selection={active}
          analysis={analysis}
          isLoading={isLoading}
          lang={book.language}
          onClose={() => { setActive(null); setAnalysis(null); }}
          onOpenWordModal={() => setIsWordModalOpen(true)}
          onAddCard={(type) => void handleAddCard(type)}
          onWordTap={handleWordTapInPanel}
          onNext={handleNextToken}
          onPrev={handlePrevToken}
        />
      )}

      {analysis && (
        <WordModal
          analysis={analysis}
          isOpen={isWordModalOpen}
          isLoading={isLoading}
          lang={book.language}
          selectedWord={active?.token ?? analysis.word.text}
          onClose={() => setIsWordModalOpen(false)}
          onAddCard={() => { void handleAddCard("word"); setIsWordModalOpen(false); }}
          onWordTap={(word, context) => void handleWordTapInPanel(word, context)}
        />
      )}

      <AudioScrubber />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
