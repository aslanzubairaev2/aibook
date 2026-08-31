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
  Repeat,
  Eye,
  EyeOff,
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

// Line widths per fake segment, so the skeleton reads as paragraphs of
// varying length rather than a uniform grid.
const SKELETON_LINE_WIDTHS: string[][] = [
  ["92%", "78%"],
  ["100%", "88%", "40%"],
  ["70%"],
  ["96%", "60%"],
  ["84%", "92%", "55%"],
  ["75%"],
];

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
  /** The sentence currently looping (start/end in seconds), or null when nothing repeats. */
  loopSegment?: { start: number; end: number } | null;
  /** Toggles the repeat-until-you-understand-it loop for one sentence; pass null to stop. */
  onToggleLoopSegment?: (segment: { start: number; end: number } | null) => void;
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
  loopSegment = null,
  onToggleLoopSegment,
}: Props) {
  const [transcript, setTranscript] = useState<AudiobookTranscript | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [customKey, setCustomKey] = useState("");
  // Segments the learner has chosen not to see the text of — populated two
  // ways: automatically the moment a loop starts (the Zamyatkin "matrix"
  // method: listen blind until the words separate out on their own, only
  // then compare against print), or manually via the hide button on whatever
  // sentence is currently playing, loop or not.
  const [hiddenSegmentKeys, setHiddenSegmentKeys] = useState<Set<string>>(new Set());
  // Segment ids are per-chapter (the transcribe route hands out "seg-1",
  // "seg-2", ... fresh for every chapter, see app/api/audiobooks/transcribe),
  // not globally unique — without this, hiding chapter 1's seg-1 would also
  // hide chapter 2's seg-1 the moment you switch. Reset during render rather
  // than in an effect — see the matching comment in AudiobookDetailModal.
  const [hiddenKeysResetChapterIndex, setHiddenKeysResetChapterIndex] = useState(currentChapterIndex);
  if (currentChapterIndex !== hiddenKeysResetChapterIndex) {
    setHiddenKeysResetChapterIndex(currentChapterIndex);
    setHiddenSegmentKeys(new Set());
  }
  // Spoiler guard: sentences the audio hasn't reached yet are blurred, so eyes
  // can't race ahead of ears. One button at the top drops it entirely, back
  // to plain always-visible text.
  const [spoilerMode, setSpoilerMode] = useState(true);

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
  // A lookup may resolve after the learner has already tapped another word.
  // Keep a monotonically increasing id so an old response cannot put the
  // first/previous word back into the panel.
  const analysisRequestIdRef = useRef(0);

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

  // Load Transcript for current chapter safely (handles modal close/unmount)
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadTranscript = useCallback(async () => {
    if (!currentChapter || !currentChapter.audioUrl) {
      if (mountedRef.current) {
        setTranscriptError("Аудиофайл главы не найден");
        setIsLoadingTranscript(false);
      }
      return;
    }

    if (mountedRef.current) {
      setIsLoadingTranscript(true);
      setTranscriptError(null);
    }

    try {
      const data = await fetchAudiobookTranscript({
        audiobookId: audiobook.id,
        chapterIndex: currentChapterIndex,
        audioUrl: currentChapter.audioUrl,
        language: lang,
        duration: currentChapter.durationSeconds,
      });
      if (mountedRef.current) {
        setTranscript(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : "Не удалось загрузить текст главы";
        setTranscriptError(msg);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingTranscript(false);
      }
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

  // The transcript splits on sentence punctuation, which gives wildly uneven
  // chunks — a two-word title line one moment, a 70-second Kafka sentence the
  // next. Neither loops well: the "matrix" method (listen to one short
  // fragment on repeat until the words separate out) wants ~20-40s blocks,
  // not a single sentence of arbitrary length. So a repeat always covers at
  // least this many seconds, pulling in as many following sentences as it
  // takes — never splitting a sentence in half to hit the target exactly.
  const TARGET_LOOP_SECONDS = 30;
  const computeLoopRange = (startIdx: number): { start: number; end: number } => {
    const startSeg = segments[startIdx];
    let endIdx = startIdx;
    while (endIdx < segments.length - 1 && segments[endIdx].end - startSeg.start < TARGET_LOOP_SECONDS) {
      endIdx++;
    }
    return { start: startSeg.start, end: segments[endIdx].end };
  };

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

  // Handle word tap: tokenizes, extracts context, seeks audio to word, and triggers AI analysis
  const handleWordTap = async (
    token: string,
    segment: AudiobookSegment,
    segIdx: number,
    wordTimestamp?: number
  ) => {
    const norm = normalizeToken(token);
    if (!norm) return;
    const requestId = ++analysisRequestIdRef.current;

    // Immediately seek audio to exact word timestamp
    if (typeof wordTimestamp === "number") {
      onSeek(wordTimestamp);
    } else {
      onSeek(segment.start);
    }

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

    setSelection({ token, phraseText, sentence, sentenceBefore, sentenceAfter });
    setActiveTab("word");
    setDiscussMessages([]);
    setAnalysis(null);
    setIsLoadingAnalysis(false);

    const cacheKey = makeAiCacheKey("word", norm, lang, nativeLang);
    const localCached = getLocalAiAnalysis(cacheKey);
    if (localCached) {
      if (analysisRequestIdRef.current === requestId) setAnalysis(localCached);
      return;
    }
    const sbCached = await sbGetCachedAnalysis(cacheKey);
    if (analysisRequestIdRef.current !== requestId) return;
    if (sbCached) {
      setAnalysis(sbCached);
      saveLocalAiAnalysis(cacheKey, sbCached);
      return;
    }
    setIsLoadingAnalysis(true);
    try {
      const res = await analyzeSelection({ mode: "word", word: norm, sentence, sentenceBefore, sentenceAfter, nativeLanguage: nativeLang, targetLanguage: lang });
      if (analysisRequestIdRef.current !== requestId) return;
      setAnalysis(res);
      saveLocalAiAnalysis(cacheKey, res);
      void sbSaveCachedAnalysis(cacheKey, "word", res);
    } catch (err) {
      console.error("Audiobook word AI analysis error:", err);
    } finally {
      if (analysisRequestIdRef.current === requestId) setIsLoadingAnalysis(false);
    }
  };

  const handleTabChange = async (tab: Tab) => {
    setActiveTab(tab);
    if (!selection) return;
    const targetText = tab === "phrase" ? selection.phraseText : tab === "sentence" ? selection.sentence : normalizeToken(selection.token);
    if (!targetText) return;
    const cacheKey = makeAiCacheKey(tab === "sentence" ? "sentence" : tab === "phrase" ? "phrase" : "word", targetText, lang, nativeLang);
    const localCached = getLocalAiAnalysis(cacheKey);
    if (localCached) {
      setAnalysis((prev) => ({ ...prev, ...localCached }));
      return;
    }
    const sbCached = await sbGetCachedAnalysis(cacheKey);
    if (sbCached) {
      setAnalysis((prev) => ({ ...prev, ...sbCached }));
      saveLocalAiAnalysis(cacheKey, sbCached);
      return;
    }
    setIsLoadingAnalysis(true);
    try {
      const res = await analyzeSelection({
        mode: tab === "sentence" ? "sentence" : tab === "phrase" ? "phrase" : "word",
        word: targetText,
        text: targetText,
        sentence: selection.sentence,
        sentenceBefore: selection.sentenceBefore,
        sentenceAfter: selection.sentenceAfter,
        nativeLanguage: nativeLang,
        targetLanguage: lang,
      });
      setAnalysis((prev) => ({ ...prev, ...res }));
      saveLocalAiAnalysis(cacheKey, res);
      void sbSaveCachedAnalysis(cacheKey, tab === "sentence" ? "sentence" : tab === "phrase" ? "phrase" : "word", res);
    } catch (err) {
      console.error("Tab analysis error:", err);
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  const handleAddCard = async (type: Flashcard["type"]) => {
    if (!selection || !onAddWordCard) return;
    const frontText = type === "word" ? analysis?.word?.lemma || selection.token : type === "phrase" ? analysis?.phrase?.text || selection.phraseText : analysis?.sentence?.text || selection.sentence;
    const backText = type === "word" ? analysis?.word?.translation || "" : type === "phrase" ? analysis?.phrase?.translation || "" : analysis?.sentence?.translation || "";
    onAddWordCard(frontText, backText, type === "sentence" ? "phrase" : type);
  };

  return (
    <div className="read-along-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="read-along-modal">
        <div className="read-along-header">
          <div className="read-along-title-block">
            <strong>{audiobook.title}</strong>
            <span>{currentChapter?.title || `Глава ${currentChapterIndex + 1}`}</span>
          </div>
          <div className="read-along-header-actions">
            <button
              type="button"
              className={`read-along-autoscroll-btn ${!spoilerMode ? "active" : ""}`}
              onClick={() => setSpoilerMode((prev) => !prev)}
              title={spoilerMode ? "Открыть весь текст сразу" : "Снова скрывать текст, который ещё не прозвучал"}
            >
              {spoilerMode ? "Показать весь текст" : "Скрыть текст заранее"}
            </button>
            <button type="button" className={`read-along-autoscroll-btn ${autoScroll ? "active" : ""}`} onClick={() => setAutoScroll((prev) => !prev)}>
              {autoScroll ? "Автоскролл вкл" : "Автоскролл выкл"}
            </button>
            <button type="button" onClick={onClose} className="icon-btn modal-close" aria-label="Закрыть"><X size={20} /></button>
          </div>
        </div>

        {/* Audio Scrubber & Controls Bar */}
        <div className="read-along-player-bar">
          <div className="audio-progress-row">
            <span className="audio-time-label">{formatAudioDuration(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={currentChapter?.durationSeconds || duration || 100}
              value={currentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="audio-seek-slider"
              aria-label="Перемотка аудио"
            />
            <span className="audio-time-label">
              {formatAudioDuration(currentChapter?.durationSeconds || duration)}
            </span>
          </div>

          <div className="audio-controls-row">
            <button
              type="button"
              className="audio-speed-btn"
              onClick={() => {
                const speeds = [1, 1.25, 1.5, 1.75, 2, 0.75];
                const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
                onSpeedChange(speeds[nextIdx]);
              }}
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
                onClick={() => onSeek(Math.min(duration || 10000, currentTime + 15))}
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

        {isLoadingTranscript ? (
          <div className="read-along-content">
            <div className="read-along-skeleton-status">
              <Loader2 className="animate-spin" size={16} style={{ color: "var(--accent)" }} />
              <span>Синхронизируем текст через Gemini — обычно это 30–90 секунд для главы...</span>
            </div>
            {SKELETON_LINE_WIDTHS.map((widths, segIdx) => (
              <div key={segIdx} className="read-along-segment read-along-skeleton-segment">
                <div className="skeleton-block read-along-skeleton-chip" />
                {widths.map((width, lineIdx) => (
                  <div
                    key={lineIdx}
                    className="skeleton-block read-along-skeleton-line"
                    style={{ width, animationDelay: `${(segIdx * widths.length + lineIdx) * 0.06}s` }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : transcriptError ? (
          <div className="read-along-state-box">
            <strong>Ошибка загрузки текста</strong>
            <p>{transcriptError}</p>
            <input type="password" placeholder="Вставьте Gemini API ключ" value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
            <button onClick={() => void loadTranscript()}>Попробовать снова</button>
          </div>
        ) : (
          <div className="read-along-content" ref={containerRef}>
            {segments.map((segment, segIdx) => {
              const isActive = segIdx === activeSegmentIndex;
              const tokens = splitIntoTokens(segment.text);
              let validWordCounter = 0;
              // A loop now spans a time RANGE (possibly several sentences, see
              // computeLoopRange above), not one sentence's exact start/end —
              // membership is by containment, not equality.
              const LOOP_EPS = 0.05;
              const isLooping =
                !!loopSegment &&
                segment.start >= loopSegment.start - LOOP_EPS &&
                segment.start < loopSegment.end - LOOP_EPS;
              const segmentKey = segment.id || String(segIdx);
              // Every sentence inside one looping range shares a single hide
              // key, so revealing any one of them reveals the whole block —
              // it's one listening unit, not N independent sentences.
              const loopGroupKey = loopSegment ? `loop-${loopSegment.start}` : null;
              const hideKey = isLooping && loopGroupKey ? loopGroupKey : segmentKey;
              // "Показать весь текст" promises exactly that — it must override
              // any loop/manual hide, not just stop future blur, or the button
              // does nothing for whatever's already hidden.
              const isTextHidden = spoilerMode && hiddenSegmentKeys.has(hideKey);
              // A sentence the audio hasn't reached yet — blurred under spoiler
              // mode so the eyes can't read ahead of what's actually playing.
              const isBlurredAhead = spoilerMode && !isLooping && segIdx > activeSegmentIndex;

              return (
                <div
                  key={segment.id || segIdx}
                  ref={isActive ? activeSegmentRef : null}
                  className={`read-along-segment ${isActive ? "active" : ""} ${isLooping ? "looping" : ""} ${isBlurredAhead ? "blurred" : ""}`}
                >
                  <button type="button" className="read-along-time-chip" onClick={() => onSeek(segment.start)}><Volume2 size={12} />{formatAudioDuration(segment.start)}</button>
                  {onToggleLoopSegment && (
                    <button
                      type="button"
                      className={`read-along-loop-btn ${isLooping ? "active" : ""}`}
                      onClick={() => {
                        if (isLooping) {
                          onToggleLoopSegment(null);
                        } else {
                          const range = computeLoopRange(segIdx);
                          onToggleLoopSegment(range);
                          // every fresh loop starts blind
                          setHiddenSegmentKeys((prev) => new Set(prev).add(`loop-${range.start}`));
                        }
                      }}
                      title={isLooping ? "Остановить повтор" : "Повторять вслепую ~30 сек, пока не начнёшь различать слова"}
                      aria-pressed={isLooping}
                    >
                      <Repeat size={12} />
                    </button>
                  )}
                  {isActive && !isLooping && (
                    <button
                      type="button"
                      className={`read-along-loop-btn ${isTextHidden ? "active" : ""}`}
                      onClick={() =>
                        setHiddenSegmentKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(segmentKey)) next.delete(segmentKey);
                          else next.add(segmentKey);
                          return next;
                        })
                      }
                      title={isTextHidden ? "Показать текст" : "Скрыть текст этого предложения"}
                      aria-pressed={isTextHidden}
                    >
                      {isTextHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  )}
                  {isTextHidden ? (
                    <span className="read-along-loop-hidden">
                      <span className="read-along-loop-hidden-hint">
                        {isLooping ? "Слушайте — текст скрыт, пока не начнёте различать слова" : "Текст скрыт"}
                      </span>
                      <button
                        type="button"
                        className="read-along-reveal-btn"
                        onClick={() =>
                          setHiddenSegmentKeys((prev) => {
                            const next = new Set(prev);
                            next.delete(hideKey);
                            return next;
                          })
                        }
                      >
                        Показать текст
                      </button>
                    </span>
                  ) : (
                    <span className="read-along-segment-text">
                      {tokens.map((token, tokIdx) => {
                    const norm = normalizeToken(token);
                    if (!norm) return <span key={tokIdx}>{token}</span>;
                    const currentWordIdx = validWordCounter++;

                    // Direct AI word timestamp from Gemini model. Gemini's `words`
                    // list doesn't always split 1:1 with the displayed tokens
                    // (contractions, hyphens, punctuation), so trusting the raw
                    // index alone lets one mismatch shift every timestamp for the
                    // rest of the segment. Re-anchor on the nearest word whose text
                    // actually matches before falling back to the raw position.
                    const words = segment.words;
                    let matchingWord = words?.[currentWordIdx];
                    if (!matchingWord || normalizeToken(matchingWord.word) !== norm) {
                      for (let radius = 1; radius <= 3 && words; radius++) {
                        const ahead = words[currentWordIdx + radius];
                        if (ahead && normalizeToken(ahead.word) === norm) {
                          matchingWord = ahead;
                          break;
                        }
                        const behind = words[currentWordIdx - radius];
                        if (behind && normalizeToken(behind.word) === norm) {
                          matchingWord = behind;
                          break;
                        }
                      }
                      if (!matchingWord || normalizeToken(matchingWord.word) !== norm) {
                        matchingWord = words?.find((w) => normalizeToken(w.word) === norm) || words?.[currentWordIdx];
                      }
                    }

                    const wordStart = matchingWord ? matchingWord.start : segment.start;
                    const wordEnd = matchingWord ? matchingWord.end : segment.end;

                    let isKaraokeCurrent = false;
                    let isKaraokeSpoken = false;
                    if (isActive && matchingWord) {
                      isKaraokeCurrent = currentTime >= matchingWord.start && currentTime < matchingWord.end;
                      isKaraokeSpoken = currentTime >= matchingWord.end;
                    }
                    const isWordSelected = selection?.token === token && isActive;
                    const isPhraseContext = Boolean(
                      selection?.phraseText &&
                      selection.phraseText.includes(token) &&
                      isActive &&
                      !isWordSelected
                    );

                    // Blurred-ahead text is still in the DOM (CSS just blurs
                    // it) — `pointer-events: none` on the parent stops mouse
                    // clicks, but not keyboard focus or Enter. Without this,
                    // tabbing lets a keyboard user land on and activate a
                    // word the audio hasn't reached yet, defeating the point
                    // of hiding it.
                    return (
                      <span
                        key={tokIdx}
                        role="button"
                        tabIndex={isBlurredAhead ? -1 : 0}
                        aria-hidden={isBlurredAhead || undefined}
                        onClick={() => { if (!isBlurredAhead) handleWordTap(token, segment, segIdx, wordStart); }}
                        onKeyDown={(e) => {
                          if (isBlurredAhead) return;
                          if (e.key === "Enter") handleWordTap(token, segment, segIdx, wordStart);
                        }}
                        className={`read-along-word ${isWordSelected ? "selected" : ""} ${isPhraseContext ? "phrase-context" : ""} ${isKaraokeCurrent ? "karaoke-current" : ""} ${isKaraokeSpoken ? "karaoke-spoken" : ""}`}
                      >
                        {token}
                      </span>
                    );
                      })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Cost & Token Transparency Badge */}
        {transcript?.usage ? (
          <div className="read-along-cost-badge">
            <span>
              {transcript.modelUsed || "Gemini Flash"} • Токены: {transcript.usage.totalTokens.toLocaleString()} (вход: {transcript.usage.promptTokens.toLocaleString()}, выход: {transcript.usage.outputTokens.toLocaleString()}) • Стоимость: ~${transcript.usage.costUsd.toFixed(4)}
            </span>
          </div>
        ) : transcript ? (
          <div className="read-along-cost-badge">
            <span>
              {transcript.modelUsed || "Gemini Flash"} • {transcript.segments.length} предложений распознано
            </span>
          </div>
        ) : null}

        {selection && (
          <AiPanel
            selection={selection}
            analysis={analysis}
            isLoading={isLoadingAnalysis}
            activeTab={activeTab}
            lang={lang}
            ttsProvider="local"
            onClose={() => setSelection(null)}
            onOpenWordModal={() => setIsWordModalOpen(true)}
            onDiscuss={() => setIsDiscussOpen(true)}
            onAddCard={handleAddCard}
            onWordTap={(word) => { const seg = segments[activeSegmentIndex] || segments[0]; if (seg) void handleWordTap(word, seg, activeSegmentIndex); }}
            onTabChange={handleTabChange}
            onTtsProviderChange={() => {}}
          />
        )}
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
