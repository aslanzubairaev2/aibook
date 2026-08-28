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
  Send,
  Loader2,
  ListMusic,
  Clock,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Audiobook, AudiobookChapter, CefrLevel } from "@/lib/types";
import {
  fetchAudiobookDetails,
  formatAudioDuration,
  getAudiobookProgress,
  saveAudiobookProgress,
} from "@/lib/audio/audiobooks";
import { aiChat } from "@/lib/ai/chat";
import { DictateButton, appendSpoken } from "./DictateButton";

type Props = {
  audiobook: Audiobook;
  onClose: () => void;
};

type ChatMessage = {
  role: "user" | "ai";
  text: string;
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

const CEFR_COLORS: Record<string, string> = {
  A1: "#4caf50",
  A2: "#8bc34a",
  B1: "#2196f3",
  B2: "#03a9f4",
  C1: "#9c27b0",
  C2: "#673ab7",
};

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

export function AudiobookDetailModal({ audiobook, onClose }: Props) {
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

  // AI Review & Chat
  const [review, setReview] = useState<string | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isMountedRef = useRef(true);
  const playReqIdRef = useRef(0);

  const chapters: AudiobookChapter[] = useMemo(() => details?.chapters || [], [details?.chapters]);
  const currentChapter: AudiobookChapter | undefined = chapters[currentChapterIndex];

  const author = audiobook.author || "Неизвестный автор";
  const langKey = audiobook.language.toLowerCase();
  const language = LANG_NAMES[langKey] || audiobook.language;

  const cefrLevel: CefrLevel | null = details?.cefrLevel !== undefined ? details.cefrLevel : audiobook.cefrLevel ?? null;
  const cefrConfidence = details?.cefrConfidence || audiobook.cefrConfidence || "unverified";
  const cefrExplanation = details?.cefrExplanation || audiobook.cefrExplanation || "Оригинальный текст без адаптации";

  const reviewLines = useMemo(() => splitReview(review), [review]);

  // Lifecycle cleanup to prevent any race conditions or memory leaks
  useEffect(() => {
    isMountedRef.current = true;
    const audio = audioRef.current;
    return () => {
      isMountedRef.current = false;
      if (audio) {
        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {
          // Ignore
        }
      }
    };
  }, [audiobook.id]);

  // Safe Audio Playback & Cancellation
  const safePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !isMountedRef.current) return;

    const reqId = ++playReqIdRef.current;
    try {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      if (isMountedRef.current && reqId === playReqIdRef.current) {
        setIsPlaying(true);
      }
    } catch (err: unknown) {
      // Catch and gracefully handle AbortError and NotAllowedError from rapid src changes or browser policy
      if (
        (err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")) ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "NotAllowedError"))
      ) {
        return;
      }
      console.error("Audio playback error:", err);
      if (isMountedRef.current && reqId === playReqIdRef.current) {
        setIsPlaying(false);
      }
    }
  }, []);

  const safePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    playReqIdRef.current++;
    try {
      audio.pause();
    } catch {
      // Ignore pause errors
    }
    if (isMountedRef.current) {
      setIsPlaying(false);
    }
  }, []);

  const selectChapter = useCallback(
    (index: number, autoPlay = true) => {
      setCurrentChapterIndex(index);
      setCurrentTime(0);
      const audio = audioRef.current;
      const targetChapter = chapters[index];
      if (!audio || !targetChapter) return;

      playReqIdRef.current++;
      try {
        audio.pause();
      } catch {
        // Ignore
      }

      audio.src = targetChapter.audioUrl;
      audio.playbackRate = playbackSpeed;
      audio.currentTime = 0;
      audio.load();

      if (autoPlay) {
        void safePlay();
      } else {
        setIsPlaying(false);
      }
    },
    [chapters, playbackSpeed, safePlay]
  );

  // 1. Fetch detailed metadata and chapters
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      if (details) return;
      setIsLoadingChapters(true);
      try {
        const full = await fetchAudiobookDetails(audiobook.id, controller.signal);
        if (active && isMountedRef.current) {
          setDetails(full);
          // Restore saved progress if available
          const saved = getAudiobookProgress(audiobook.id);
          const restoredIndex =
            saved && saved.chapterIndex < (full.chapters?.length || 0) ? saved.chapterIndex : 0;
          const restoredTime = saved ? saved.currentTimeSeconds : 0;

          setCurrentChapterIndex(restoredIndex);
          setCurrentTime(restoredTime);

          const audio = audioRef.current;
          if (audio && full.chapters?.[restoredIndex]) {
            audio.src = full.chapters[restoredIndex].audioUrl;
            if (restoredTime > 0) {
              audio.currentTime = restoredTime;
            }
          }
        }
      } catch (err) {
        if (active) {
          console.error("Failed to load audiobook chapters", err);
        }
      } finally {
        if (active && isMountedRef.current) setIsLoadingChapters(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [audiobook.id, details]);

  // 2. Fetch AI Review
  useEffect(() => {
    let isActive = true;

    async function loadReview() {
      setIsLoadingReview(true);
      setReview(null);
      setMessages([]);
      try {
        const levelPrompt = cefrLevel ? `уровень ${cefrLevel}` : "оригинал без адаптации";
        const prompt = [
          `Аудиокнига: "${audiobook.title}", автор: ${author}, язык: ${language} (${levelPrompt}).`,
          "Сделай очень короткую карточку для изучающего язык без спойлеров, без markdown и без спецсимволов.",
          "Строго 4 строки:",
          "О чем: одно короткое предложение.",
          "Жанр: 2-4 слова.",
          "Язык: сложность речи, темп дикции и понятность.",
          "Кому: кому подойдет для аудирования.",
        ].join("\n");
        const result = await aiChat(prompt);
        if (isActive && isMountedRef.current) {
          setReview(result || "О чем: аудиокнига из классической библиотеки.");
        }
      } catch {
        if (isActive && isMountedRef.current) {
          setReview(
            `О чем: классическое аудиопроизведение для тренировки понимания на слух.\nЖанр: литература в общественном достоянии.\nЯзык: неадаптированный оригинал, понятная дикция.\nКому: тем, кто развивает навык восприятия речи на ${language}.`
          );
        }
      } finally {
        if (isActive && isMountedRef.current) setIsLoadingReview(false);
      }
    }

    void loadReview();

    return () => {
      isActive = false;
    };
  }, [audiobook.id, audiobook.title, author, language, cefrLevel]);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current || !currentChapter) return;
    if (isPlaying) {
      safePause();
    } else {
      void safePlay();
    }
  }, [isPlaying, currentChapter, safePause, safePlay]);

  const handleSeek = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const handleSkip = (deltaSeconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(duration || 99999, audioRef.current.currentTime + deltaSeconds));
    handleSeek(newTime);
  };

  const handleNextChapter = useCallback(() => {
    if (currentChapterIndex < chapters.length - 1) {
      selectChapter(currentChapterIndex + 1, isPlaying);
    }
  }, [currentChapterIndex, chapters.length, isPlaying, selectChapter]);

  const handlePrevChapter = () => {
    if (currentTime > 5 || currentChapterIndex === 0) {
      handleSeek(0);
    } else {
      selectChapter(Math.max(0, currentChapterIndex - 1), isPlaying);
    }
  };

  const cyclePlaybackSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextSpeed = PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  // Sync playback speed updates
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Periodic progress saving
  useEffect(() => {
    if (!audiobook.id || currentTime === 0) return;
    saveAudiobookProgress({
      audiobookId: audiobook.id,
      chapterIndex: currentChapterIndex,
      currentTimeSeconds: currentTime,
      durationSeconds: duration,
      updatedAt: new Date().toISOString(),
    });
  }, [audiobook.id, currentChapterIndex, currentTime, duration]);

  // 4. Send Message to AI
  const handleSend = async (overrideText?: string) => {
    const userText = (overrideText || input).trim();
    if (!userText || isSending) return;

    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    if (!overrideText) setInput("");
    setIsSending(true);

    try {
      const levelPrompt = cefrLevel ? `уровень: ${cefrLevel}` : "оригинал без адаптации";
      const prompt = [
        `Мы обсуждаем аудиокнигу "${audiobook.title}" автора ${author} (язык: ${language}, ${levelPrompt}).`,
        "Отвечай кратко, понятно, по делу, без markdown и длинных списков.",
        `Вопрос пользователя: ${userText}`,
      ].join("\n");
      const response = await aiChat(prompt);
      if (isMountedRef.current) {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: cleanAiText(response || "Не получилось ответить.") },
        ]);
      }
    } catch {
      if (isMountedRef.current) {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "Не получилось связаться с AI. Попробуйте ещё раз." },
        ]);
      }
    } finally {
      if (isMountedRef.current) {
        setIsSending(false);
      }
    }
  };

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
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                <span>{language}</span>
                {cefrLevel && cefrConfidence === "verified" ? (
                  <span
                    className="cefr-badge"
                    title={cefrExplanation}
                    style={{
                      background: CEFR_COLORS[cefrLevel] || "#888",
                      color: "#fff",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    {cefrLevel}
                  </span>
                ) : cefrLevel && cefrConfidence === "approximate" ? (
                  <span
                    className="cefr-badge approximate"
                    title={cefrExplanation}
                    style={{
                      background: "rgba(212, 168, 71, 0.2)",
                      border: `1px solid ${CEFR_COLORS[cefrLevel] || "var(--accent)"}`,
                      color: CEFR_COLORS[cefrLevel] || "var(--accent)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    ≈ {cefrLevel}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      background: "rgba(240, 230, 211, 0.08)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                    title="Неадаптированный оригинал, уровень не определён"
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
            </div>
          </div>

          {/* Embedded Audio Player */}
          <section className="audio-player-card">
            <audio
              ref={audioRef}
              preload="metadata"
              onTimeUpdate={() => {
                if (audioRef.current && isMountedRef.current) {
                  setCurrentTime(audioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (audioRef.current && isMountedRef.current) {
                  setDuration(audioRef.current.duration || 0);
                  audioRef.current.playbackRate = playbackSpeed;
                }
              }}
              onEnded={handleNextChapter}
              onPause={() => {
                if (isMountedRef.current) setIsPlaying(false);
              }}
              onPlay={() => {
                if (isMountedRef.current) setIsPlaying(true);
              }}
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
                        selectChapter(idx, true);
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

          {/* AI Review Card */}
          <section className="ai-review-card">
            <div className="compact-section-title">
              <Info size={17} />
              <strong>AI-обзор аудиокниги</strong>
            </div>
            {isLoadingReview ? (
              <div className="compact-loader">
                <Loader2 size={15} className="spin" />
                <span>Оцениваю содержание и речь...</span>
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

          {/* AI Chat Card */}
          <section className="book-chat-card">
            <div className="compact-section-title chat-title">
              <MessageSquare size={17} />
              <strong>Спросить AI об аудиокниге</strong>
            </div>

            <div className="book-chat-messages">
              {messages.length === 0 && (
                <div className="chat-empty">
                  <span>
                    Спросите AI: о чем сюжет, насколько быстрая речь, какие сложные слова встретятся
                    или подходит ли книга для вашего уровня.
                  </span>
                </div>
              )}
              {messages.map((message, index) => (
                <div key={index} className={`chat-bubble ${message.role}`}>
                  {message.text}
                </div>
              ))}
              {isSending && (
                <div className="typing-row">
                  <Loader2 size={12} className="spin" />
                  AI печатает...
                </div>
              )}
            </div>

            <div className="book-chat-input">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSend();
                }}
                placeholder="Спросить об аудиокниге..."
              />
              <DictateButton
                lang="ru"
                title="Голосовой ввод вопроса"
                onText={(text: string) => {
                  setInput((prev) => appendSpoken(prev, text));
                }}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || isSending}
                type="button"
                aria-label="Отправить"
              >
                <Send size={17} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
