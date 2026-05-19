"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookmarkCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { WordModal } from "@/components/word-modal/WordModal";
import { AudioScrubber } from "@/components/ui/AudioScrubber";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey, makeDiscussCacheKey } from "@/lib/ai/cacheKeys";
import { splitIntoTokens, normalizeToken, splitSentencesWithRanges, findPhraseOffsets } from "@/lib/selector/text";
import {
  getLocalAiAnalysis,
  getLocalDiscussHistory,
  getLocalProgressAnchor,
  getLocalReaderSelection,
  saveLocalAiAnalysis,
  saveLocalBook,
  saveLocalDiscussHistory,
  saveLocalProfile,
  saveLocalProgressAnchor,
  saveLocalReaderSelection,
} from "@/lib/db/local";
import { sbGetCachedAnalysis, sbInsertFlashcard, sbSaveCachedAnalysis, sbUpsertProgress, sbUpsertSettings } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { getTTSState, stopTTS, subscribeTTS, type TTSState } from "@/lib/tts";
import type { AiAnalysis, AiMode, Book, DiscussMessage, Flashcard, ReaderProgressSnapshot, ReaderSelectionSnapshot, UserProfile } from "@/lib/types";

const PAGE_TARGET_CHARS = 7200;
const PAGE_MAX_PARAGRAPHS = 28;

type Props = {
  book: Book;
  profile: UserProfile;
  onBack: () => void;
  onAddCard: (card: Flashcard) => void;
  onProgressUpdate: (book: Book) => void;
  onProfileChange: (profile: UserProfile) => void;
  initialProgress?: ReaderProgressSnapshot | null;
  onReaderProgressSync?: (progress: ReaderProgressSnapshot) => void;
};

