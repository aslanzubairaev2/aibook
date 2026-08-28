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
  AlertCircle,
  Volume2,
} from "lucide-react";
import type {
  Audiobook,
  AudiobookChapter,
  AudiobookSegment,
  AudiobookTranscript,
  AiAnalysis,
  Flashcard,
  DiscussMessage,
} from "@/lib/types";
import {
  fetchAudiobookTranscript,
  findActiveSegmentIndex,
} from "@/lib/audio/transcribe";
import { splitIntoTokens, normalizeToken, findPhraseOffsets } from "@/lib/selector/text";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import {
  getLocalAiAnalysis,
  saveLocalAiAnalysis,
  getLocalGeminiKey,
  saveLocalGeminiKey,
  saveLocalAiProvider,
} from "@/lib/db/local";
import { sbGetCachedAnalysis, sbSaveCachedAnalysis } from "@/lib/db/supabase";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { WordModal } from "@/components/word-modal/WordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { formatAudioDuration } from "@/lib/audio/audiobooks";

type Tab = "word" | "phrase" | "sentence";

const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

type Props = {
  audiobook: Audiobook;
  currentChapterIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  nativeLanguage: string;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onChapterChange: (index: number) => void;
  onClose: () => void;
  onAddWordCard?: (front: string, back: string, type: "word" | "phrase") => void;
};

