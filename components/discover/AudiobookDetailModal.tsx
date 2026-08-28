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
  Info,
  MessageSquare,
  Loader2,
  ListMusic,
  Clock,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Audiobook, AudiobookChapter, CefrConfidence, CefrLevel, DiscussMessage, AiAnalysis } from "@/lib/types";
import {
  fetchAudiobookDetails,
  formatAudioDuration,
  getAudiobookProgress,
  saveAudiobookProgress,
} from "@/lib/audio/audiobooks";
import { isBenignPlaybackAbort, syncAudioSource } from "@/lib/audio/playback";
import {
  setMediaSessionActionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "@/lib/audio/mediaSession";
import { aiChat } from "@/lib/ai/chat";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { WordModal } from "@/components/word-modal/WordModal";

type Props = {
  audiobook: Audiobook;
  /** The learner's own language — required by the shared "Обсудить с AI" chat and word lookups. */
  nativeLanguage: string;
  onClose: () => void;
  /** Saving a word or example tapped inside the AI chat as a flashcard; omitted where the caller has nowhere to put it. */
  onAddWordCard?: (front: string, back: string, type: "word" | "phrase") => void;
};

const LANG_NAMES: Record<string, string> = {
  de: "немецкий",
  ger: "немецкий",
  deu: "немецкий",
  german: "немецкий",
  en: "английский",
  eng: "английский",
  english: "английский",
  fr: "французский",
  fre: "французский",
  fra: "французский",
  french: "французский",
  es: "испанский",
  spa: "испанский",
  spanish: "испанский",
  it: "итальянский",
  ita: "итальянский",
  italian: "итальянский",
  ru: "русский",
  rus: "русский",
  russian: "русский",
};

// The app's AI routes speak ISO 639-1 codes; Internet Archive metadata carries
// whatever the uploader typed (full English names, 3-letter codes, ...). This
// collapses that mess down to the codes analyzeSelection/DiscussAiModal expect.
const LANG_CODE: Record<string, string> = {
  de: "de", ger: "de", deu: "de", german: "de",
  en: "en", eng: "en", english: "en",
  fr: "fr", fre: "fr", fra: "fr", french: "fr",
  es: "es", spa: "es", spanish: "es",
  it: "it", ita: "it", italian: "it",
  ru: "ru", rus: "ru", russian: "ru",
};

const CEFR_COLORS: Record<string, string> = {
  A1: "#4caf50",
  A2: "#8bc34a",
  B1: "#2196f3",
  B2: "#03a9f4",
  C1: "#9c27b0",
  C2: "#673ab7",
};

/** "B1" when verified, "≈ B1" when it's only a genre/author guess. */
function formatCefrBadge(level: CefrLevel | null, confidence: CefrConfidence | undefined): string | null {
  if (!level) return null;
  return confidence === "approximate" ? `≈ ${level}` : level;
}

const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

function cleanAiText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/^[\s•\-*#]+/gm, "")
    .replace(/[·]{2,}/g, "·")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitReview(value: string | null) {
  if (!value) return [];
  const cleaned = cleanAiText(value);
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length > 1) return lines.slice(0, 4);

  return cleaned
    .split(/(?<=\.)\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function AudiobookDetailModal({ audiobook, nativeLanguage, onClose, onAddWordCard }: Props) {
  const [details, setDetails] = useState<Audiobook | null>(
    audiobook.chapters && audiobook.chapters.length > 0 ? audiobook : null
  );
  const [isLoadingChapters, setIsLoadingChapters] = useState(!details);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [showChaptersList, setShowChaptersList] = useState(false);

  // Compact AI overview, shown right beside the title/metadata.
  const [review, setReview] = useState<string | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState(false);

  // "Обсудить с AI" reuses the app's shared discussion modal instead of a
  // bespoke chat, so it gets voice input, follow-up chips and tappable words
  // for free — and stays consistent with the reader's own AI chat.
  const [isDiscussOpen, setIsDiscussOpen] = useState(false);
  const [discussMessages, setDiscussMessages] = useState<DiscussMessage[]>([]);

  // A word tapped inside the AI chat opens the same word modal the rest of
  // the app uses, instead of doing nothing.
  const [wordModalSelection, setWordModalSelection] = useState("");
  const [wordModalAnalysis, setWordModalAnalysis] = useState<AiAnalysis | null>(null);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [isWordModalLoading, setIsWordModalLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncedAudioUrlRef = useRef<string | null>(null);
  // A restored "continue listening" position only ever reaches the `currentTime`
  // React state (see the restore effect below) — the `<audio>` element itself
  // starts at 0 regardless, since nothing had seeked it yet. Play() then played
  // from that real, unseeked 0 while the seek bar kept showing the old
  // position, until the next timeupdate snapped it back. This ref carries the
  // restored position across to the first `loadedmetadata` of the freshly
  // loaded source, which is the first point a seek is guaranteed to stick.
  const pendingSeekSecondsRef = useRef<number | null>(null);

  const chapters: AudiobookChapter[] = details?.chapters || [];
  const currentChapter: AudiobookChapter | undefined = chapters[currentChapterIndex];

  const author = audiobook.author || "Неизвестный автор";
  const langKey = audiobook.language.toLowerCase();
  const language = LANG_NAMES[langKey] || audiobook.language;
  const targetLanguage = LANG_CODE[langKey] || langKey || "de";
  // No fallback level here on purpose: a book this classifier hasn't verified
  // has no level to fall back to without repeating the false-A1/B1 bug this
  // feature fixes (see lib/audio/audiobooks.ts).
  const cefr: CefrLevel | null = details?.cefrLevel ?? audiobook.cefrLevel ?? null;
  const cefrConfidence: CefrConfidence | undefined = details?.cefrConfidence ?? audiobook.cefrConfidence;
  const cefrBadge = formatCefrBadge(cefr, cefrConfidence);
  const cefrExplanation = details?.cefrExplanation ?? audiobook.cefrExplanation;
  const reviewLines = useMemo(() => splitReview(review), [review]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // What the AI chat is told this book is, since there is no "selected text"
  // to hand it the way a tapped word or sentence would.
  const audiobookContext = useMemo(
    () => [author, language, cefr ? `уровень ${cefr}` : null, audiobook.description].filter(Boolean).join(" · "),
    [author, language, cefr, audiobook.description]
  );

  // 1. Fetch detailed metadata and chapters
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      if (details) return;
      setIsLoadingChapters(true);
      setLoadError(null);
      try {
        const full = await fetchAudiobookDetails(audiobook.id, controller.signal);
        if (active) {
          setDetails(full);
          // Restore saved progress if available
          const saved = getAudiobookProgress(audiobook.id);
          if (saved && saved.chapterIndex < (full.chapters?.length || 0)) {
            setCurrentChapterIndex(saved.chapterIndex);
            setCurrentTime(saved.currentTimeSeconds);
            // The seek bar can show this immediately, but the audio element
            // itself hasn't loaded that chapter's source yet — actually
            // seeking happens once it has, in onLoadedMetadata below.
            if (saved.currentTimeSeconds > 0) pendingSeekSecondsRef.current = saved.currentTimeSeconds;
          }
        }
      } catch (err) {
        if (active) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error("Failed to load audiobook chapters", err);
          // A saved "continue listening" pointer can point at a book that was
          // pulled from Internet Archive since — this is the one place that
          // becomes visible, so it needs its own message instead of a
          // silently disabled player.
          setLoadError("Не удалось загрузить эту аудиокнигу. Возможно, она больше недоступна на Internet Archive.");
        }
      } finally {
        if (active) setIsLoadingChapters(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [audiobook.id, details]);

  // 2. Fetch the compact AI overview
  useEffect(() => {
    let isActive = true;

    async function loadReview() {
      setIsLoadingReview(true);
      setReview(null);
      setDiscussMessages([]);
      try {
        const prompt = [
          `Аудиокнига: "${audiobook.title}", автор: ${author}, язык: ${language}.`,
          "Сделай очень короткую карточку для изучающего язык без спойлеров, без markdown и без спецсимволов.",
          "Строго 4 строки:",
          "О чем: одно короткое предложение.",
          "Жанр: 2-4 слова.",
          "Язык: примерный уровень A1-C2 и темп/сложность речи.",
          "Кому: кому подойдет для аудирования.",
        ].join("\n");
        const result = await aiChat(prompt);
        if (isActive) setReview(result || "О чем: аудиокнига из классической библиотеки.");
      } catch {
        if (isActive) {
          const levelLine = cefr ? `Язык: примерно ${cefr}, понятная дикция.` : "Язык: уровень не подтверждён, оригинальный текст без адаптации.";
          setReview(
            `О чем: классическое аудиопроизведение для тренировки понимания на слух.\nЖанр: литература в общественном достоянии.\n${levelLine}\nКому: тем, кто развивает навык восприятия речи на ${language}.`
          );
        }
      } finally {
        if (isActive) setIsLoadingReview(false);
      }
    }

    void loadReview();

    return () => {
      isActive = false;
    };
  }, [audiobook.id, audiobook.title, author, language, cefr]);

  // 3. Audio Element Event Handlers
  //
  // Every `play()` call goes through `safePlay`, tagged with an incrementing
  // request id. A chapter/book change, or an explicit pause, bumps the id —
  // so when an old `play()` promise settles (resolved or rejected) after
  // being superseded, it's recognised as stale and ignored instead of
  // fighting the newer state or logging a benign AbortError to the console.
  // This is the same race the AbortError fix on gemini/audiobooks-quality
  // addressed for its own player; this modal needed its own copy because the
  // UX redesign rewrote the component around it.
  const playRequestIdRef = useRef(0);

  const safePlay = useCallback(() => {
    if (!audioRef.current) return;
    const requestId = ++playRequestIdRef.current;
    audioRef.current
      .play()
      .then(() => {
        if (playRequestIdRef.current === requestId) setIsPlaying(true);
      })
      .catch((err) => {
        if (playRequestIdRef.current !== requestId) return; // superseded — expected
        if (isBenignPlaybackAbort(err)) return;
        console.error("Audio playback error:", err);
        setIsPlaying(false);
      });
  }, []);

  const pauseAudio = useCallback(() => {
    playRequestIdRef.current += 1; // invalidate any play() still in flight
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current || !currentChapter) return;
    if (isPlaying) pauseAudio();
    else safePlay();
  }, [isPlaying, currentChapter, safePlay, pauseAudio]);

  const handleSeek = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const handleSkip = useCallback((deltaSeconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(duration || 99999, audioRef.current.currentTime + deltaSeconds));
    handleSeek(newTime);
  }, [duration, handleSeek]);

  const handleNextChapter = useCallback(() => {
    if (currentChapterIndex < chapters.length - 1) {
      setCurrentChapterIndex((prev) => prev + 1);
      setCurrentTime(0);
      setIsPlaying(true);
    }
  }, [currentChapterIndex, chapters.length]);

  const handlePrevChapter = useCallback(() => {
    if (currentTime > 5 || currentChapterIndex === 0) {
      handleSeek(0);
    } else {
      setCurrentChapterIndex((prev) => Math.max(0, prev - 1));
      setCurrentTime(0);
      setIsPlaying(true);
    }
  }, [currentTime, currentChapterIndex, handleSeek]);

  const cyclePlaybackSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextSpeed = PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  // Sync audio source when chapter changes
  useEffect(() => {
    if (!audioRef.current || !currentChapter) return;
    const sourceChanged = syncAudioSource(
      audioRef.current,
      currentChapter.audioUrl,
      playbackSpeed,
      syncedAudioUrlRef.current
    );
    syncedAudioUrlRef.current = currentChapter.audioUrl;
    if (sourceChanged && isPlaying) safePlay();
  }, [currentChapterIndex, currentChapter, playbackSpeed, isPlaying, safePlay]);

  // Invalidate any in-flight play() and stop the element on unmount (closing
  // the modal), so a superseded promise never resolves into a component that
  // is no longer there.
  useEffect(() => {
    return () => {
      playRequestIdRef.current += 1;
    };
  }, []);

  // Periodic progress saving — the same write also updates the home screen's
  // "Продолжить слушать" pointer (see saveAudiobookProgress), so it carries a
  // display snapshot the home screen can render without a network refetch.
  useEffect(() => {
    if (!audiobook.id || currentTime === 0) return;
    saveAudiobookProgress({
      audiobookId: audiobook.id,
      chapterIndex: currentChapterIndex,
      currentTimeSeconds: currentTime,
      durationSeconds: duration,
      updatedAt: new Date().toISOString(),
      title: audiobook.title,
      author: audiobook.author,
      coverUrl: audiobook.coverUrl,
      coverColor: audiobook.coverColor,
      language: audiobook.language,
      chapterTitle: currentChapter?.title,
      totalChapters: chapters.length,
      cefrLevel: cefr,
      cefrConfidence,
    });
  }, [audiobook, currentChapterIndex, currentTime, duration, currentChapter, chapters.length, cefr, cefrConfidence]);

  // Media Session: lets the lock screen, notification shade and hardware
  // media keys control playback while the tab is hidden or the screen is
  // locked. Every handler below calls straight into the controller functions
  // already defined above — nothing here duplicates playback logic.
  useEffect(() => {
    return setMediaSessionActionHandlers({
      play: safePlay,
      pause: pauseAudio,
      seekBackward: () => handleSkip(-15),
      seekForward: () => handleSkip(15),
      previousTrack: handlePrevChapter,
      nextTrack: handleNextChapter,
      seekTo: handleSeek,
    });
  }, [safePlay, pauseAudio, handleSkip, handlePrevChapter, handleNextChapter, handleSeek]);

  useEffect(() => {
    setMediaSessionMetadata({
      title: currentChapter?.title || audiobook.title,
      artist: author,
      album: audiobook.title,
      artworkUrl: audiobook.coverUrl,
    });
  }, [currentChapter, audiobook.title, audiobook.coverUrl, author]);

  useEffect(() => {
    setMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
  }, [isPlaying]);

  useEffect(() => {
    setMediaSessionPositionState({
      duration: duration || currentChapter?.durationSeconds || 0,
      position: currentTime,
      playbackRate: playbackSpeed,
    });
  }, [duration, currentTime, playbackSpeed, currentChapter]);

  // A word tapped inside the AI chat (or the word modal's own examples) gets
  // the same live lookup the reader and dictionary use, cached the same way.
  const loadWordModalAnalysis = useCallback(async (word: string, contextSentence: string) => {
    setWordModalSelection(word);
    setIsWordModalOpen(true);
    setIsWordModalLoading(true);
    setWordModalAnalysis(null);

    const cacheKey = makeAiCacheKey("word", word, targetLanguage, nativeLanguage);
    try {
      let full = getLocalAiAnalysis(cacheKey);
      if (!full?.word) {
        full = await analyzeSelection({
          mode: "word",
          word,
          text: word,
          sentence: contextSentence || word,
          sentenceBefore: "",
          sentenceAfter: "",
          nativeLanguage,
          targetLanguage,
        });
        if (full?.word) saveLocalAiAnalysis(cacheKey, full);
      }
      setWordModalAnalysis(full?.word ? full : null);
    } catch {
      setWordModalAnalysis(null);
    } finally {
      setIsWordModalLoading(false);
    }
  }, [nativeLanguage, targetLanguage]);

  return (
    <div className="book-modal-backdrop">
      <div className="book-modal" style={{ maxWidth: "600px" }}>
        <div className="book-modal-header">
          <strong>Аудиокнига</strong>
          <button
            onClick={onClose}
            className="icon-btn modal-close"
            type="button"
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <div className="book-modal-content">
          {/* Header block with cover & title */}
          <div className="book-modal-main">
            <div
              className="book-modal-cover"
              style={
                audiobook.coverUrl
                  ? { backgroundImage: `url(${audiobook.coverUrl})` }
                  : { background: audiobook.coverColor || "var(--accent)" }
              }
            />
            <div className="book-modal-title-block">
              <h1>{audiobook.title}</h1>
              <p>{author}</p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <span>{language}</span>
                {cefrBadge ? (
                  <span
                    className="cefr-badge"
                    title={cefrExplanation}
                    style={{
                      background: CEFR_COLORS[cefr as CefrLevel] || "#888",
                      color: "#fff",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: "bold",
                      opacity: cefrConfidence === "approximate" ? 0.85 : 1,
                    }}
                  >
                    {cefrBadge}
                  </span>
                ) : (
                  <span
                    className="cefr-badge"
                    title={cefrExplanation ?? "Оригинальный текст без адаптации — уровень CEFR не подтверждён."}
                    style={{
                      background: "var(--bg-hover)",
                      color: "var(--text-muted)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    Оригинал
                  </span>
                )}
                {audiobook.totalDurationFormatted && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                      fontSize: "12px",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Clock size={12} /> {audiobook.totalDurationFormatted}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="pill-btn discuss-audiobook-btn"
                onClick={() => setIsDiscussOpen(true)}
              >
                <MessageSquare size={15} />
                Обсудить с AI
              </button>
            </div>
          </div>

          {/* Compact AI overview — right beside the title/metadata */}
          <section className="ai-review-card ai-review-compact">
            <div className="compact-section-title">
              <Info size={15} />
              <strong>AI-обзор</strong>
            </div>
            {isLoadingReview ? (
              <div className="compact-loader">
                <Loader2 size={14} className="spin" />
                <span>Оцениваю уровень и содержание...</span>
              </div>
            ) : (
              <dl className="review-list">
                {reviewLines.map((line, index) => {
                  const [label, ...rest] = line.split(":");
                  const text = rest.join(":").trim() || line;
                  const hasLabel = rest.length > 0 && label.length < 18;
                  return (
                    <div key={`${line}-${index}`}>
                      {hasLabel && <dt>{label}</dt>}
                      <dd>{hasLabel ? text : line}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>

          {/* Embedded Audio Player — the only thing left at the bottom, along
              with the chapters drawer it opens. */}
          <section className="audio-player-card">
            {loadError && <div className="inline-error">{loadError}</div>}
            <audio
              ref={audioRef}
              preload="metadata"
              onTimeUpdate={() => {
                if (audioRef.current) {
                  setCurrentTime(audioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (audioRef.current) {
                  setDuration(audioRef.current.duration || 0);
                  audioRef.current.playbackRate = playbackSpeed;
                  // Actually seek the element to a restored "continue
                  // listening" position — this is the first point a seek is
                  // guaranteed to stick, and the only reason a resumed book
                  // used to play from 0 despite the seek bar showing the
                  // right spot (see pendingSeekSecondsRef above).
                  if (pendingSeekSecondsRef.current !== null) {
                    audioRef.current.currentTime = pendingSeekSecondsRef.current;
                    pendingSeekSecondsRef.current = null;
                  }
                }
              }}
              onEnded={handleNextChapter}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            />

            <div className="audio-player-header">
              <div className="audio-chapter-info">
                <span className="audio-chapter-label">
                  {isLoadingChapters ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Loader2 size={12} className="spin" /> Загрузка глав...
                    </span>
                  ) : chapters.length > 0 ? (
                    `Глава ${currentChapterIndex + 1} из ${chapters.length}`
                  ) : (
                    "Аудиофайл"
                  )}
                </span>
                <strong className="audio-chapter-title">
                  {currentChapter?.title || audiobook.title}
                </strong>
              </div>

              {chapters.length > 1 && (
                <button
                  type="button"
                  className={`audio-btn-ghost ${showChaptersList ? "active" : ""}`}
                  onClick={() => setShowChaptersList((prev) => !prev)}
                  title="Список глав"
                >
                  <ListMusic size={18} />
                </button>
              )}
            </div>

            {/* Seek bar */}
            <div className="audio-progress-row">
              <span className="audio-time-label">{formatAudioDuration(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || currentChapter?.durationSeconds || 100}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="audio-seek-slider"
                disabled={isLoadingChapters || !currentChapter}
              />
              <span className="audio-time-label">
                {formatAudioDuration(duration || currentChapter?.durationSeconds || 0)}
              </span>
            </div>

            {/* Controls bar */}
            <div className="audio-controls-row">
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
                  onClick={handlePrevChapter}
                  disabled={currentChapterIndex === 0 && currentTime <= 5}
                  title="Предыдущая глава"
                >
                  <SkipBack size={18} />
                </button>

                <button
                  type="button"
                  className="audio-btn-control"
                  onClick={() => handleSkip(-15)}
                  title="Назад на 15 сек"
                >
                  <RotateCcw size={18} />
                </button>

                <button
                  type="button"
                  className="audio-btn-play"
                  onClick={handlePlayPause}
                  disabled={isLoadingChapters || !currentChapter}
                  aria-label={isPlaying ? "Пауза" : "Воспроизведение"}
                >
                  {isLoadingChapters ? (
                    <Loader2 size={24} className="spin" />
                  ) : isPlaying ? (
                    <Pause size={24} />
                  ) : (
                    <Play size={24} style={{ marginLeft: "2px" }} />
                  )}
                </button>

                <button
                  type="button"
                  className="audio-btn-control"
                  onClick={() => handleSkip(15)}
                  title="Вперед на 15 сек"
                >
                  <RotateCw size={18} />
                </button>

                <button
                  type="button"
                  className="audio-btn-control"
                  onClick={handleNextChapter}
                  disabled={currentChapterIndex >= chapters.length - 1}
                  title="Следующая глава"
                >
                  <SkipForward size={18} />
                </button>
              </div>

              <button
                type="button"
                className="audio-btn-ghost"
                onClick={() => {
                  if (!audioRef.current) return;
                  audioRef.current.muted = !isMuted;
                  setIsMuted(!isMuted);
                }}
                title={isMuted ? "Включить звук" : "Без звука"}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>

            {/* Chapters list drawer */}
            {showChaptersList && chapters.length > 0 && (
              <div className="audio-chapters-drawer">
                <div className="audio-chapters-drawer-title">
                  <strong>Все главы ({chapters.length})</strong>
                </div>
                <div className="audio-chapters-scroll">
                  {chapters.map((ch, idx) => (
                    <button
                      key={ch.id}
                      type="button"
                      className={`audio-chapter-item ${idx === currentChapterIndex ? "active" : ""}`}
                      onClick={() => {
                        setCurrentChapterIndex(idx);
                        setCurrentTime(0);
                        setIsPlaying(true);
                      }}
                    >
                      <span className="audio-chapter-num">{idx + 1}.</span>
                      <span className="audio-chapter-name">{ch.title}</span>
                      {ch.durationFormatted && (
                        <span className="audio-chapter-dur">{ch.durationFormatted}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <DiscussAiModal
        isOpen={isDiscussOpen}
        mode="audiobook"
        selectedText={audiobook.title}
        sentence={audiobookContext}
        nativeLanguage={nativeLanguage}
        targetLanguage={targetLanguage}
        messages={discussMessages}
        onMessagesChange={setDiscussMessages}
        onClose={() => setIsDiscussOpen(false)}
        onWordTap={(word, context) => void loadWordModalAnalysis(word, context)}
        onAddExample={onAddWordCard ? (text, translation) => onAddWordCard(text, translation, "phrase") : undefined}
      />

      <WordModal
        analysis={wordModalAnalysis}
        isOpen={isWordModalOpen}
        isLoading={isWordModalLoading}
        lang={targetLanguage}
        nativeLang={nativeLanguage}
        selectedWord={wordModalSelection}
        onClose={() => {
          setIsWordModalOpen(false);
          setWordModalAnalysis(null);
          setWordModalSelection("");
        }}
        onAddCard={() => {
          if (!onAddWordCard) return;
          const front = wordModalSelection;
          const back = wordModalAnalysis?.word?.translation ?? "";
          if (front && back) onAddWordCard(front, back, "word");
        }}
        onAddLemma={(lemma) => {
          if (!onAddWordCard) return;
          onAddWordCard(lemma, wordModalAnalysis?.word?.translation ?? "", "word");
        }}
        onWordTap={(word, context) => void loadWordModalAnalysis(word, context)}
        onAddExample={onAddWordCard ? (text, translation) => onAddWordCard(text, translation, "phrase") : undefined}
      />
    </div>
  );
}