type ActiveToken = {
  token: string;
  isCustomSentence?: boolean;
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

function snapshotToActive(snapshot: ReaderSelectionSnapshot): ActiveToken {
  const { mode: _mode, updatedAt: _updatedAt, ...activeToken } = snapshot;
  return activeToken;
}

function activeToSnapshot(activeToken: ActiveToken, mode: AiMode): ReaderSelectionSnapshot {
  return {
    ...activeToken,
    mode,
    updatedAt: new Date().toISOString(),
  };
}

type DragSelection = {
  paraIndex: number;
  startTokIdx: number;
  endTokIdx: number;
  isDragging: boolean;
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

export function ReaderView({
  book,
  profile,
  onBack,
  onAddCard,
  onProgressUpdate,
  onProfileChange,
  initialProgress,
  onReaderProgressSync,
}: Props) {
  const { user } = useAuth();
  const [active, setActive] = useState<ActiveToken | null>(() => (
    initialProgress?.selectionState ? snapshotToActive(initialProgress.selectionState) : null
  ));
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AiMode>(initialProgress?.selectionState?.mode ?? "word");
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [wordModalSelection, setWordModalSelection] = useState("");
  const [wordModalAnalysis, setWordModalAnalysis] = useState<AiAnalysis | null>(null);
  const [isWordModalLoading, setIsWordModalLoading] = useState(false);
  const [isDiscussOpen, setIsDiscussOpen] = useState(false);
  const [discussMessages, setDiscussMessages] = useState<DiscussMessage[]>([]);
  const [discussKey, setDiscussKey] = useState("");
  const [readingAnchor, setReadingAnchor] = useState(() => (
    initialProgress
      ? { paragraphIndex: initialProgress.paragraphIndex, charOffset: initialProgress.charOffset }
      : getLocalProgressAnchor(book.id)
  ));
  const [toast, setToast] = useState<string | null>(null);
  const [tts, setTts] = useState<TTSState>(getTTSState());
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastAutoScrollRef = useRef(0);
  const dragMovedRef = useRef(false);
  const restoredProgressKeyRef = useRef<string | null>(null);
  const pages = useMemo(() => buildReaderPages(book.paragraphs), [book.paragraphs]);
  const initialParaIndex = initialProgress?.selectionState?.paraIndex ?? initialProgress?.paragraphIndex ?? book.paragraphIndex;
  const [pageIndex, setPageIndex] = useState(() => findPageIndex(pages, initialParaIndex));
  const currentPage = pages[Math.min(pageIndex, pages.length - 1)] ?? pages[0];
  const visibleParagraphs = book.paragraphs.slice(currentPage.start, currentPage.end);
  const isReaderAudioActive = tts.status === "playing" || tts.status === "paused";

  function makeProgressRestoreKey(progress: ReaderProgressSnapshot) {
    return `${progress.bookId}:${progress.lastReadAt}:${progress.selectionState?.updatedAt ?? "anchor"}`;
  }

  useEffect(() => {
    if (initialProgress?.selectionState) return;
    setPageIndex(findPageIndex(pages, initialProgress?.paragraphIndex ?? book.paragraphIndex));
  }, [book.id, book.paragraphIndex, initialProgress?.paragraphIndex, initialProgress?.selectionState, pages]);

  useEffect(() => {
    if (initialProgress) {
      setReadingAnchor({ paragraphIndex: initialProgress.paragraphIndex, charOffset: initialProgress.charOffset });
      return;
    }
    setReadingAnchor(getLocalProgressAnchor(book.id));
  }, [book.id, initialProgress]);

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
    const scrollToToken = () => {
      const target = contentRef.current?.querySelector(
        `[data-token-id="${paraIndex}-${tokIdxInPara}"]`,
      ) as HTMLElement | null;
      scrollElementIntoReaderFocus(target, behavior);
    };

    requestAnimationFrame(scrollToToken);
    window.setTimeout(scrollToToken, 80);
    window.setTimeout(scrollToToken, 340);
  }

  function scrollElementIntoReaderFocus(target: HTMLElement | null, behavior: ScrollBehavior = "smooth") {
    if (!target) return;

    const toolbarBottom = document.querySelector(".reader-toolbar")?.getBoundingClientRect().bottom ?? 68;
    const panelTop = document.querySelector(".ai-panel")?.getBoundingClientRect().top ?? window.innerHeight;
    const safeTop = toolbarBottom + 20;
    const safeBottom = Math.max(safeTop + 120, panelTop - 22);
    const visibleCenter = safeTop + (safeBottom - safeTop) / 2;
    const rect = target.getBoundingClientRect();
    const targetCenter = rect.top + rect.height / 2;
    const delta = targetCenter - visibleCenter;

    if (Math.abs(delta) > 18) {
      window.scrollBy({ top: delta, behavior });
    }
  }

  function ensurePageForParagraph(paraIndex: number) {
    const targetPage = findPageIndex(pages, paraIndex);
    if (targetPage !== pageIndex) setPageIndex(targetPage);
  }

  function createTokenSelectionFromPosition(paraIndex: number, preferredCharOffset = 0): ActiveToken | null {
    const clampedParaIndex = Math.max(0, Math.min(book.paragraphs.length - 1, paraIndex));
    const para = book.paragraphs[clampedParaIndex] ?? "";
    const tokens = splitIntoTokens(para);
    const offsets: number[] = [];
    let off = 0;

    for (const token of tokens) {
      offsets.push(off);
      off += token.length;
    }

    let tokIdxInPara = tokens.findIndex((token, index) => normalizeToken(token) && offsets[index] >= preferredCharOffset);
    if (tokIdxInPara < 0) tokIdxInPara = tokens.findIndex((token) => normalizeToken(token));
    if (tokIdxInPara < 0) return null;

    const token = tokens[tokIdxInPara];
    const targetChar = offsets[tokIdxInPara];
    const sentRanges = splitSentencesWithRanges(para);
    let sentStart = 0;
    let sentEnd = para.length;
    let sentText = para;
    let sentIdx = 0;

    for (let i = 0; i < sentRanges.length; i++) {
      if (targetChar >= sentRanges[i].start && targetChar < sentRanges[i].end) {
        ({ start: sentStart, end: sentEnd, text: sentText } = sentRanges[i]);
        sentIdx = i;
        break;
      }
    }

    const [phraseStart, phraseEnd] = findPhraseOffsets(para, sentStart, sentEnd, targetChar);
    return {
      token,
      isCustomSentence: false,
      paraIndex: clampedParaIndex,
      tokIdxInPara,
      sentStart,
      sentEnd,
      phraseStart,
      phraseEnd,
      sentence: sentText.trim(),
      phraseText: para.slice(phraseStart, phraseEnd).trim(),
      sentenceBefore: sentRanges[sentIdx - 1]?.text.trim() ?? book.paragraphs[clampedParaIndex - 1] ?? "",
      sentenceAfter: sentRanges[sentIdx + 1]?.text.trim() ?? book.paragraphs[clampedParaIndex + 1] ?? "",
    };
  }

  const restoreSelectionSnapshot = useCallback((savedSelection: ReaderSelectionSnapshot, behavior: ScrollBehavior = "instant") => {
    const restoredActive = snapshotToActive(savedSelection);
    setActive(restoredActive);
    setActiveTab(savedSelection.mode);
    setAnalysis({});
    setReadingAnchor({ paragraphIndex: restoredActive.paraIndex, charOffset: restoredActive.sentEnd });
    setPageIndex(findPageIndex(pages, restoredActive.paraIndex));
    window.setTimeout(() => focusToken(restoredActive.paraIndex, restoredActive.tokIdxInPara, behavior), 180);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  useEffect(() => {
    const progressKey = initialProgress ? makeProgressRestoreKey(initialProgress) : `local:${book.id}`;
    if (restoredProgressKeyRef.current === progressKey) return;
    restoredProgressKeyRef.current = progressKey;

    if (initialProgress) {
      saveLocalProgressAnchor(book.id, initialProgress.paragraphIndex, initialProgress.charOffset);
      setReadingAnchor({ paragraphIndex: initialProgress.paragraphIndex, charOffset: initialProgress.charOffset });
      if (initialProgress.selectionState) {
        saveLocalReaderSelection(book.id, initialProgress.selectionState);
        restoreSelectionSnapshot(initialProgress.selectionState, "instant");
        return;
      }

      const fallback = createTokenSelectionFromPosition(initialProgress.paragraphIndex, initialProgress.charOffset);
      if (fallback) {
        setActive(fallback);
        setActiveTab("sentence");
        setAnalysis({});
        setPageIndex(findPageIndex(pages, fallback.paraIndex));
        focusToken(fallback.paraIndex, fallback.tokIdxInPara, "instant");
        return;
      }
    }

    const savedSelection = getLocalReaderSelection(book.id);
    if (savedSelection) {
      restoreSelectionSnapshot(savedSelection, "instant");
      return;
    }

    if (book.paragraphIndex <= 0) return;
    const fallback = createTokenSelectionFromPosition(book.paragraphIndex, 0);
    if (fallback) {
      setPageIndex(findPageIndex(pages, fallback.paraIndex));
      focusToken(fallback.paraIndex, fallback.tokIdxInPara, "instant");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, initialProgress, pages, restoreSelectionSnapshot]);

  useEffect(() => {
    if (tts.status !== "playing") return;
    const now = Date.now();
    if (now - lastAutoScrollRef.current < 650) return;
    const el = contentRef.current?.querySelector(".reader-karaoke-current") as HTMLElement | null;
    if (!el) return;
    lastAutoScrollRef.current = now;
    scrollElementIntoReaderFocus(el, "smooth");
  }, [tts.activeCharIndex, tts.status]);

  useEffect(() => {
    if (!dragSelection?.isDragging) return;

    const move = (event: PointerEvent) => {
      event.preventDefault();
      updateTokenDragFromPoint(event.clientX, event.clientY);
    };
    const finish = () => finishTokenDrag();

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragSelection]);

  const saveReadingAnchor = useCallback((token: ActiveToken, charOffset = token.sentEnd, mode: AiMode = activeTab) => {
    const progress = Math.round((token.paraIndex / Math.max(book.paragraphs.length - 1, 1)) * 100);
    const updated = { ...book, paragraphIndex: token.paraIndex, progress };
    const selection = activeToSnapshot(token, mode);

    saveLocalProgressAnchor(book.id, token.paraIndex, charOffset);
    saveLocalReaderSelection(book.id, selection);
    setReadingAnchor({ paragraphIndex: token.paraIndex, charOffset });
    saveLocalBook(updated);
    onProgressUpdate(updated);
    const progressSnapshot = {
      bookId: book.id,
      paragraphIndex: token.paraIndex,
      charOffset,
      percentage: progress,
      lastReadAt: selection.updatedAt,
      selectionState: selection,
    };
    restoredProgressKeyRef.current = makeProgressRestoreKey(progressSnapshot);
    onReaderProgressSync?.(progressSnapshot);

    if (user) {
      void sbUpsertProgress({
        user_id: user.id,
        book_id: book.id,
        chapter_index: 0,
        paragraph_index: token.paraIndex,
        char_offset: charOffset,
        selection_state: selection,
        scroll_pos: Math.round(window.scrollY),
        percentage: progress,
        last_read_at: new Date().toISOString(),
        total_time_ms: 0,
      });
    }
  }, [activeTab, book, user, onProgressUpdate, onReaderProgressSync]);

  function getTextForMode(token: ActiveToken, mode: AiMode) {
    if (mode === "word") return token.token;
    if (mode === "phrase") return token.phraseText;
    return token.sentence;
  }

  function handleTabChange(mode: AiMode) {
    setActiveTab(mode);
    if (!active) return;
    const selection = activeToSnapshot(active, mode);
    saveLocalReaderSelection(book.id, selection);
    const percentage = Math.round((active.paraIndex / Math.max(book.paragraphs.length - 1, 1)) * 100);
    const progressSnapshot = {
      bookId: book.id,
      paragraphIndex: active.paraIndex,
      charOffset: active.sentEnd,
      percentage,
      lastReadAt: selection.updatedAt,
      selectionState: selection,
    };
    restoredProgressKeyRef.current = makeProgressRestoreKey(progressSnapshot);
    onReaderProgressSync?.(progressSnapshot);
    if (user) {
      void sbUpsertProgress({
        user_id: user.id,
        book_id: book.id,
        chapter_index: 0,
        paragraph_index: active.paraIndex,
        char_offset: active.sentEnd,
        selection_state: selection,
        scroll_pos: Math.round(window.scrollY),
        percentage,
        last_read_at: new Date().toISOString(),
        total_time_ms: 0,
      });
    }
  }

  function mergeAnalysis(prev: AiAnalysis | null, next: AiAnalysis): AiAnalysis {
    return {
      word: next.word ?? prev?.word,
      phrase: next.phrase ?? prev?.phrase,
      sentence: next.sentence ?? prev?.sentence,
      examples: next.examples ?? prev?.examples ?? [],
    };
  }

  async function loadAnalysisForMode(token: ActiveToken, mode: AiMode) {
    const selectedText = getTextForMode(token, mode);
    const cacheKey = makeAiCacheKey(mode, selectedText, book.language, profile.nativeLanguage);

    const localCached = getLocalAiAnalysis(cacheKey);
    if (localCached) {
      setAnalysis((prev) => mergeAnalysis(prev, localCached));
      saveReadingAnchor(token);
      return;
    }

    setIsLoading(true);
    try {
      const remoteCached = await sbGetCachedAnalysis(cacheKey);
      if (remoteCached) {
        saveLocalAiAnalysis(cacheKey, remoteCached);
        setAnalysis((prev) => mergeAnalysis(prev, remoteCached));
        saveReadingAnchor(token);
        return;
      }

      const result = await analyzeSelection({
        mode,
        word: token.token,
        text: selectedText,
        sentence: token.sentence,
        sentenceBefore: token.sentenceBefore,
        sentenceAfter: token.sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: book.language,
      });

      saveLocalAiAnalysis(cacheKey, result);
      void sbSaveCachedAnalysis(cacheKey, mode, result);
      setAnalysis((prev) => mergeAnalysis(prev, result));
      saveReadingAnchor(token);
    } catch (err) {
      console.error("AI analysis failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadWordModalAnalysis(word: string, contextSentence?: string) {
    if (!active) return;
    const proxyActive: ActiveToken = {
      ...active,
      token: word,
      sentence: contextSentence || active.sentence,
      sentenceBefore: contextSentence ? "" : active.sentenceBefore,
      sentenceAfter: contextSentence ? "" : active.sentenceAfter,
    };
    const cacheKey = makeAiCacheKey("word", word, book.language, profile.nativeLanguage);

    setIsWordModalLoading(true);
    setWordModalAnalysis(null);

    try {
      const localCached = getLocalAiAnalysis(cacheKey);
      if (localCached?.word) {
        setWordModalAnalysis(localCached);
        return;
      }

      const remoteCached = await sbGetCachedAnalysis(cacheKey);
      if (remoteCached?.word) {
        saveLocalAiAnalysis(cacheKey, remoteCached);
        setWordModalAnalysis(remoteCached);
        return;
      }

      const result = await analyzeSelection({
        mode: "word",
        word,
        text: word,
        sentence: proxyActive.sentence,
        sentenceBefore: proxyActive.sentenceBefore,
        sentenceAfter: proxyActive.sentenceAfter,
        nativeLanguage: profile.nativeLanguage,
        targetLanguage: book.language,
      });

      saveLocalAiAnalysis(cacheKey, result);
      void sbSaveCachedAnalysis(cacheKey, "word", result);
      setWordModalAnalysis(result);
      setAnalysis((prev) => mergeAnalysis(prev, result));
    } catch (err) {
      console.error("Word modal analysis failed:", err);
    } finally {
      setIsWordModalLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    const hasData =
      activeTab === "word" ? Boolean(analysis?.word?.translation)
        : activeTab === "phrase" ? Boolean(analysis?.phrase?.translation)
          : Boolean(analysis?.sentence?.translation);
    if (!hasData) void loadAnalysisForMode(active, activeTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, active?.paraIndex, active?.tokIdxInPara, active?.sentence]);

  async function handleTokenTap(token: string, paraIndex: number, tokIdxInPara: number) {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    stopTTS(); // Close scrubber when selecting a new word
    
    const norm = normalizeToken(token);
    if (!norm) return;
    setWordModalSelection(token);

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
      isCustomSentence: false,
      sentStart, sentEnd, phraseStart, phraseEnd,
      sentence: sentText.trim(),
      phraseText,
      sentenceBefore: sentRanges[sentIdx - 1]?.text.trim() ?? book.paragraphs[paraIndex - 1] ?? "",
      sentenceAfter: sentRanges[sentIdx + 1]?.text.trim() ?? book.paragraphs[paraIndex + 1] ?? "",
    };

    ensurePageForParagraph(paraIndex);
    setActive(newActive);
    focusToken(paraIndex, tokIdxInPara);
    setAnalysis({});
    saveReadingAnchor(newActive, newActive.sentEnd, activeTab);
    void loadAnalysisForMode(newActive, activeTab);
  }

  async function handleTokenRangeSelection(paraIndex: number, startTokIdx: number, endTokIdx: number) {
    stopTTS();
    const para = book.paragraphs[paraIndex];
    const tokens = splitIntoTokens(para);
    const offsets: number[] = [];
    let off = 0;
    for (const token of tokens) {
      offsets.push(off);
      off += token.length;
    }

    const start = Math.min(startTokIdx, endTokIdx);
    const end = Math.max(startTokIdx, endTokIdx);
    const firstWord = tokens[start];
    const selectedText = tokens.slice(start, end + 1).join("").trim();
    if (!normalizeToken(firstWord) || !selectedText) return;

    const sentStart = offsets[start];
    const sentEnd = offsets[end] + tokens[end].length;
    const newActive: ActiveToken = {
      token: firstWord,
      isCustomSentence: true,
      paraIndex,
      tokIdxInPara: start,
      sentStart,
      sentEnd,
      phraseStart: sentStart,
      phraseEnd: sentEnd,
      sentence: selectedText,
      phraseText: selectedText,
      sentenceBefore: para.slice(0, sentStart).trim() || book.paragraphs[paraIndex - 1] || "",
      sentenceAfter: para.slice(sentEnd).trim() || book.paragraphs[paraIndex + 1] || "",
    };

    ensurePageForParagraph(paraIndex);
    setActive(newActive);
    setActiveTab("sentence");
    setAnalysis({});
    focusToken(paraIndex, start);
    saveReadingAnchor(newActive, newActive.sentEnd, "sentence");
    void loadAnalysisForMode(newActive, "sentence");
  }

  function startTokenDrag(paraIndex: number, tokIdxInPara: number) {
    dragMovedRef.current = false;
    setDragSelection({ paraIndex, startTokIdx: tokIdxInPara, endTokIdx: tokIdxInPara, isDragging: true });
  }

  function enterTokenDrag(paraIndex: number, tokIdxInPara: number) {
    setDragSelection((prev) => {
      if (!prev?.isDragging || prev.paraIndex !== paraIndex) return prev;
      if (prev.endTokIdx !== tokIdxInPara) dragMovedRef.current = true;
      return { ...prev, endTokIdx: tokIdxInPara };
    });
  }

  function updateTokenDragFromPoint(clientX: number, clientY: number) {
    const tokenEl = document
      .elementFromPoint(clientX, clientY)
      ?.closest("[data-para-index][data-token-index]") as HTMLElement | null;

    if (!tokenEl) return;
    const paraIndex = Number(tokenEl.dataset.paraIndex);
    const tokIdx = Number(tokenEl.dataset.tokenIndex);
    if (!Number.isFinite(paraIndex) || !Number.isFinite(tokIdx)) return;
    enterTokenDrag(paraIndex, tokIdx);
  }

  function finishTokenDrag() {
    const selection = dragSelection;
    setDragSelection(null);
    if (!selection?.isDragging) return;
    if (selection.startTokIdx === selection.endTokIdx) return;
    dragMovedRef.current = true;
    void handleTokenRangeSelection(selection.paraIndex, selection.startTokIdx, selection.endTokIdx);
  }

  async function handleWordTapInPanel(word: string, contextSentence?: string) {
    stopTTS(); // Close scrubber when opening a new word
    if (!active) return;
    const norm = normalizeToken(word);
    if (!norm) return;
    setWordModalSelection(word);
    setIsWordModalOpen(true);
    void loadWordModalAnalysis(word, contextSentence);
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
    stopTTS();

    const best = target.start;
    const fallback = createTokenSelectionFromPosition(best, 0);
    const anchorParaIndex = fallback?.paraIndex ?? best;
    const anchorCharOffset = fallback?.sentEnd ?? 0;
    const progress = Math.round((anchorParaIndex / Math.max(book.paragraphs.length - 1, 1)) * 100);
    const updated = { ...book, paragraphIndex: best, progress };
    setPageIndex(clamped);
    setAnalysis({});
    saveLocalProgressAnchor(book.id, anchorParaIndex, anchorCharOffset);
    saveLocalBook(updated);
    onProgressUpdate(updated);

    if (fallback) {
      setActive(fallback);
      setActiveTab("sentence");
      saveReadingAnchor(fallback, anchorCharOffset, "sentence");
      focusToken(fallback.paraIndex, fallback.tokIdxInPara, "smooth");
      return;
    }

    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  async function handleAddCard(type: Flashcard["type"]) {
    if (!analysis || !active) return;
    const map = {
      word:     { front: active.token,         back: analysis.word?.translation ?? "" },
      phrase:   { front: active.phraseText,    back: analysis.phrase?.translation ?? "" },
      sentence: { front: active.sentence,      back: analysis.sentence?.translation ?? "" },
    };
    if (!map[type].back) return;
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

  function handleSetManualAnchor() {
    if (active) {
      saveReadingAnchor(active);
      showToast("✓ Якорь сохранен");
      return;
    }

    const fallback = createTokenSelectionFromPosition(currentPage.start, 0);
    if (!fallback) return;
    setActive(fallback);
    setActiveTab("sentence");
    setAnalysis({});
    saveReadingAnchor(fallback, fallback.sentEnd, "sentence");
    focusToken(fallback.paraIndex, fallback.tokIdxInPara);
    showToast("✓ Якорь сохранен");
  }

  async function handleTtsProviderChange(provider: NonNullable<UserProfile["ttsProvider"]>) {
    const updated = { ...profile, ttsProvider: provider };
    saveLocalProfile(updated);
    onProfileChange(updated);

    if (user) {
      await sbUpsertSettings({
        user_id: user.id,
        native_language: updated.nativeLanguage,
        active_target_lang: updated.targetLanguage,
        ui_language: updated.uiLanguage,
        tts_provider: updated.ttsProvider ?? "local",
        reading_minutes: updated.readingMinutes,
        books_started: updated.booksStarted,
        books_finished: updated.booksFinished,
        updated_at: new Date().toISOString(),
      });
    }
  }

  function openDiscuss() {
    if (!active) return;
    const selectedText = getTextForMode(active, activeTab);
    const key = makeDiscussCacheKey(activeTab, selectedText, book.language, profile.nativeLanguage);
    const history = getLocalDiscussHistory(key);
    setDiscussKey(key);
    setDiscussMessages(history);
    setIsDiscussOpen(true);
  }

  function handleDiscussMessagesChange(messages: DiscussMessage[]) {
    setDiscussMessages(messages);
    if (discussKey) saveLocalDiscussHistory(discussKey, messages);
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
    <div className={`reader-screen${isReaderAudioActive ? " audio-active" : ""}`}>
      <header className="reader-toolbar">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div className="reader-toolbar-info">
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <button className="icon-btn" onClick={handleSetManualAnchor} type="button" aria-label="Сохранить якорь прочитанного">
          <BookmarkCheck size={18} />
        </button>
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
          <div
            className={`reader-token-layer${dragSelection?.isDragging ? " is-selecting" : ""}`}
            onPointerUp={finishTokenDrag}
            onPointerCancel={() => setDragSelection(null)}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse" && dragSelection?.isDragging) finishTokenDrag();
            }}
          >
          {visibleParagraphs.map((para, localIndex) => {
            const paraIndex = currentPage.start + localIndex;
            const isParaActive = active?.paraIndex === paraIndex;

            const tokens = splitIntoTokens(para);
            const offsets: number[] = [];
            let off = 0;
            for (const t of tokens) { offsets.push(off); off += t.length; }
            const anchorTokenIndex = readingAnchor.paragraphIndex === paraIndex
              ? tokens.reduce((last, token, index) => (
                  normalizeToken(token) && offsets[index] < readingAnchor.charOffset ? index : last
                ), -1)
              : -1;

            return (
              <p key={paraIndex} data-idx={paraIndex}>
                {tokens.map((token, tokIdx) => {
                  const norm = normalizeToken(token);
                  if (!norm) return <span key={tokIdx}>{token}</span>;

                  const charPos = offsets[tokIdx];
                  const inSent = isParaActive &&
                    charPos >= active!.sentStart && charPos < active!.sentEnd;
                  const inPhrase = inSent &&
                    charPos >= active!.phraseStart && charPos < active!.phraseEnd;
                  const isWord = activeTab === "word" && isParaActive && tokIdx === active!.tokIdxInPara;
                  const isPhrase = (activeTab === "word" || activeTab === "phrase") && inPhrase && !isWord;
                  const isSentence = inSent && (
                    activeTab === "sentence" ||
                    (activeTab === "phrase" && !isPhrase) ||
                    (activeTab === "word" && !isWord && !isPhrase)
                  );
                  const isDragged = dragSelection?.paraIndex === paraIndex &&
                    tokIdx >= Math.min(dragSelection.startTokIdx, dragSelection.endTokIdx) &&
                    tokIdx <= Math.max(dragSelection.startTokIdx, dragSelection.endTokIdx);

                  const cls = [
                    "text-token",
                    isWord   ? "hl-word"         : "",
                    isPhrase ? "hl-phrase"       : "",
                    isSentence ? "hl-sentence-tok" : "",
                    isDragged ? "hl-drag-selection" : "",
                    getTokenKaraokeClass(paraIndex, charPos, charPos + token.length, tokIdx),
                  ].filter(Boolean).join(" ");

                  return (
                    <span key={tokIdx} className="reader-token-wrap">
                      <span
                        data-token-id={`${paraIndex}-${tokIdx}`}
                        data-para-index={paraIndex}
                        data-token-index={tokIdx}
                        role="button"
                        tabIndex={0}
                        className={cls}
                        onPointerDown={(event) => {
                          if (event.pointerType === "mouse" && event.button !== 0) return;
                          startTokenDrag(paraIndex, tokIdx);
                          updateTokenDragFromPoint(event.clientX, event.clientY);
                        }}
                        onPointerEnter={() => enterTokenDrag(paraIndex, tokIdx)}
                        onClick={() => void handleTokenTap(token, paraIndex, tokIdx)}
                        onKeyDown={(e) => { if (e.key === "Enter") void handleTokenTap(token, paraIndex, tokIdx); }}
                      >
                        {token}
                      </span>
                      {tokIdx === anchorTokenIndex && (
                        <span className="reader-anchor-marker" title="Якорь прочитанного" aria-label="Якорь прочитанного">
                          <BookmarkCheck size={12} />
                        </span>
                      )}
                    </span>
                  );
                })}
              </p>
            );
          })}
          </div>
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
          activeTab={activeTab}
          lang={book.language}
          ttsProvider={profile.ttsProvider}
          onClose={() => { setActive(null); setAnalysis(null); }}
          onOpenWordModal={() => {
            setWordModalSelection(active.token);
            setIsWordModalOpen(true);
            void loadWordModalAnalysis(active.token);
          }}
          onDiscuss={openDiscuss}
          onAddCard={(type) => void handleAddCard(type)}
          onWordTap={handleWordTapInPanel}
          onTabChange={handleTabChange}
          onTtsProviderChange={(provider) => void handleTtsProviderChange(provider)}
          onNext={handleNextToken}
          onPrev={handlePrevToken}
        />
      )}

      {active && (
        <DiscussAiModal
          isOpen={isDiscussOpen}
          mode={activeTab}
          selectedText={getTextForMode(active, activeTab)}
          sentence={active.sentence}
          sentenceBefore={active.sentenceBefore}
          sentenceAfter={active.sentenceAfter}
          nativeLanguage={profile.nativeLanguage}
          targetLanguage={book.language}
          messages={discussMessages}
          onMessagesChange={handleDiscussMessagesChange}
          onClose={() => setIsDiscussOpen(false)}
          onWordTap={(word, context) => void handleWordTapInPanel(word, context)}
        />
      )}

      <WordModal
        analysis={wordModalAnalysis}
        isOpen={isWordModalOpen}
        isLoading={isWordModalLoading}
        lang={book.language}
        selectedWord={wordModalSelection || active?.token || ""}
        onClose={() => {
          setIsWordModalOpen(false);
          setWordModalAnalysis(null);
          setWordModalSelection("");
        }}
        onAddCard={() => { void handleAddCard("word"); setIsWordModalOpen(false); }}
        onWordTap={(word, context) => void handleWordTapInPanel(word, context)}
      />

      <AudioScrubber />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
