"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { X, ExternalLink, Subtitles, ListMusic, Loader2, Play } from "lucide-react";
import type { VideoItem } from "@/lib/videos/types";
import type { SubtitleCue } from "@/lib/videos/youtubeTranscript";
import type { UserProfile, Flashcard, AiAnalysis } from "@/lib/types";
import { WordModal } from "@/components/word-modal/WordModal";
import { analyzeSelection } from "@/lib/ai/analyze";
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
};

export function VideoPlayerModal({
  video,
  profile,
  onClose,
  onAddCard,
}: Props) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [isLoadingCues, setIsLoadingCues] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  // Word modal state for live translation & flashcard adding
  const [wordModalSelection, setWordModalSelection] = useState("");
  const [wordModalAnalysis, setWordModalAnalysis] = useState<AiAnalysis | null>(null);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [isWordModalLoading, setIsWordModalLoading] = useState(false);
  const [cardAddedNotice, setCardAddedNotice] = useState<string | null>(null);

  const playerRef = useRef<any>(null);
  const activeCueScrollRef = useRef<HTMLDivElement>(null);

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
          setCues(data.cues || []);
          setIsLoadingCues(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCues([]);
          setIsLoadingCues(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [video.youtubeId, video.language]);

  // ── 2. Initialize YouTube IFrame Player API ────────────────────────────────
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

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

    // High-frequency polling for smooth subtitle highlighting (every 150ms)
    intervalId = setInterval(() => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === "function") {
        try {
          const t = playerRef.current.getCurrentTime();
          if (typeof t === "number" && !isNaN(t)) {
            setCurrentTime(t);
          }
        } catch {}
      }
    }, 150);

    return () => {
      if (intervalId) clearInterval(intervalId);
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
  const activeCue = useMemo(() => {
    if (cues.length === 0) return null;
    return cues.find((c) => currentTime >= c.start && currentTime <= c.end + 0.3) || null;
  }, [cues, currentTime]);

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
  const handleAddCard = (front: string, back: string) => {
    if (!onAddCard) return;

    const newCard: Flashcard = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      word: front,
      translation: back,
      context: activeCue?.text || video.title,
      targetLanguage,
      level: 1,
      interval: 1,
      easeFactor: 2.5,
      repetitions: 0,
      nextReview: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    onAddCard(newCard);
    setCardAddedNotice(`«${front}» добавлено в карточки!`);
    setTimeout(() => setCardAddedNotice(null), 3000);
  };

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const youtubeWatchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;

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
          title="Нажмите для перевода и разбора"
        >
          {token}
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
        <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
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
                    <span className="video-cue-text">
                      {renderInteractiveSubtitleText(activeCue.text)}
                    </span>
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
            </div>
          ) : null}

          {/* ── Full Scrollable Transcript (Optional Accordion) ─────────────── */}
          {showFullTranscript && cues.length > 0 && (
            <div className="video-full-transcript-panel" ref={activeCueScrollRef}>
              <div className="video-transcript-list">
                {cues.map((cue, idx) => {
                  const isActive =
                    currentTime >= cue.start && currentTime <= cue.end + 0.3;
                  return (
                    <div
                      key={idx}
                      className={`video-transcript-item ${isActive ? "active" : ""}`}
                      onClick={() => handleSeekToCue(cue.start)}
                    >
                      <span className="transcript-time">{formatTime(cue.start)}</span>
                      <span className="transcript-line">
                        {renderInteractiveSubtitleText(cue.text)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Action Links */}
          <div className="video-modal-footer">
            <div className="video-modal-footer-row">
              <a
                href={youtubeWatchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="video-open-yt-btn"
              >
                <ExternalLink size={13} />
                <span>Открыть на YouTube</span>
              </a>

              {video.description && (
                <span className="video-modal-short-desc">{video.description}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Interactive WordModal for Tap-To-Translate & Cards ─────────────── */}
      {isWordModalOpen && (
        <div className="video-word-modal-layer">
          <WordModal
            analysis={wordModalAnalysis}
            isOpen={isWordModalOpen}
            isLoading={isWordModalLoading}
            nativeLanguage={nativeLanguage}
            targetLanguage={targetLanguage}
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
    </>
  );
}
