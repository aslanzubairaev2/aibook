"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { X, Subtitles, ListMusic, Loader2, Eye, EyeOff, MessageCircle, Plus, Repeat2, Maximize2, Minimize2 } from "lucide-react";
import type { VideoItem } from "@/lib/videos/types";
import type { SubtitleCue } from "@/lib/videos/youtubeTranscript";
import type { UserProfile, Flashcard, AiAnalysis, DiscussMessage } from "@/lib/types";
import { WordModal } from "@/components/word-modal/WordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { speak } from "@/lib/tts";
import { analyzeSelection, getAiHeaders } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type Props = {
  video: VideoItem;
  profile: UserProfile;
  onClose: () => void;
  onAddCard?: (card: Flashcard) => void;
  onProgress?: (current: number, duration: number, cueIndex: number, cueText: string | null) => void;
};

const TRANSLATION_PREFETCH_CUES = 4;

export function VideoPlayerModal({
  video,
  profile,
  onClose,
  onAddCard,
  onProgress,
}: Props) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [isLoadingCues, setIsLoadingCues] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [showLiveTranslation, setShowLiveTranslation] = useState(false);
  const [revealedTranslations, setRevealedTranslations] = useState<Set<number>>(new Set());
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translatingCueIndexes, setTranslatingCueIndexes] = useState<Set<number>>(new Set());
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  // Word modal state for live translation & flashcard adding
  const [wordModalSelection, setWordModalSelection] = useState("");
  const [wordModalAnalysis, setWordModalAnalysis] = useState<AiAnalysis | null>(null);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [isWordModalLoading, setIsWordModalLoading] = useState(false);
  const [cardAddedNotice, setCardAddedNotice] = useState<string | null>(null);
  const [cueCardLoading, setCueCardLoading] = useState<number | null>(null);
  const [discussCue, setDiscussCue] = useState<{ index: number; text: string } | null>(null);
  const [discussMessages, setDiscussMessages] = useState<DiscussMessage[]>([]);
  const [repeatCueIndex, setRepeatCueIndex] = useState<number | null>(null);
  const [hoveredWord, setHoveredWord] = useState<{ key: string; translation: string; loading: boolean } | null>(null);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const [watchedPercent, setWatchedPercent] = useState(0);

  const playerRef = useRef<any>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const activeCueScrollRef = useRef<HTMLDivElement>(null);
  const activeCueItemRef = useRef<HTMLDivElement>(null);
  const cuesRef = useRef<SubtitleCue[]>([]);
  const lastCueIdxRef = useRef(-1);
  const lastProgressReportRef = useRef(0);
  const repeatCueIndexRef = useRef<number | null>(null);
  const repeatJumpAtRef = useRef(0);
  const lastUiTimeRef = useRef(-Infinity);
  const onProgressRef = useRef(onProgress);
  repeatCueIndexRef.current = repeatCueIndex;
  onProgressRef.current = onProgress;

  useEffect(() => {
    const handleFullscreenChange = () => setIsVideoFullscreen(document.fullscreenElement === modalContentRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const nativeLanguage = profile.nativeLanguage || "ru";
  const targetLanguage = video.language || profile.targetLanguage || "de";

  // ── 1. Fetch timed subtitles from backend ──────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    setIsLoadingCues(true);

    fetch(`/api/videos/transcript?v=${video.youtubeId}&lang=${video.language}`)
      .then((res) => (res.ok ? res.json() : { cues: [] }))
      .then((data) => {
        if (isMounted) {
          const c = data.cues || [];
          setCues(c);
          cuesRef.current = c;
          setShowLiveTranslation(false);
          setRevealedTranslations(new Set());
          setTranslations({});
          setTranslationError(null);
          setIsLoadingCues(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCues([]);
          cuesRef.current = [];
          setIsLoadingCues(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [video.youtubeId, video.language]);

  // ── 2. Initialize YouTube IFrame Player API ────────────────────────────────
  useEffect(() => {
    let rafId: number | null = null;
    const createPlayer = () => {
      if (!window.YT || !window.YT.Player) return;

      try {
        playerRef.current = new window.YT.Player("yt-player-target", {
          videoId: video.youtubeId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            rel: 0,
            modestbranding: 1,
            origin: typeof window !== "undefined" ? window.location.origin : "",
          },
          events: {
            onReady: () => {
              setPlayerReady(true);
            },
          },
        });
      } catch (err) {
        console.error("YT Player init error:", err);
      }
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      if (!document.getElementById("yt-iframe-api-script")) {
        const tag = document.createElement("script");
        tag.id = "yt-iframe-api-script";
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = createPlayer;
    }

    // requestAnimationFrame loop for near-zero latency subtitle sync
    const tick = () => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === "function") {
        try {
          const t = playerRef.current.getCurrentTime();
          if (typeof t === "number" && !isNaN(t)) {
            // Find which cue is active at this time
            const cs = cuesRef.current;
            const idx = cs.findIndex((c) => t >= c.start && t < c.end);
            const repeatedIndex = repeatCueIndexRef.current;
            const repeatedCue = repeatedIndex === null ? null : cs[repeatedIndex];
            if (repeatedCue && t >= repeatedCue.end) {
              if (performance.now() - repeatJumpAtRef.current > 250) {
                repeatJumpAtRef.current = performance.now();
                lastCueIdxRef.current = -1;
                setCurrentTime(repeatedCue.start);
                try {
                  playerRef.current.seekTo(repeatedCue.start, true);
                  playerRef.current.playVideo();
                } catch {}
              }
              return;
            }
            // Only trigger re-render when the active cue changes
            if (idx !== lastCueIdxRef.current || t - lastUiTimeRef.current >= 0.25) {
              lastCueIdxRef.current = idx;
              lastUiTimeRef.current = t;
              setCurrentTime(t);
            }
            if (onProgressRef.current && t - lastProgressReportRef.current >= 2) {
              lastProgressReportRef.current = t;
              const duration = typeof playerRef.current.getDuration === "function" ? playerRef.current.getDuration() : 0;
              const safeDuration = typeof duration === "number" && Number.isFinite(duration) ? duration : 0;
              if (safeDuration > 0) setWatchedPercent(Math.min(100, (t / safeDuration) * 100));
              onProgressRef.current(t, safeDuration, idx, cs[idx]?.text || null);
            }
          }
        } catch {}
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (playerRef.current && typeof playerRef.current.destroy === "function") {
        try {
          playerRef.current.destroy();
        } catch {}
      }
    };
  }, [video.youtubeId]);

  // Keyboard close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isWordModalOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isWordModalOpen]);

  // ── 3. Find Active Subtitle Cue ────────────────────────────────────────────
  const activeCueIndex = useMemo(() => {
    if (cues.length === 0) return -1;
    return cues.findIndex((c) => currentTime >= c.start && currentTime < c.end);
  }, [cues, currentTime]);

  const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;

  const requestTranslations = useCallback(async (indexes: number[]) => {
    const missing = indexes.filter((index) => cues[index] && !translations[index] && !translatingCueIndexes.has(index));
    if (missing.length === 0) return;

    setTranslationError(null);
    setTranslatingCueIndexes((current) => new Set([...current, ...missing]));
    try {
      const { getAiHeaders } = await import("@/lib/ai/analyze");
      const response = await fetch("/api/videos/translate", {
        method: "POST",
        headers: await getAiHeaders(),
        body: JSON.stringify({
          cues: missing.map((index) => cues[index].text),
          sourceLanguage: targetLanguage,
          targetLanguage: nativeLanguage,
        }),
      });
      const data = await response.json() as { translations?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось перевести субтитры.");
      setTranslations((current) => {
        const next = { ...current };
        missing.forEach((index, translationIndex) => {
          const translation = data.translations?.[translationIndex];
          if (translation) next[index] = translation;
        });
        return next;
      });
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Не удалось перевести субтитры.");
    } finally {
      setTranslatingCueIndexes((current) => {
        const next = new Set(current);
        missing.forEach((index) => next.delete(index));
        return next;
      });
    }
  }, [cues, nativeLanguage, targetLanguage, translations, translatingCueIndexes]);

  const isTranslationVisible = useCallback((index: number) => revealedTranslations.has(index), [revealedTranslations]);

  const toggleAllTranslations = () => {
    const nextVisible = !showLiveTranslation;
    setShowLiveTranslation(nextVisible);
    if (nextVisible && activeCueIndex >= 0) {
      void requestTranslations(cues.slice(activeCueIndex, activeCueIndex + TRANSLATION_PREFETCH_CUES).map((_, offset) => activeCueIndex + offset));
    }
  };

  useEffect(() => {
    if (!showLiveTranslation || activeCueIndex < 0) return;
    void requestTranslations(cues.slice(activeCueIndex, activeCueIndex + TRANSLATION_PREFETCH_CUES).map((_, offset) => activeCueIndex + offset));
  }, [activeCueIndex, cues, requestTranslations, showLiveTranslation]);

  const toggleCueTranslation = (index: number) => {
    if (isTranslationVisible(index)) {
      setRevealedTranslations((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
      });
      return;
    }
    setRevealedTranslations((current) => new Set(current).add(index));
    void requestTranslations([index]);
  };

  const renderCueTranslation = (index: number, compact = false, forceVisible?: boolean, showToggle = true) => {
    const visible = forceVisible ?? isTranslationVisible(index);
    const isLoading = translatingCueIndexes.has(index);
    const translation = translations[index];
    return (
      <div className={`video-cue-translation ${compact ? "compact" : ""} ${visible ? "revealed" : "blurred"}`}>
        <span>{isLoading ? "Переводим…" : translation || "Перевод скрыт"}</span>
        {showToggle && <button
          type="button"
          className="video-translation-eye"
          onClick={(event) => {
            event.stopPropagation();
            toggleCueTranslation(index);
          }}
          aria-label={visible ? "Скрыть перевод строки" : "Показать перевод строки"}
          title={visible ? "Скрыть перевод строки" : "Показать перевод строки"}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>}
      </div>
    );
  };

  // ── 3b. Auto-scroll transcript to keep active cue centered ────────────────
  useEffect(() => {
    if (showFullTranscript && activeCueItemRef.current) {
      activeCueItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeCueIndex, showFullTranscript]);

  // ── 4. Word Tap → Pause & Word Analysis ───────────────────────────────────
  const handleWordTap = useCallback(
    async (rawWord: string, contextSentence: string) => {
      const cleanWord = rawWord.trim().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
      if (!cleanWord || cleanWord.length < 2) return;

      // 1. Pause video playback immediately
      if (playerRef.current && typeof playerRef.current.pauseVideo === "function") {
        try {
          playerRef.current.pauseVideo();
        } catch {}
      }

      // 2. Open WordModal
      setWordModalSelection(cleanWord);
      setIsWordModalOpen(true);
      setIsWordModalLoading(true);
      setWordModalAnalysis(null);

      const cacheKey = makeAiCacheKey("word", cleanWord, targetLanguage, nativeLanguage);
      try {
        let full = getLocalAiAnalysis(cacheKey);
        if (!full?.word) {
          full = await analyzeSelection({
            mode: "word",
            word: cleanWord,
            text: cleanWord,
            sentence: contextSentence || cleanWord,
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
    },
    [targetLanguage, nativeLanguage]
  );

  const hoverWordRequests = useRef(new Set<string>());
  const handleWordHover = useCallback(async (rawWord: string, contextSentence: string) => {
    const cleanWord = rawWord.trim().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
    if (!cleanWord || cleanWord.length < 2) return;
    const key = makeAiCacheKey("word", cleanWord, targetLanguage, nativeLanguage);
    const cached = getLocalAiAnalysis(key);
    if (cached?.word?.translation) {
      setHoveredWord({ key, translation: cached.word.translation, loading: false });
      return;
    }
    setHoveredWord({ key, translation: "", loading: true });
    if (hoverWordRequests.current.has(key)) return;
    hoverWordRequests.current.add(key);
    try {
      const analysis = await analyzeSelection({
        mode: "word",
        word: cleanWord,
        text: cleanWord,
        sentence: contextSentence || cleanWord,
        sentenceBefore: "",
        sentenceAfter: "",
        nativeLanguage,
        targetLanguage,
      });
      if (analysis?.word) {
        saveLocalAiAnalysis(key, analysis);
        setHoveredWord((current) => current?.key === key ? { key, translation: analysis.word?.translation || "", loading: false } : current);
      }
    } finally {
      hoverWordRequests.current.delete(key);
    }
  }, [nativeLanguage, targetLanguage]);

  // Jump to cue timestamp
  const handleSeekToCue = (startSec: number) => {
    if (playerRef.current && typeof playerRef.current.seekTo === "function") {
      try {
        playerRef.current.seekTo(Math.max(0, startSec - 0.2), true);
        playerRef.current.playVideo();
      } catch {}
    }
  };

  // Add card handler
  const handleAddCard = (front: string, back: string, type: Flashcard["type"] = "word", source = activeCue?.text || video.title) => {
    if (!onAddCard) return;

    const newCard: Flashcard = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      front,
      back,
      source,
      addedAt: new Date().toISOString(),
      status: "new",
      lapses: 0,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      dueAt: new Date().toISOString(),
    };

    onAddCard(newCard);
    setCardAddedNotice(`«${front}» добавлено в карточки!`);
    setTimeout(() => setCardAddedNotice(null), 3000);
  };

  const handleAddCueCard = async (index: number) => {
    const cue = cues[index];
    if (!cue || cueCardLoading !== null) return;
    setCueCardLoading(index);
    let back = translations[index] || "";
    try {
      if (!back) {
        const response = await fetch("/api/videos/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await getAiHeaders()) },
          body: JSON.stringify({ cues: [cue.text], sourceLanguage: targetLanguage, targetLanguage: nativeLanguage }),
        });
        const data = await response.json() as { translations?: string[] };
        back = data.translations?.[0] || "";
      }
    } catch {
      // A sentence card can still be saved when the optional translation call fails.
    }
    handleAddCard(cue.text, back, "sentence", cue.text);
    setCueCardLoading(null);
  };

  const handleDiscussCue = (index: number, selectedText?: string) => {
    const cue = cues[index];
    if (!cue) return;
    if (playerRef.current && typeof playerRef.current.pauseVideo === "function") {
      try { playerRef.current.pauseVideo(); } catch {}
    }
    setDiscussCue({ index, text: selectedText?.trim() || cue.text });
    setDiscussMessages([]);
  };

  const toggleRepeatCue = (index: number) => {
    setRepeatCueIndex((current) => {
      const next = current === index ? null : index;
      lastCueIdxRef.current = -1;
      return next;
    });
  };

  const handleCueTextSelection = (index: number) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (!selection || text.split(/\s+/).length < 2) return;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    const container = document.querySelector(`[data-cue-text="${index}"]`);
    if (!container || !anchor || !focus || !container.contains(anchor) || !container.contains(focus)) return;
    selection.removeAllRanges();
    handleDiscussCue(index, text);
  };

  useEffect(() => {
    const handleVideoShortcut = (event: KeyboardEvent) => {
      if (event.repeat || isWordModalOpen || discussCue) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.code === "Space") {
        event.preventDefault();
        const playerState = typeof playerRef.current?.getPlayerState === "function" ? playerRef.current.getPlayerState() : -1;
        if (playerState === 2) playerRef.current?.playVideo?.();
        else playerRef.current?.pauseVideo?.();
        return;
      }
      const cueIndex = activeCueIndex;
      const cue = cueIndex >= 0 ? cues[cueIndex] : null;
      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        const nextIndex = event.code === "ArrowUp"
          ? Math.max(0, cueIndex > 0 ? cueIndex - 1 : cues.findIndex((item) => item.start < currentTime))
          : cueIndex >= 0 ? Math.min(cues.length - 1, cueIndex + 1) : cues.findIndex((item) => item.start > currentTime);
        if (nextIndex >= 0 && cues[nextIndex]) {
          event.preventDefault();
          handleSeekToCue(cues[nextIndex].start);
        }
        return;
      }
      if (!cue) return;

      if (event.code === "Numpad4") {
        event.preventDefault();
        toggleCueTranslation(cueIndex);
      } else if (event.code === "Numpad5") {
        event.preventDefault();
        void speak(cue.text, targetLanguage);
      } else if (event.code === "Numpad6") {
        event.preventDefault();
        handleDiscussCue(cueIndex);
      } else if (event.code === "NumpadAdd" || event.key === "+") {
        event.preventDefault();
        void handleAddCueCard(cueIndex);
      }
    };

    window.addEventListener("keydown", handleVideoShortcut);
    return () => window.removeEventListener("keydown", handleVideoShortcut);
  }, [activeCueIndex, cues, currentTime, discussCue, handleAddCueCard, handleDiscussCue, isWordModalOpen, targetLanguage]);

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Helper to tokenize subtitle text into words
  const renderInteractiveSubtitleText = (text: string) => {
    const tokens = text.split(/(\s+)/);
    return tokens.map((token, idx) => {
      const isWord = /[\p{L}\d]/u.test(token);
      if (!isWord) {
        return <span key={idx}>{token}</span>;
      }
      return (
        <button
          key={idx}
          type="button"
          className="sub-interactive-word"
          onClick={(e) => {
            e.stopPropagation();
            void handleWordTap(token, text);
          }}
          onMouseEnter={() => void handleWordHover(token, text)}
          onMouseLeave={() => {
            const cleanWord = token.trim().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
            const key = makeAiCacheKey("word", cleanWord, targetLanguage, nativeLanguage);
            setHoveredWord((current) => current?.key === key ? null : current);
          }}
          aria-label={`Перевод и разбор слова: ${token}`}
        >
          {token}
          {hoveredWord?.key === makeAiCacheKey("word", token.trim().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ""), targetLanguage, nativeLanguage) && (
            <span className="sub-word-tooltip" role="status">
              {hoveredWord.loading ? "Переводим…" : hoveredWord.translation || "Перевод недоступен"}
            </span>
          )}
        </button>
      );
    });
  };

  return (
    <>
      <div
        className="video-modal-overlay"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-modal-title"
      >
        <div ref={modalContentRef} className="video-modal-content" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <header className="video-modal-header">
            <div className="video-modal-title-wrap">
              <h2 id="video-modal-title" className="video-modal-title">
                {video.title}
              </h2>
              <div className="video-modal-sub">
                <span className="video-modal-channel">{video.channel}</span>
                {video.cefrLevel && video.cefrLevel !== "all" && (
                  <span className="video-modal-level">{video.cefrLevel}</span>
                )}
                {cues.length > 0 && (
                  <span className="video-captions-badge">
                    <Subtitles size={12} />
                    <span>Синхронный текст</span>
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="video-modal-fullscreen-btn"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void modalContentRef.current?.requestFullscreen();
              }}
              aria-label={isVideoFullscreen ? "Свернуть видео" : "Развернуть видео вместе с репликами"}
              title={isVideoFullscreen ? "Свернуть видео" : "Развернуть видео вместе с репликами"}
            >
              {isVideoFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button
              type="button"
              className="video-modal-close-btn"
              onClick={onClose}
              aria-label="Закрыть плеер"
            >
              <X size={18} />
            </button>
          </header>

          {/* Card added toast */}
          {cardAddedNotice && (
            <div className="video-card-toast" role="alert">
              {cardAddedNotice}
            </div>
          )}

          {/* Video Player */}
          <div className="video-player-container">
            <div id="yt-player-target" className="video-iframe" />
          </div>
          <div className="video-player-progress" aria-label={`Просмотрено ${Math.round(watchedPercent)} процентов`}><span style={{ width: `${watchedPercent}%` }} /></div>

          {/* ── Synchronized Interactive Subtitle Bar ──────────────────────── */}
          {isLoadingCues ? (
            <div className="video-subtitle-bar loading">
              <Loader2 size={14} className="spin" />
              <span>Загрузка синхронных субтитров...</span>
            </div>
          ) : cues.length > 0 ? (
            <div className="video-subtitle-bar">
              <div className="video-subtitle-live-content">
                {activeCue ? (
                  <div className="video-live-cue">
                    <span className="video-cue-time">{formatTime(activeCue.start)}</span>
                    <div className="video-cue-copy">
                      <span className="video-cue-text">{renderInteractiveSubtitleText(activeCue.text)}</span>
                      {renderCueTranslation(activeCueIndex, true, showLiveTranslation, false)}
                    </div>
                  </div>
                ) : (
                  <div className="video-live-cue placeholder">
                    <span className="video-cue-hint">
                      Слушайте речь — слова появятся синхронно. Нажмите на любое слово для перевода.
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`video-transcript-toggle-btn ${showFullTranscript ? "active" : ""}`}
                onClick={() => setShowFullTranscript((v) => !v)}
                title="Показать полный транскрипт"
              >
                <ListMusic size={14} />
                <span>{showFullTranscript ? "Скрыть текст" : `Текст (${cues.length})`}</span>
              </button>
              <button
                type="button"
                className={`video-transcript-toggle-btn ${showLiveTranslation ? "active" : ""}`}
                onClick={toggleAllTranslations}
                title={showLiveTranslation ? "Скрыть перевод текущей фразы" : "Показать перевод текущей фразы"}
                aria-label={showLiveTranslation ? "Скрыть перевод текущей фразы" : "Показать перевод текущей фразы"}
              >
                {showLiveTranslation ? <EyeOff size={14} /> : <Eye size={14} />}
                <span>{showLiveTranslation ? "Скрыть перевод" : "Перевод"}</span>
              </button>
            </div>
          ) : null}

          {translationError && <div className="video-translation-error" role="status">{translationError}</div>}

          {/* ── Full Scrollable Transcript (Optional Accordion) ─────────────── */}
          {showFullTranscript && cues.length > 0 && (
            <div className="video-full-transcript-panel" ref={activeCueScrollRef}>
              <div className="video-transcript-list">
              {cues.map((cue, idx) => {
                  const isActive = idx === activeCueIndex;
                  return (
                    <div
                      key={idx}
                      ref={isActive ? activeCueItemRef : undefined}
                      className={`video-transcript-item ${isActive ? "active" : ""}`}
                      onClick={() => handleSeekToCue(cue.start)}
                    >
                      <span className="transcript-time">{formatTime(cue.start)}</span>
                      <div className="transcript-line">
                        <span className="video-transcript-text" data-cue-text={idx} onMouseUp={() => handleCueTextSelection(idx)} onTouchEnd={() => handleCueTextSelection(idx)}>{renderInteractiveSubtitleText(cue.text)}</span>
                        {renderCueTranslation(idx, false, undefined, false)}
                      </div>
                      <div className="video-cue-actions" aria-label="Действия с репликой">
                        <button
                          type="button"
                          className="video-cue-action-btn"
                          onClick={(event) => { event.stopPropagation(); toggleCueTranslation(idx); }}
                          aria-label={isTranslationVisible(idx) ? "Скрыть перевод строки" : "Показать перевод строки"}
                          title={isTranslationVisible(idx) ? "Скрыть перевод строки" : "Показать перевод строки"}
                        >
                          {isTranslationVisible(idx) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <SpeakButton text={cue.text} lang={targetLanguage} size={14} />
                        <button
                          type="button"
                          className={`video-cue-action-btn ${repeatCueIndex === idx ? "active" : ""}`}
                          onClick={(event) => { event.stopPropagation(); toggleRepeatCue(idx); }}
                          aria-label={repeatCueIndex === idx ? "Выключить повтор реплики" : "Повторять реплику"}
                          title={repeatCueIndex === idx ? "Выключить повтор реплики" : "Повторять реплику"}
                        >
                          <Repeat2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="video-cue-action-btn"
                          onClick={(event) => { event.stopPropagation(); handleDiscussCue(idx); }}
                          aria-label="Обсудить реплику с AI"
                          title="Обсудить реплику с AI"
                        >
                          <MessageCircle size={14} />
                        </button>
                        <button
                          type="button"
                          className="video-cue-action-btn"
                          onClick={(event) => { event.stopPropagation(); void handleAddCueCard(idx); }}
                          aria-label="Добавить реплику в карточки"
                          title="Добавить реплику в карточки"
                          disabled={cueCardLoading === idx}
                        >
                          {cueCardLoading === idx ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Interactive WordModal for Tap-To-Translate & Cards ─────────────── */}
      {isWordModalOpen && (
        <div className="video-word-modal-layer">
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
              const front = wordModalSelection;
              const back = wordModalAnalysis?.word?.translation ?? "";
              handleAddCard(front, back);
              setIsWordModalOpen(false);
            }}
            onAddLemma={(lemma) => {
              const front = lemma;
              const back = wordModalAnalysis?.word?.translation ?? "";
              handleAddCard(front, back);
              setIsWordModalOpen(false);
            }}
            onWordTap={(word) => {
              void handleWordTap(word, activeCue?.text || "");
            }}
          />
        </div>
      )}

      {discussCue && (
        <div className="video-discuss-modal-layer">
        <DiscussAiModal
          isOpen
          mode="sentence"
          selectedText={discussCue.text}
          sentence={discussCue.text}
          sentenceBefore={cues[discussCue.index - 1]?.text || ""}
          sentenceAfter={cues[discussCue.index + 1]?.text || ""}
          nativeLanguage={nativeLanguage}
          targetLanguage={targetLanguage}
          messages={discussMessages}
          onMessagesChange={setDiscussMessages}
          onClose={() => setDiscussCue(null)}
          onWordTap={(word, contextSentence) => void handleWordTap(word, contextSentence)}
        />
        </div>
      )}
    </>
  );
}
