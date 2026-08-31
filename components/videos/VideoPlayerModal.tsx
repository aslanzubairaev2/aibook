"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Subtitles, ListMusic, Loader2, Eye, EyeOff, MessageCircle, Plus, Repeat2, Maximize2, Minimize2, Play, Pause } from "lucide-react";
import type { VideoItem } from "@/lib/videos/types";
import type { SubtitleCue } from "@/lib/videos/youtubeTranscript";
import { loadTranscript } from "@/lib/videos/loadTranscript";
import type { UserProfile, Flashcard, AiAnalysis, DiscussMessage, AiMode } from "@/lib/types";
import { WordModal } from "@/components/word-modal/WordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { AiPanel } from "@/components/ai-panel/AiPanel";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { speak } from "@/lib/tts";
import { analyzeSelection, getAiHeaders } from "@/lib/ai/analyze";
import { makeAiCacheKey, makeDiscussCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, getLocalDiscussHistory, saveLocalAiAnalysis, saveLocalDiscussHistory } from "@/lib/db/local";
import { sbGetCachedAnalysis, sbGetCachedWord, sbGetDiscussHistory, sbSaveCachedAnalysis, sbSaveCachedWord, sbSaveDiscussHistory } from "@/lib/db/supabase";

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
  userId?: string | null;
  resumePositionSeconds?: number;
  onAddCard?: (card: Flashcard) => void;
  onProgress?: (current: number, duration: number, cueIndex: number, cueText: string | null) => void;
};

const TRANSLATION_PREFETCH_CUES = 4;
const SEPARABLE_PARTICLES = new Set(["ab", "an", "auf", "aus", "ein", "mit", "nach", "vor", "weg", "zu", "zurück", "zusammen"]);

function inferSeparableVerb(rawWord: string, sentence: string): string | null {
  const word = rawWord.toLowerCase();
  if (new Set(["bin", "bist", "ist", "sind", "war", "waren", "hat", "haben"]).has(word)) return null;
  const tokens = sentence.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const wordIndex = tokens.indexOf(word);
  if (wordIndex < 0) return null;
  const particle = tokens.slice(wordIndex + 1, Math.min(tokens.length, wordIndex + 6)).find((token) => SEPARABLE_PARTICLES.has(token));
  if (!particle || !/[a-zäöüß]/u.test(word)) return null;
  let stem = word;
  if (/(?:st|t|en|e)$/u.test(stem)) stem = stem.replace(/(?:st|t|en|e)$/u, "");
  if (stem.length < 2) return null;
  return `${particle}${stem}en`;
}