export function AudiobookReadAlongModal({
  audiobook,
  currentChapterIndex,
  isPlaying,
  currentTime,
  duration,
  playbackSpeed,
  nativeLanguage,
  onPlayPause,
  onSeek,
  onSpeedChange,
  onChapterChange,
  onClose,
  onAddWordCard,
}: Props) {
  const [transcript, setTranscript] = useState<AudiobookTranscript | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [customKey, setCustomKey] = useState("");

  const handleSaveCustomKey = () => {
    const trimmed = customKey.trim();
    if (!trimmed) return;
    saveLocalGeminiKey(trimmed);
    saveLocalAiProvider("custom");
    void loadTranscript();
  };

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

  const chapters = audiobook.chapters || [];
  const currentChapter: AudiobookChapter | undefined = chapters[currentChapterIndex];
  const lang = audiobook.language || "de";
  const nativeLang = nativeLanguage || "ru";

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
    if (!autoScroll || !activeSegmentRef.current) return;
    activeSegmentRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeSegmentIndex, autoScroll]);

  const cyclePlaybackSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextSpeed = PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length];
    onSpeedChange(nextSpeed);
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
    const cacheKey = makeAiCacheKey("word", norm, lang, nativeLang);

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
    if (!selection || !onAddWordCard) return;
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

    onAddWordCard(frontText, backText, type === "sentence" ? "phrase" : type);
  };

  return (
    <div className="read-along-backdrop" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="read-along-modal">
        {/* Top Header */}
        <div className="read-along-header">
          <div className="read-along-title-block">
            <strong>{audiobook.title}</strong>
            <span>{currentChapter?.title || `Глава ${currentChapterIndex + 1}`}</span>
          </div>

          <div className="read-along-header-actions">
            <button
              type="button"
              className={`read-along-autoscroll-btn ${autoScroll ? "active" : ""}`}
              onClick={() => setAutoScroll((prev) => !prev)}
            >
              {autoScroll ? "Автоскролл вкл" : "Автоскролл выкл"}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="icon-btn modal-close"
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Audio Scrubber & Controls Bar */}
        <div className="read-along-player-bar">
          <div className="read-along-scrubber-row">
            <span className="read-along-time-label">{formatAudioDuration(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || currentChapter?.durationSeconds || 100}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="audio-seek-slider"
            />
            <span className="read-along-time-label">
              {formatAudioDuration(duration || currentChapter?.durationSeconds || 0)}
            </span>
          </div>

          <div className="read-along-controls-row">
            <button
              type="button"
              className="audio-speed-btn"
              onClick={cyclePlaybackSpeed}
              title="Скорость воспроизведения"
            >
              {playbackSpeed}x
            </button>

            <div className="audio-main-controls">
              <button
                type="button"
                className="audio-btn-control"
                onClick={() => onChapterChange(Math.max(0, currentChapterIndex - 1))}
                disabled={currentChapterIndex === 0 && currentTime <= 5}
                title="Предыдущая глава"
              >
                <SkipBack size={18} />
              </button>

              <button
                type="button"
                className="audio-btn-control"
                onClick={() => onSeek(Math.max(0, currentTime - 15))}
                title="Назад на 15 сек"
              >
                <RotateCcw size={18} />
              </button>

              <button
                type="button"
                className="audio-btn-play"
                onClick={onPlayPause}
                aria-label={isPlaying ? "Пауза" : "Воспроизведение"}
              >
                {isPlaying ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: "2px" }} />}
              </button>

              <button
                type="button"
                className="audio-btn-control"
                onClick={() => onSeek(Math.min(duration || 0, currentTime + 15))}
                title="Вперед на 15 сек"
              >
                <RotateCw size={18} />
              </button>

              <button
                type="button"
                className="audio-btn-control"
                onClick={() => onChapterChange(currentChapterIndex + 1)}
                disabled={currentChapterIndex >= chapters.length - 1}
                title="Следующая глава"
              >
                <SkipForward size={18} />
              </button>
            </div>

            <div style={{ width: "36px" }} />
          </div>
        </div>

        {/* Main Content Area */}
        {isLoadingTranscript ? (
          <div className="read-along-state-box">
            <Loader2 size={36} className="spin" style={{ color: "var(--accent)" }} />
            <strong>Синхронизируем текст через Gemini 3.5 Transcribe...</strong>
            <p>
              Распознаем оригинальную речь диктора и сопоставляем временные метки предложений.
              Транскрипт сохраняется в кэш для мгновенного доступа в будущем.
            </p>
          </div>
        ) : transcriptError ? (
          <div className="read-along-state-box">
            <AlertCircle size={36} style={{ color: "#e57373" }} />
            <strong>Не удалось загрузить текст главы</strong>
            <p>{transcriptError}</p>

            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px", width: "min(100%, 380px)" }}>
              <input
                type="password"
                placeholder="Вставьте Gemini API ключ (AIzaSy...)"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "rgba(240, 230, 211, 0.05)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontFamily: "monospace",
                  textAlign: "center",
                }}
              />
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                {customKey.trim() && (
                  <button
                    type="button"
                    className="read-along-retry-btn"
                    style={{ flex: 1 }}
                    onClick={handleSaveCustomKey}
                  >
                    Сохранить и распознать
                  </button>
                )}
                <button
                  type="button"
                  className="read-along-retry-btn"
                  style={{
                    flex: customKey.trim() ? undefined : 1,
                    background: customKey.trim() ? "transparent" : "var(--accent)",
                    border: customKey.trim() ? "1px solid var(--border)" : "none",
                    color: customKey.trim() ? "var(--text-primary)" : "#12100b",
                  }}
                  onClick={() => void loadTranscript()}
                >
                  Попробовать снова
                </button>
              </div>
            </div>
          </div>
        ) : segments.length === 0 ? (
          <div className="read-along-state-box">
            <p>Текст для данной главы отсутствует или пока не распознан.</p>
          </div>
        ) : (
          <div className="read-along-content" ref={containerRef}>
            {segments.map((segment, segIdx) => {
              const isActive = segIdx === activeSegmentIndex;
              const tokens = splitIntoTokens(segment.text);

              return (
                <div
                  key={segment.id || segIdx}
                  ref={isActive ? activeSegmentRef : null}
                  className={`read-along-segment ${isActive ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="read-along-time-chip"
                    onClick={() => onSeek(segment.start)}
                    title="Перейти к этой фразе"
                  >
                    <Volume2 size={12} />
                    <span>{formatAudioDuration(segment.start)}</span>
                  </button>

                  {tokens.map((token, tokIdx) => {
                    const norm = normalizeToken(token);
                    if (!norm) return <span key={tokIdx}>{token}</span>;

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
                        className={`read-along-word ${isWordSelected ? "selected" : ""}`}
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

        {/* Interactive AI Panel (Bottom Sheet) */}
        {selection && (
          <AiPanel
            selection={selection}
            analysis={analysis}
            isLoading={isLoadingAnalysis}
            activeTab={activeTab}
            lang={lang}
            ttsProvider="browser"
            onClose={() => setSelection(null)}
            onOpenWordModal={() => setIsWordModalOpen(true)}
            onDiscuss={() => setIsDiscussOpen(true)}
            onAddCard={handleAddCard}
            onWordTap={(word) => {
              const seg = segments[activeSegmentIndex] || segments[0];
              if (seg) void handleWordTap(word, seg, activeSegmentIndex);
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
              if (seg) void handleWordTap(word, seg, activeSegmentIndex);
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
            onWordTap={(word) => {
              setIsDiscussOpen(false);
              const seg = segments[activeSegmentIndex] || segments[0];
              if (seg) void handleWordTap(word, seg, activeSegmentIndex);
            }}
          />
        )}
      </div>
    </div>
  );
}
