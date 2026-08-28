"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  X,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Loader2,
  ScrollText,
  Sparkles,
  AlertCircle,
  Volume2,
  CheckCircle2,
} from "lucide-react";
import type {
  Audiobook,
  AudiobookChapter,
  AudiobookSegment,
  AudiobookTranscript,
  AiAnalysis,
  Flashcard,
  UserProfile,
  DiscussMessage,
} from "@/lib/types";
import {
  fetchAudiobookTranscript,
  findActiveSegmentIndex,
} from "@/lib/audio/transcribe";
import { splitIntoTokens, normalizeToken, findPhraseOffsets } from "@/lib/selector/text";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";
import { sbGetCachedAnalysis, sbSaveCachedAnalysis, sbInsertFlashcard } from "@/lib/db/supabase";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { formatAudioDuration } from "@/lib/audio/audiobooks";

type Tab = "word" | "phrase" | "sentence";

type Props = {
  audiobook: Audiobook;
  currentChapterIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onChapterChange: (index: number) => void;
  onClose: () => void;
  profile?: UserProfile;
  cards?: Flashcard[];
  onAddCard?: (card: Flashcard) => void;
};

export function AudiobookReadAlongModal({
  audiobook,
  currentChapterIndex,
  isPlaying,
  currentTime,
  duration,
  playbackSpeed,
  onPlayPause,
  onSeek,
  onSpeedChange,
  onChapterChange,
  onClose,
  profile,
  cards,
  onAddCard,
}: Props) {
  const [transcript, setTranscript] = useState<AudiobookTranscript | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // AI Selection & Analysis
  const [selection, setSelection] = useState<{
    token: string;
    phraseText: string;
    sentence: string;
    sentenceBefore: string;
    sentenceAfter: string;
    isCustomSentence?: boolean;
  } | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("word");

  // Sub-Modals
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [isDiscussOpen, setIsDiscussOpen] = useState(false);
  const [discussMessages, setDiscussMessages] = useState<DiscussMessage[]>([]);

  // Refs for scrolling
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeSegmentRef = useRef<HTMLDivElement | null>(null);
  const userScrolledRef = useRef(false);

  const chapters = audiobook.chapters || [];
  const currentChapter: AudiobookChapter | undefined = chapters[currentChapterIndex];
  const lang = audiobook.language || "de";
  const nativeLang = profile?.nativeLanguage || "ru";

  // Load Transcript for current chapter
  const loadTranscript = useCallback(async () => {
    if (!currentChapter || !currentChapter.audioUrl) {
      setTranscriptError("Аудиофайл главы не найден");
      setIsLoadingTranscript(false);
      return;
    }

    setIsLoadingTranscript(true);
    setTranscriptError(null);

    try {
      const data = await fetchAudiobookTranscript({
        audiobookId: audiobook.id,
        chapterIndex: currentChapterIndex,
        audioUrl: currentChapter.audioUrl,
        language: lang,
        duration: currentChapter.durationSeconds,
      });
      setTranscript(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось загрузить текст главы";
      setTranscriptError(msg);
    } finally {
      setIsLoadingTranscript(false);
    }
  }, [audiobook.id, currentChapterIndex, currentChapter, lang]);

  useEffect(() => {
    void loadTranscript();
  }, [loadTranscript]);

  // Compute active segment based on audio currentTime
  const segments = useMemo(() => transcript?.segments || [], [transcript?.segments]);
  const activeSegmentIndex = useMemo(() => {
    return findActiveSegmentIndex(segments, currentTime);
  }, [segments, currentTime]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (!autoScroll || userScrolledRef.current || !activeSegmentRef.current) return;
    activeSegmentRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeSegmentIndex, autoScroll]);

  // Reset manual scroll lock after a brief pause
  const handleScroll = () => {
    // If user manually scrolls, we allow them to read freely without jank
  };

  // Handle word tap: tokenizes, extracts context and triggers AI analysis
  const handleWordTap = async (
    token: string,
    segment: AudiobookSegment,
    segIdx: number
  ) => {
    const norm = normalizeToken(token);
    if (!norm) return;

    // Soft-pause audio while inspecting word
    if (isPlaying) {
      onPlayPause();
    }

    const sentence = segment.text;
    const sentenceBefore = segments[segIdx - 1]?.text || "";
    const sentenceAfter = segments[segIdx + 1]?.text || "";

    // Extract phrase offsets around token
    const tokenPosInSentence = sentence.indexOf(token);
    const [pStart, pEnd] =
      tokenPosInSentence >= 0
        ? findPhraseOffsets(sentence, 0, sentence.length, tokenPosInSentence)
        : [0, sentence.length];
    const phraseText = sentence.slice(pStart, pEnd).trim() || sentence;

    const newSelection = {
      token,
      phraseText,
      sentence,
      sentenceBefore,
      sentenceAfter,
    };

    setSelection(newSelection);
    setActiveTab("word");

    // Check cache
    const cacheKey = makeAiCacheKey({
      mode: "word",
      word: norm,
      sentence,
      nativeLanguage: nativeLang,
      targetLanguage: lang,
    });

    const localCached = getLocalAiAnalysis(cacheKey);
    if (localCached) {
      setAnalysis(localCached);
      return;
    }

    const sbCached = await sbGetCachedAnalysis(cacheKey);
    if (sbCached) {
      setAnalysis(sbCached);
      saveLocalAiAnalysis(cacheKey, sbCached);
      return;
    }

    // Call API
    setIsLoadingAnalysis(true);
    setAnalysis(null);

    try {
      const res = await analyzeSelection({
        mode: "word",
        word: norm,
        sentence,
        sentenceBefore,
        sentenceAfter,
        nativeLanguage: nativeLang,
        targetLanguage: lang,
      });
      setAnalysis(res);
      saveLocalAiAnalysis(cacheKey, res);
      void sbSaveCachedAnalysis(cacheKey, res);
    } catch (err) {
      console.error("Audiobook word AI analysis error:", err);
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  // Flashcard creation
  const handleAddCard = async (type: Flashcard["type"]) => {
    if (!selection) return;
    const frontText =
      type === "word"
        ? analysis?.word?.lemma || selection.token
        : type === "phrase"
        ? analysis?.phrase?.text || selection.phraseText
        : analysis?.sentence?.text || selection.sentence;

    const backText =
      type === "word"
        ? analysis?.word?.translation || ""
        : type === "phrase"
        ? analysis?.phrase?.translation || ""
        : analysis?.sentence?.translation || "";

    const newCard: Flashcard = {
      id: `card-${Date.now()}`,
      front: frontText,
      back: backText,
      type,
      contextSentence: selection.sentence,
      targetLanguage: lang,
      nativeLanguage: nativeLang,
      sourceBookTitle: audiobook.title,
      ...createDefaultSrsFields(),
    };

    if (onAddCard) {
      onAddCard(newCard);
    }
    void sbInsertFlashcard(newCard);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0f19] text-gray-100 select-text overflow-hidden animate-in fade-in duration-200">
      {/* Top Header & Floating Player */}
      <header className="sticky top-0 z-40 bg-[#111625]/95 backdrop-blur-md border-b border-gray-800/80 px-4 py-3 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-indigo-950/80 border border-indigo-700/50 flex items-center justify-center flex-shrink-0 text-indigo-400">
              <ScrollText className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-white truncate">
                {audiobook.title}
              </h2>
              <p className="text-xs text-gray-400 truncate">
                {currentChapter ? currentChapter.title : `Глава ${currentChapterIndex + 1}`}
              </p>
            </div>
          </div>

          {/* Controls: Auto-Scroll & Close */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
                autoScroll
                  ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/50"
                  : "bg-gray-800 text-gray-400 border border-gray-700"
              }`}
              title="Автоскролл за диктором"
            >
              {autoScroll ? "Автоскролл вкл" : "Автоскролл выкл"}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-gray-800 transition"
              aria-label="Закрыть режим чтения"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Audio Scrubber & Controls Bar */}
        <div className="max-w-4xl mx-auto mt-2.5 pt-2 border-t border-gray-800/60 flex flex-col gap-2">
          {/* Scrubber */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-gray-400 w-10 text-right">
              {formatAudioDuration(currentTime)}
            </span>
            <div
              className="flex-1 relative h-2 bg-gray-800 rounded-full cursor-pointer group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                onSeek(ratio * (duration || 1));
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 bg-indigo-500 rounded-full transition-all group-hover:bg-indigo-400"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-gray-400 w-10">
              {formatAudioDuration(duration)}
            </span>
          </div>

          {/* Buttons Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                disabled={currentChapterIndex <= 0}
                onClick={() => onChapterChange(currentChapterIndex - 1)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/80 disabled:opacity-30 disabled:pointer-events-none transition"
                title="Предыдущая глава"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => onSeek(Math.max(0, currentTime - 10))}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/80 transition"
                title="Назад на 10 сек"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={onPlayPause}
                className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 transition active:scale-95"
                title={isPlaying ? "Пауза" : "Воспроизведение"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                onClick={() => onSeek(Math.min(duration || 0, currentTime + 10))}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/80 transition"
                title="Вперед на 10 сек"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                disabled={currentChapterIndex >= chapters.length - 1}
                onClick={() => onChapterChange(currentChapterIndex + 1)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/80 disabled:opacity-30 disabled:pointer-events-none transition"
                title="Следующая глава"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Speed Selector */}
            <div className="flex items-center gap-1 bg-gray-900/80 p-0.5 rounded-lg border border-gray-800 text-xs">
              {[0.75, 1.0, 1.25, 1.5].map((speed) => (
                <button
                  key={speed}
                  onClick={() => onSpeedChange(speed)}
                  className={`px-2 py-0.5 rounded-md font-mono transition ${
                    playbackSpeed === speed
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content / Transcript Viewer */}
      <main
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 md:px-8 max-w-3xl mx-auto w-full pb-32"
      >
        {/* Loading State */}
        {isLoadingTranscript && (
          <div className="flex flex-col items-center justify-center min-h-[300px] text-center gap-3">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <div className="flex items-center gap-2 text-sm text-indigo-300 font-medium">
              <Sparkles className="w-4 h-4" />
              <span>Транскрибируем аудио через Gemini 3.5...</span>
            </div>
            <p className="text-xs text-gray-500 max-w-sm">
              Синхронизируем немецкий текст и таймкоды для интерактивного чтения. Это делается один раз на главу.
            </p>
          </div>
        )}

        {/* Error State */}
        {!isLoadingTranscript && transcriptError && (
          <div className="flex flex-col items-center justify-center min-h-[300px] text-center gap-3 p-6 bg-red-950/20 border border-red-800/40 rounded-2xl">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <h3 className="text-base font-semibold text-red-200">
              Не удалось загрузить текст главы
            </h3>
            <p className="text-xs text-red-300/80 max-w-md">{transcriptError}</p>
            <button
              onClick={() => void loadTranscript()}
              className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition"
            >
              Попробовать снова
            </button>
          </div>
        )}

        {/* Transcript Segments List */}
        {!isLoadingTranscript && !transcriptError && segments.length > 0 && (
          <div className="space-y-4 text-base md:text-lg leading-relaxed font-serif">
            {segments.map((segment, segIdx) => {
              const isActive = segIdx === activeSegmentIndex;
              const tokens = splitIntoTokens(segment.text);

              return (
                <div
                  key={segment.id || segIdx}
                  ref={isActive ? activeSegmentRef : null}
                  className={`group relative p-3 rounded-xl transition-all duration-300 ${
                    isActive
                      ? "bg-indigo-950/50 border-l-4 border-indigo-500 text-white shadow-md shadow-indigo-950/50"
                      : "border-l-4 border-transparent text-gray-300/90 hover:text-white hover:bg-gray-900/40"
                  }`}
                >
                  {/* Timestamp & seek button on left */}
                  <button
                    onClick={() => onSeek(segment.start)}
                    className="inline-flex items-center gap-1 mr-2 text-[11px] font-mono font-normal text-indigo-400/70 hover:text-indigo-300 opacity-60 group-hover:opacity-100 transition select-none"
                    title="Перейти к этому моменту"
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>{formatAudioDuration(segment.start)}</span>
                  </button>

                  {/* Render Words as Tappable Tokens */}
                  {tokens.map((token, tokIdx) => {
                    const norm = normalizeToken(token);
                    if (!norm) {
                      return <span key={tokIdx}>{token}</span>;
                    }

                    const isWordSelected = selection?.token === token && isActive;

                    return (
                      <span
                        key={tokIdx}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleWordTap(token, segment, segIdx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleWordTap(token, segment, segIdx);
                        }}
                        className={`inline-block px-0.5 rounded cursor-pointer transition-colors duration-150 ${
                          isWordSelected
                            ? "bg-amber-500/30 text-amber-200 underline decoration-amber-400 decoration-2"
                            : "hover:bg-indigo-500/25 hover:text-indigo-200 active:scale-95"
                        }`}
                      >
                        {token}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!isLoadingTranscript && !transcriptError && segments.length === 0 && (
          <div className="text-center py-20 text-gray-500 text-sm">
            Текст для данной аудиокниги пока пуст.
          </div>
        )}
      </main>

      {/* Interactive AI Panel (Bottom Sheet) */}
      {selection && (
        <AiPanel
          selection={selection}
          analysis={analysis}
          isLoading={isLoadingAnalysis}
          activeTab={activeTab}
          lang={lang}
          ttsProvider={profile?.ttsProvider}
          onClose={() => setSelection(null)}
          onOpenWordModal={() => setIsWordModalOpen(true)}
          onDiscuss={() => setIsDiscussOpen(true)}
          onAddCard={handleAddCard}
          onWordTap={(word) => {
            // Chained word tap from inside the panel
            const seg = segments[activeSegmentIndex] || segments[0];
            if (seg) {
              void handleWordTap(word, seg, activeSegmentIndex);
            }
          }}
          onTabChange={setActiveTab}
          onTtsProviderChange={() => {}}
        />
      )}

      {/* Word Detailed Modal */}
      {selection && (
        <WordModal
          analysis={analysis}
          isOpen={isWordModalOpen}
          isLoading={isLoadingAnalysis}
          lang={lang}
          nativeLang={nativeLang}
          selectedWord={selection.token}
          onClose={() => setIsWordModalOpen(false)}
          onAddCard={() => handleAddCard("word")}
          onWordTap={(word) => {
            setIsWordModalOpen(false);
            const seg = segments[activeSegmentIndex] || segments[0];
            if (seg) {
              void handleWordTap(word, seg, activeSegmentIndex);
            }
          }}
        />
      )}

      {/* Discuss AI Modal */}
      {selection && (
        <DiscussAiModal
          isOpen={isDiscussOpen}
          mode={activeTab === "sentence" ? "sentence" : activeTab === "phrase" ? "phrase" : "word"}
          selectedText={
            activeTab === "phrase"
              ? selection.phraseText
              : activeTab === "sentence"
              ? selection.sentence
              : selection.token
          }
          sentence={selection.sentence}
          sentenceBefore={selection.sentenceBefore}
          sentenceAfter={selection.sentenceAfter}
          nativeLanguage={nativeLang}
          targetLanguage={lang}
          messages={discussMessages}
          onMessagesChange={setDiscussMessages}
          onClose={() => setIsDiscussOpen(false)}
          onWordTap={(word, contextSentence) => {
            setIsDiscussOpen(false);
            const seg = segments[activeSegmentIndex] || segments[0];
            if (seg) {
              void handleWordTap(word, seg, activeSegmentIndex);
            }
          }}
        />
      )}
    </div>
  );
}