export function VideoPlayerModal({
  video,
  profile,
  userId,
  resumePositionSeconds = 0,
  onClose,
  onAddCard,
  onProgress,
}: Props) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [isLoadingCues, setIsLoadingCues] = useState(true);
  const [subtitleStatus, setSubtitleStatus] = useState("Загрузка синхронных субтитров…");
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleRetry, setSubtitleRetry] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [showLiveTranslation, setShowLiveTranslation] = useState(false);
  const [revealedTranslations, setRevealedTranslations] = useState<Set<number>>(new Set());
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translatingCueIndexes, setTranslatingCueIndexes] = useState<Set<number>>(new Set());
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [isPlayerPlaying, setIsPlayerPlaying] = useState(false);

  // Word modal state for live translation & flashcard adding
  const [wordModalSelection, setWordModalSelection] = useState("");
  const [wordModalAnalysis, setWordModalAnalysis] = useState<AiAnalysis | null>(null);
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [isWordModalLoading, setIsWordModalLoading] = useState(false);
  const [cardAddedNotice, setCardAddedNotice] = useState<string | null>(null);
  const [cueCardLoading, setCueCardLoading] = useState<number | null>(null);
  const [discussCue, setDiscussCue] = useState<{ index: number; text: string; mode: AiMode; sentence: string } | null>(null);
  const [discussMessages, setDiscussMessages] = useState<DiscussMessage[]>([]);
  const [discussKey, setDiscussKey] = useState("");
  const [isDiscussHistoryLoading, setIsDiscussHistoryLoading] = useState(false);
  const [repeatCueIndex, setRepeatCueIndex] = useState<number | null>(null);
  const [dragSelection, setDragSelection] = useState<{ cueIndex: number; startToken: number; endToken: number } | null>(null);
  const [panelSelection, setPanelSelection] = useState<{ cueIndex: number; text: string } | null>(null);
  const [panelAnalysis, setPanelAnalysis] = useState<AiAnalysis | null>(null);
  const [isPanelLoading, setIsPanelLoading] = useState(false);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const [overlayPortalTarget, setOverlayPortalTarget] = useState<HTMLElement | null>(
    () => (typeof document === "undefined" ? null : document.body),
  );
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
  const hasRestoredPositionRef = useRef(false);
  const dragSelectionRef = useRef<typeof dragSelection>(null);
  const suppressWordClickRef = useRef(false);
  repeatCueIndexRef.current = repeatCueIndex;
  onProgressRef.current = onProgress;

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenRoot = document.fullscreenElement === modalContentRef.current
        ? modalContentRef.current
        : null;
      setIsVideoFullscreen(Boolean(fullscreenRoot));
      setOverlayPortalTarget(fullscreenRoot ?? document.body);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const nativeLanguage = profile.nativeLanguage || "ru";
  const targetLanguage = video.language || profile.targetLanguage || "de";

  // ── 1. Fetch timed subtitles from backend ──────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingCues(true);
    setSubtitleError(null);
    setSubtitleStatus("Загрузка синхронных субтитров…");
    setCues([]);
    cuesRef.current = [];
    void loadTranscript(video.youtubeId, video.language, controller.signal, setSubtitleStatus)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setCues(loaded);
        cuesRef.current = loaded;
        setShowLiveTranslation(false);
        setRevealedTranslations(new Set());
        setTranslations({});
        setTranslationError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setSubtitleError(error instanceof Error ? error.message : "Не удалось загрузить субтитры.");
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingCues(false); });
    return () => controller.abort();
  }, [video.youtubeId, video.language, subtitleRetry]);

  useEffect(() => {
    setPlayerReady(false);
    hasRestoredPositionRef.current = false;
  }, [video.youtubeId]);

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
            onStateChange: (event: { data: number }) => {
              setIsPlayerPlaying(event.data === 1);
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
            if (repeatedCue && t >= repeatedCue.end && playerRef.current.getPlayerState?.() === 1) {
              if (performance.now() - repeatJumpAtRef.current > 250) {
                repeatJumpAtRef.current = performance.now();
                lastCueIdxRef.current = repeatedIndex ?? -1;
                lastUiTimeRef.current = repeatedCue.start;
                setCurrentTime(repeatedCue.start);
                try {
                  playerRef.current.seekTo(repeatedCue.start, true);
                  playerRef.current.playVideo();
                } catch {}
              }
            } else if (idx !== lastCueIdxRef.current || t - lastUiTimeRef.current >= 0.25) {
              // Only trigger re-render when the active cue changes. This branch
              // deliberately does not run after a repeat seek, but the RAF loop
              // always continues below.
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

  // Restore the last position only after the IFrame API has finished loading.
  // The parent may receive the remote progress a moment after the modal opens,
  // so a zero position is deliberately not treated as a completed restore.
  useEffect(() => {
    if (!playerReady || hasRestoredPositionRef.current) return;
    const position = Number(resumePositionSeconds);
    if (!Number.isFinite(position) || position <= 3) return;

    const player = playerRef.current;
    if (!player || typeof player.seekTo !== "function") return;
    try {
      const duration = typeof player.getDuration === "function" ? Number(player.getDuration()) : 0;
      if (duration > 0 && position >= duration - 5) return;
      hasRestoredPositionRef.current = true;
      player.seekTo(position, true);
      player.playVideo();
    } catch {
      // The player can briefly reject a seek while its media is still loading.
      // A later progress update can retry because the ref remains false.
    }
  }, [playerReady, resumePositionSeconds]);

  const reportProgressNow = useCallback(() => {
    const player = playerRef.current;
    if (!player || typeof player.getCurrentTime !== "function" || !onProgressRef.current) return;
    try {
      const current = Number(player.getCurrentTime());
      const duration = typeof player.getDuration === "function" ? Number(player.getDuration()) : 0;
      if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return;
      const cueIndex = cuesRef.current.findIndex((cue) => current >= cue.start && current < cue.end);
      lastProgressReportRef.current = current;
      setWatchedPercent(Math.min(100, (current / duration) * 100));
      onProgressRef.current(current, duration, cueIndex, cuesRef.current[cueIndex]?.text || null);
    } catch {
      // The iframe may already be destroyed while the modal is closing.
    }
  }, []);

  const handleClose = useCallback(() => {
    reportProgressNow();
    onClose();
  }, [onClose, reportProgressNow]);

  // Keyboard close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isWordModalOpen) {
        handleClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, isWordModalOpen]);

  // ── 3. Find Active Subtitle Cue ────────────────────────────────────────────
  const activeCueIndex = useMemo(() => {
    if (cues.length === 0) return -1;
    return cues.findIndex((c) => currentTime >= c.start && currentTime < c.end);
  }, [cues, currentTime]);

  const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;

  const requestTranslations = useCallback(async (indexes: number[]) => {
    const requested = [...new Set(indexes)].filter((index) => cues[index] && !translations[index] && !translatingCueIndexes.has(index));
    if (requested.length === 0) return;

    const localHits: Record<number, string> = {};
    const missingLocal = requested.filter((index) => {
      const key = makeAiCacheKey("sentence", cues[index].text, targetLanguage, nativeLanguage);
      const cached = getLocalAiAnalysis(key)?.sentence?.translation;
      if (cached) localHits[index] = cached;
      return !cached;
    });
    if (Object.keys(localHits).length > 0) {
      setTranslations((current) => ({ ...current, ...localHits }));
    }
    if (missingLocal.length === 0) return;

    setTranslationError(null);
    setTranslatingCueIndexes((current) => new Set([...current, ...missingLocal]));
    try {
      const remoteResults = await Promise.all(missingLocal.map(async (index) => {
        const key = makeAiCacheKey("sentence", cues[index].text, targetLanguage, nativeLanguage);
        const cached = await sbGetCachedAnalysis(key);
        return { index, key, translation: cached?.sentence?.translation || "" };
      }));
      const remoteHits: Record<number, string> = {};
      for (const result of remoteResults) {
        if (!result.translation) continue;
        remoteHits[result.index] = result.translation;
        saveLocalAiAnalysis(result.key, {
          sentence: { text: cues[result.index].text, translation: result.translation },
        });
      }
      if (Object.keys(remoteHits).length > 0) {
        setTranslations((current) => ({ ...current, ...remoteHits }));
      }

      const missing = missingLocal.filter((index) => !remoteHits[index]);
      if (missing.length === 0) return;
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
          if (translation) {
            next[index] = translation;
            const key = makeAiCacheKey("sentence", cues[index].text, targetLanguage, nativeLanguage);
            const analysis: AiAnalysis = { sentence: { text: cues[index].text, translation } };
            saveLocalAiAnalysis(key, analysis);
            void sbSaveCachedAnalysis(key, "sentence", analysis);
          }
        });
        return next;
      });
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Не удалось перевести субтитры.");
    } finally {
      setTranslatingCueIndexes((current) => {
        const next = new Set(current);
        missingLocal.forEach((index) => next.delete(index));
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
      const lookupWord = inferSeparableVerb(cleanWord, contextSentence) || cleanWord;

      // 1. Pause video playback immediately
      if (playerRef.current && typeof playerRef.current.pauseVideo === "function") {
        try {
          playerRef.current.pauseVideo();
        } catch {}
      }

      // 2. Open WordModal
      setWordModalSelection(lookupWord);
      setIsWordModalOpen(true);
      setIsWordModalLoading(true);
      setWordModalAnalysis(null);

      const cacheKey = makeAiCacheKey("word", lookupWord, targetLanguage, nativeLanguage);
      try {
        let full = getLocalAiAnalysis(cacheKey);
        if (!full?.word) {
          full = await sbGetCachedWord(lookupWord, targetLanguage, nativeLanguage);
          if (full?.word) saveLocalAiAnalysis(cacheKey, full);
        }
        if (!full?.word) {
          full = await analyzeSelection({
            mode: "word",
            word: lookupWord,
            text: lookupWord,
            sentence: contextSentence || cleanWord,
            sentenceBefore: "",
            sentenceAfter: "",
            nativeLanguage,
            targetLanguage,
          });
          if (full?.word) {
            saveLocalAiAnalysis(cacheKey, full);
            void sbSaveCachedWord(lookupWord, targetLanguage, nativeLanguage, full);
          }
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

  const togglePlayerPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (isPlayerPlaying) player.pauseVideo?.();
      else player.playVideo?.();
    } catch {
      // The iframe may still be changing state after a seek.
    }
  }, [isPlayerPlaying]);

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

  const handleDiscussCue = useCallback(async (index: number, selectedText?: string, mode: AiMode = "sentence", sentenceOverride?: string) => {
    const cue = cues[index];
    if (!cue) return;
    if (playerRef.current && typeof playerRef.current.pauseVideo === "function") {
      try { playerRef.current.pauseVideo(); } catch {}
    }
    const text = selectedText?.trim() || cue.text;
    const sentence = sentenceOverride?.trim() || cue.text;
    const key = makeDiscussCacheKey(mode, text, targetLanguage, nativeLanguage);
    setDiscussCue({ index, text, mode, sentence });
    setDiscussKey(key);
    setDiscussMessages(getLocalDiscussHistory(key));
    setIsDiscussHistoryLoading(Boolean(userId));
    if (!userId) return;
    try {
      const remoteHistory = await sbGetDiscussHistory(userId, key);
      if (remoteHistory.length > 0) {
        saveLocalDiscussHistory(key, remoteHistory);
        setDiscussMessages(remoteHistory);
      }
    } finally {
      setIsDiscussHistoryLoading(false);
    }
  }, [cues, nativeLanguage, targetLanguage, userId]);

  const handleDiscussWord = useCallback((word: string, sentence?: string) => {
    const index = activeCueIndex >= 0 ? activeCueIndex : 0;
    void handleDiscussCue(index, word, "word", sentence || word);
  }, [activeCueIndex, handleDiscussCue]);

  const handleDiscussMessagesChange = useCallback((messages: DiscussMessage[]) => {
    setDiscussMessages(messages);
    if (!discussKey) return;
    saveLocalDiscussHistory(discussKey, messages);
    if (userId) void sbSaveDiscussHistory(userId, discussKey, messages);
  }, [discussKey, userId]);

  const toggleRepeatCue = (index: number) => {
    setRepeatCueIndex((current) => {
      const next = current === index ? null : index;
      lastCueIdxRef.current = -1;
      return next;
    });
  };

  const openSelectionPanel = useCallback(async (cueIndex: number, text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    playerRef.current?.pauseVideo?.();
    setPanelSelection({ cueIndex, text: normalized });
    setPanelAnalysis(null);
    setIsPanelLoading(true);
    const key = makeAiCacheKey("sentence", normalized, targetLanguage, nativeLanguage);
    try {
      let analysis = getLocalAiAnalysis(key);
      if (!analysis?.sentence) {
        analysis = await sbGetCachedAnalysis(key);
        if (analysis?.sentence) saveLocalAiAnalysis(key, analysis);
      }
      if (!analysis?.sentence) {
        analysis = await analyzeSelection({
          mode: "sentence",
          word: normalized.split(/\s+/)[0] || normalized,
          text: normalized,
          sentence: normalized,
          sentenceBefore: cues[cueIndex - 1]?.text || "",
          sentenceAfter: cues[cueIndex + 1]?.text || "",
          nativeLanguage,
          targetLanguage,
        });
        saveLocalAiAnalysis(key, analysis);
        void sbSaveCachedAnalysis(key, "sentence", analysis);
      }
      setPanelAnalysis(analysis);
    } catch {
      setPanelAnalysis(null);
    } finally {
      setIsPanelLoading(false);
    }
  }, [cues, nativeLanguage, targetLanguage]);

  const finishDragSelection = useCallback(() => {
    const selection = dragSelectionRef.current;
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (!selection || selection.startToken === selection.endToken) return;
    suppressWordClickRef.current = true;
    const cue = cues[selection.cueIndex];
    if (!cue) return;
    const tokens = cue.text.split(/(\s+)/);
    const start = Math.min(selection.startToken, selection.endToken);
    const end = Math.max(selection.startToken, selection.endToken);
    const text = tokens.slice(start, end + 1).join("").trim();
    if (text.split(/\s+/).length < 2) return;
    void openSelectionPanel(selection.cueIndex, text);
  }, [cues, openSelectionPanel]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = dragSelectionRef.current;
      if (!current) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-video-cue-index][data-video-token-index]");
      if (!target || Number(target.dataset.videoCueIndex) !== current.cueIndex) return;
      const endToken = Number(target.dataset.videoTokenIndex);
      if (!Number.isFinite(endToken) || endToken === current.endToken) return;
      playerRef.current?.pauseVideo?.();
      const next = { ...current, endToken };
      dragSelectionRef.current = next;
      setDragSelection(next);
    };
    const finish = () => finishDragSelection();
    const cancel = () => { dragSelectionRef.current = null; setDragSelection(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [finishDragSelection]);

  useEffect(() => {
    const handleVideoShortcut = (event: KeyboardEvent) => {
      if (event.repeat || isWordModalOpen || discussCue || panelSelection || dragSelectionRef.current) return;
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
  }, [activeCueIndex, cues, currentTime, discussCue, panelSelection, handleAddCueCard, handleDiscussCue, isWordModalOpen, targetLanguage]);

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Helper to tokenize subtitle text into words
  const renderInteractiveSubtitleText = (text: string, cueIndex: number) => {
    const tokens = text.split(/(\s+)/);
    return tokens.map((token, idx) => {
      const isWord = /[\p{L}\d]/u.test(token);
      if (!isWord) {
        return <span key={idx}>{token}</span>;
      }
      const isDragged = dragSelection?.cueIndex === cueIndex
        && idx >= Math.min(dragSelection.startToken, dragSelection.endToken)
        && idx <= Math.max(dragSelection.startToken, dragSelection.endToken);
      return (
        <button
          key={idx}
          type="button"
          className={`sub-interactive-word ${isDragged ? "is-drag-selected" : ""}`}
          data-video-cue-index={cueIndex}
          data-video-token-index={idx}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const next = { cueIndex, startToken: idx, endToken: idx };
            dragSelectionRef.current = next;
            setDragSelection(next);
          }}
          onPointerEnter={() => {
            const current = dragSelectionRef.current;
            if (!current || current.cueIndex !== cueIndex || current.endToken === idx) return;
            playerRef.current?.pauseVideo?.();
            const next = { ...current, endToken: idx };
            dragSelectionRef.current = next;
            setDragSelection(next);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (suppressWordClickRef.current) {
              suppressWordClickRef.current = false;
              return;
            }
            void handleWordTap(token, text);
          }}
          aria-label={`Перевод и разбор слова: ${token}`}
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
        onClick={handleClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-modal-title"
      >
        <div ref={modalContentRef} className="video-modal-content" data-word-language={targetLanguage} onClick={(e) => e.stopPropagation()}>
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
              onClick={handleClose}
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
              <span role="status">{subtitleStatus}</span>
            </div>
          ) : cues.length === 0 ? (
            <div className="video-subtitle-bar" role={subtitleError ? "alert" : "status"}>
              <span>{subtitleError || "Готовых субтитров для этого видео нет. AI-генерация отключена."}</span>
              <button type="button" className="video-transcript-toggle-btn" onClick={() => setSubtitleRetry(value => value + 1)}>Повторить</button>
            </div>
          ) : cues.length > 0 && !showFullTranscript ? (
            <div className="video-subtitle-bar">
              <div className="video-subtitle-live-content">
                {activeCue ? (
                  <div className="video-live-cue">
                    <span className="video-cue-meta">
                      <span className="video-cue-time">{formatTime(activeCue.start)}</span>
                      <span className="video-cue-count">{cues.length} реплик</span>
                    </span>
                    <div className="video-cue-copy">
                      <span className="video-cue-text">{renderInteractiveSubtitleText(activeCue.text, activeCueIndex)}</span>
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
                <span>{showFullTranscript ? "Скрыть текст" : "Текст"}</span>
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
              <div className="video-transcript-expanded-toolbar">
                <button
                  type="button"
                  className="video-transcript-collapse-btn"
                  onClick={() => setShowFullTranscript(false)}
                  aria-label="Свернуть список реплик"
                  title="Свернуть список реплик"
                >
                  <ListMusic size={14} />
                  <span>Свернуть</span>
                </button>
              </div>
              <div className="video-transcript-list">
              {cues.map((cue, idx) => {
                  const isActive = idx === activeCueIndex;
                  return (
                    <div
                      key={idx}
                      ref={isActive ? activeCueItemRef : undefined}
                      className={`video-transcript-item ${isActive ? "active" : ""}`}
                      onPointerDownCapture={(event) => {
                        if (event.button === 0) suppressWordClickRef.current = false;
                      }}
                      onClickCapture={(event) => {
                        // A drag ending on another word produces a click on their common parent.
                        if (suppressWordClickRef.current) {
                          suppressWordClickRef.current = false;
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                      onClick={() => handleSeekToCue(cue.start)}
                    >
                      {isActive && (
                        <div className="video-cue-actions" aria-label="Действия с активной репликой">
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
                            aria-pressed={repeatCueIndex === idx}
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
                      )}
                      <span className="transcript-time">{formatTime(cue.start)}</span>
                      <div className="transcript-line">
                        <span className="video-transcript-text" data-cue-text={idx}>{renderInteractiveSubtitleText(cue.text, idx)}</span>
                        {renderCueTranslation(idx, false, undefined, false)}
                      </div>
                      {isActive && (
                        <button
                          type="button"
                          className="video-cue-playback-btn"
                          onClick={(event) => { event.stopPropagation(); togglePlayerPlayback(); }}
                          aria-label={isPlayerPlaying ? "Поставить видео на паузу" : "Продолжить видео"}
                          title={isPlayerPlaying ? "Пауза" : "Продолжить"}
                        >
                          {isPlayerPlaying ? <Pause size={20} /> : <Play size={20} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {overlayPortalTarget && createPortal(<>
        {/* ── Interactive WordModal for Tap-To-Translate & Cards ───────────── */}
        {isWordModalOpen && <div className="video-word-modal-layer">
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
            onDiscuss={handleDiscussWord}
          />
        </div>}

        {panelSelection && <div className="video-ai-panel-layer">
          <AiPanel
            selection={{ token: panelSelection.text, phraseText: panelSelection.text, sentence: panelSelection.text, isCustomSentence: true }}
            analysis={panelAnalysis}
            isLoading={isPanelLoading}
            activeTab="sentence"
            availableTabs={["sentence"]}
            lang={targetLanguage}
            ttsProvider={profile.ttsProvider}
            isGuest={!userId}
            onClose={() => { setPanelSelection(null); setPanelAnalysis(null); }}
            onOpenWordModal={() => {}}
            onDiscuss={() => {
              const selected = panelSelection;
              setPanelSelection(null);
              void handleDiscussCue(selected.cueIndex, selected.text);
            }}
            onAddCard={() => handleAddCard(panelSelection.text, panelAnalysis?.sentence?.translation || "", "sentence", panelSelection.text)}
            onWordTap={(word) => void handleWordTap(word, panelSelection.text)}
            onTabChange={() => {}}
            onTtsProviderChange={() => {}}
          />
        </div>}

        {discussCue && <div className="video-discuss-modal-layer">
          <DiscussAiModal
            isOpen
            mode={discussCue.mode}
            selectedText={discussCue.text}
            sentence={discussCue.sentence}
            sentenceBefore={cues[discussCue.index - 1]?.text || ""}
            sentenceAfter={cues[discussCue.index + 1]?.text || ""}
            nativeLanguage={nativeLanguage}
            targetLanguage={targetLanguage}
            messages={discussMessages}
            onMessagesChange={handleDiscussMessagesChange}
            isHistoryLoading={isDiscussHistoryLoading}
            onClose={() => setDiscussCue(null)}
            onWordTap={(word, contextSentence) => void handleWordTap(word, contextSentence)}
          />
        </div>}
      </>, overlayPortalTarget)}
    </>
  );
}
