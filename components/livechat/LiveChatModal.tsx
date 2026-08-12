"use client";

import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Send, Shuffle, Volume2, X, Gauge } from "lucide-react";
import { getLocalGeminiKey, getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";
import { sbAuthHeaders, sbGetCachedAnalysis, sbSaveCachedAnalysis, sbInsertFlashcard } from "@/lib/db/supabase";
import { LiveChatSession, base64Pcm16ToFloat32, OUTPUT_SAMPLE_RATE, type LiveChatMode, type LiveChatStatus } from "@/lib/ai/liveChat";
import { DEFAULT_LIVE_MODEL } from "@/lib/ai/liveModels";
import { estimateLiveChatPerMinute } from "@/lib/ai/costs";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import {
  fetchLiveScenarios,
  fetchLiveSuggestions,
  translateText,
  type LiveScenario,
  type LiveSuggestion,
} from "@/lib/ai/liveChatExtras";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";
import { useAuth } from "@/lib/auth/useAuth";
import { findDuplicateCard } from "@/lib/cards";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { WordModal } from "@/components/word-modal/WordModal";
import type { AiAnalysis, CefrLevel, Flashcard } from "@/lib/types";

type Props = {
  isOpen: boolean;
  nativeLanguage: string;
  targetLanguage: string;
  /** Set when the call was started from a specific text passage (the phone icon on a CEFR text) — adds a scenario-picker step and grounds the conversation in that text. */
  textContext?: { text: string } | null;
  cards: Flashcard[];
  onAddCard: (card: Flashcard) => void;
  onClose: () => void;
  onOpenSettings: () => void;
};

type TranscriptLine = { role: "user" | "model"; text: string; audioChunks?: string[] };

const STATUS_LABEL: Record<LiveChatStatus, string> = {
  idle: "Подготовка...",
  connecting: "Подключение...",
  listening: "Слушаю вас",
  speaking: "AI отвечает",
  error: "Ошибка соединения",
  closed: "Звонок завершён",
};

const NO_KEY_MESSAGE = "Добавьте свой Gemini API ключ в настройках, чтобы начать голосовой чат.";
const MIC_DENIED_MESSAGE = "Нет доступа к микрофону. Разрешите доступ в настройках браузера и попробуйте снова.";

// A mobile connection drops for a second all the time, and Gemini Live ends
// long sessions on its own. Neither should cost the learner their conversation,
// so the call reconnects itself and only gives up — with a manual button —
// after a few quick tries.
const MAX_AUTO_RECONNECTS = 4;
const RECONNECT_DELAYS_MS = [700, 1500, 3000, 6000];

const EMPTY_PLACEHOLDER: Record<LiveChatMode, string> = {
  call: "Скажите что-нибудь — AI вас услышит и ответит голосом.",
  discuss: "Спросите на родном языке что угодно о языке — про грамматику, слово или оборот.",
};

// Beginners benefit most from a safety net of ready-made replies; show the
// suggestion buttons by default for them and let more advanced learners opt
// in instead, so the feature doesn't become a permanent crutch.
const SUGGESTIONS_DEFAULT_LEVELS: CefrLevel[] = ["A1", "A2", "B1"];

// Gemini's streamed transcription deltas can include zero-width Unicode
// characters that pass `.trim()` as non-empty but render as a blank bubble.
function cleanText(text: string): string {
  return text.replace(/[​-‏‪-‮⁠﻿]/g, "").trim();
}

function renderWords(text: string, onWordTap: (word: string, contextSentence: string) => void) {
  const tokens = splitIntoTokens(text);
  return tokens.map((token, i) => {
    const norm = normalizeToken(token);
    if (!norm) return <span key={i}>{token}</span>;
    return (
      <span
        key={i}
        className="livechat-clickable-word"
        role="button"
        tabIndex={0}
        onClick={() => onWordTap(token, text)}
        onKeyDown={(e) => { if (e.key === "Enter") onWordTap(token, text); }}
      >
        {token}
      </span>
    );
  });
}

type TranscriptLineProps = {
  line: TranscriptLine;
  index: number;
  isPlaying: boolean;
  isRevealed: boolean;
  isTranslating: boolean;
  translation?: string;
  /** Off when the AI is already speaking the learner's language — there is nothing to reveal. */
  showTranslation: boolean;
  onWordTap: (word: string, contextSentence: string) => void;
  onReplay: (index: number, audioChunks: string[]) => void;
  onReveal: (index: number, text: string) => void;
};

// Memoized so a re-render of the parent (e.g. on every streamed transcript
// delta, which can fire many times a second while the mic is live) doesn't
// re-tokenize and re-render every word of every prior message — that work
// was competing with the mic capture's audio callback on the main thread
// and made the call seem to stop listening on longer conversations.
const TranscriptLineView = memo(function TranscriptLineView({
  line,
  index,
  isPlaying,
  isRevealed,
  isTranslating,
  translation,
  showTranslation,
  onWordTap,
  onReplay,
  onReveal,
}: TranscriptLineProps) {
  return (
    <div className={`livechat-line-wrap ${line.role}`}>
      <div className={`livechat-line ${line.role}`}>
        {line.role === "model" ? (
          <>
            <span className="livechat-line-text">{renderWords(line.text, onWordTap)}</span>
            {line.audioChunks && line.audioChunks.length > 0 && (
              <button
                type="button"
                className={`livechat-replay-btn${isPlaying ? " active" : ""}`}
                onClick={() => onReplay(index, line.audioChunks!)}
                aria-label="Прослушать ещё раз"
                title="Прослушать ещё раз (из кэша, без затрат)"
              >
                <Volume2 size={14} />
              </button>
            )}
          </>
        ) : (
          line.text
        )}
      </div>
      {line.role === "model" && showTranslation && (
        <button
          type="button"
          className="livechat-translation"
          onClick={() => onReveal(index, line.text)}
          title={isRevealed ? undefined : "Нажмите, чтобы увидеть перевод"}
        >
          <span className={isRevealed ? "revealed" : "blurred"}>
            {isRevealed ? (isTranslating ? <Loader2 size={12} className="spin" /> : translation) : line.text}
          </span>
        </button>
      )}
    </div>
  );
});

/**
 * Which live model to open the session with.
 *
 * Asked of the server (which asks the service) rather than hardcoded: preview
 * model ids are retired on a schedule, and the day one is, every call fails
 * with an abrupt disconnect. Cached for the page's lifetime; any failure falls
 * back to the built-in id.
 */
let cachedLiveModel: string | null = null;
async function resolveLiveModel(): Promise<string> {
  if (cachedLiveModel) return cachedLiveModel;
  try {
    const headers = await sbAuthHeaders();
    const localKey = getLocalGeminiKey();
    if (localKey) headers["x-gemini-key"] = localKey;
    const res = await fetch("/api/ai/live-model", { headers });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.model === "string" && data.model) {
        cachedLiveModel = data.model;
        return data.model;
      }
    }
  } catch {
    // fall through to the built-in id
  }
  cachedLiveModel = DEFAULT_LIVE_MODEL;
  return DEFAULT_LIVE_MODEL;
}

/** Owners get the key from the server's env (set on Vercel); everyone else uses their local key. */
async function resolveGeminiKey(): Promise<string | null> {
  try {
    const headers = await sbAuthHeaders();
    if (headers.Authorization) {
      const res = await fetch("/api/ai/live-key", { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.apiKey) return data.apiKey as string;
      }
    }
  } catch {
    // fall through to the local key
  }
  return getLocalGeminiKey();
}

export function LiveChatModal({ isOpen, nativeLanguage, targetLanguage, textContext, cards, onAddCard, onClose, onOpenSettings }: Props) {
  const { user } = useAuth();
  const [status, setStatus] = useState<LiveChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<TranscriptLine[]>([]);
  const [liveUser, setLiveUser] = useState("");
  const [liveModel, setLiveModel] = useState("");
  const [mode, setMode] = useState<LiveChatMode>("call");
  const [retryToken, setRetryToken] = useState(0);

  // ── Cost meter ─────────────────────────────────────────────────────────────
  // Voice chat is billed by the minute of audio in each direction and is by far
  // the most expensive thing in the app — an hour costs more than translating a
  // book many times over. Everything else that spends money asks first; a live
  // call cannot, so it shows the running cost instead.
  const [callSeconds, setCallSeconds] = useState(0);

  useEffect(() => {
    const connected = status === "listening" || status === "speaking";
    if (!connected) return;
    const timer = window.setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const [scenarios, setScenarios] = useState<LiveScenario[] | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<LiveScenario | null>(null);

  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translating, setTranslating] = useState<Set<number>>(new Set());

  const [suggestions, setSuggestions] = useState<LiveSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(true);

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [textInput, setTextInput] = useState("");

  const [wmOpen, setWmOpen] = useState(false);
  const [wmWord, setWmWord] = useState("");
  const [wmAnalysis, setWmAnalysis] = useState<AiAnalysis | null>(null);
  const [wmLoading, setWmLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [reconnecting, setReconnecting] = useState(false);

  const sessionRef = useRef<LiveChatSession | null>(null);
  const liveUserRef = useRef("");
  const liveModelRef = useRef("");
  // The transcript as the connect effect can see it: it reconnects from a
  // callback, long after its own render's `history` went stale.
  const historyRef = useRef<TranscriptLine[]>([]);
  const mutedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  // The server's latest resumption handle: restores the model's own state on
  // reconnect, which the replayed transcript can only approximate.
  const resumeHandleRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  // Identifies "the same conversation": the transcript survives a reconnect,
  // but must not survive switching scenario, mode or language.
  const sessionKeyRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const replayCtxRef = useRef<AudioContext | null>(null);
  const replaySourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const contextText = textContext?.text ?? null;
  const needsScenario = !!contextText;
  // Analysis runs in the learner's own language; practice runs in the language
  // being learned. Everything downstream (suggestions, placeholder) follows.
  const scenarioKind = needsScenario
    ? selectedScenario?.kind ?? "analyze"
    : mode === "discuss" ? "analyze" : "practice";

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  // Full reset the moment the modal is closed, so a future reopen always
  // starts from clean state instead of racing the scenario-fetch effect's
  // (deferred) reset against the connect effect's (immediate) read of the
  // still-stale `selectedScenario` from the previous call.
  useEffect(() => {
    if (isOpen) return;
    sessionRef.current?.close();
    sessionRef.current = null;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    stopReplay();
    setStatus("idle");
    setError(null);
    setHistory([]);
    setLiveUser("");
    setLiveModel("");
    liveUserRef.current = "";
    liveModelRef.current = "";
    historyRef.current = [];
    sessionKeyRef.current = null;
    reconnectAttemptsRef.current = 0;
    resumeHandleRef.current = null;
    setReconnecting(false);
    // The cost meter belongs to one call; a reopened modal starts from zero.
    setCallSeconds(0);
    setScenarios(null);
    setScenarioError(null);
    setSelectedScenario(null);
    setRevealed(new Set());
    setTranslations({});
    setTranslating(new Set());
    setSuggestions([]);
    setSuggestionsLoading(false);
    setPlayingIndex(null);
    setWmOpen(false);
    setWmAnalysis(null);
    setTextInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Fetch the text-grounded scenarios as soon as the modal opens for a
  // specific passage, before any session connects.
  useEffect(() => {
    if (!isOpen || !contextText) return;
    let cancelled = false;
    setScenarios(null);
    setScenarioError(null);
    setSelectedScenario(null);

    fetchLiveScenarios(contextText, nativeLanguage, targetLanguage)
      .then((list) => {
        if (!cancelled) setScenarios(list);
      })
      .catch((err) => {
        if (!cancelled) setScenarioError(err instanceof Error ? err.message : "Не удалось придумать сценарии для этого текста");
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, contextText, nativeLanguage, targetLanguage]);

  // Connects once we know what to connect with: either immediately (free-form
  // call/discuss) or as soon as a text-grounded scenario has been picked.
  useEffect(() => {
    if (!isOpen) return;
    if (needsScenario && !selectedScenario) return;
    let cancelled = false;

    // A reconnect continues the same conversation; a new scenario/mode starts
    // a new one. Only the latter may wipe the transcript.
    const sessionKey = [nativeLanguage, targetLanguage, mode, contextText ? "text" : "free", selectedScenario?.id ?? ""].join("|");
    const isNewConversation = sessionKeyRef.current !== sessionKey;
    sessionKeyRef.current = sessionKey;

    if (isNewConversation) {
      setHistory([]);
      historyRef.current = [];
      setRevealed(new Set());
      setTranslations({});
      reconnectAttemptsRef.current = 0;
      resumeHandleRef.current = null;
    }
    const resumeHandle = isNewConversation ? undefined : resumeHandleRef.current ?? undefined;
    // The transcript is only replayed when there is no handle to resume from:
    // with a handle the model already remembers, and repeating it back would
    // duplicate the conversation in its context.
    const resumeFrom = isNewConversation || resumeHandle
      ? []
      : historyRef.current.map((line) => ({ role: line.role, text: line.text }));

    setError(null);
    setLiveUser("");
    setLiveModel("");
    setSuggestions([]);
    liveUserRef.current = "";
    liveModelRef.current = "";
    setStatus("connecting");

    (async () => {
      const [apiKey, levelEstimate, liveModel] = await Promise.all([
        resolveGeminiKey(),
        estimateTargetLanguageLevel(targetLanguage).catch(() => null),
        resolveLiveModel(),
      ]);
      if (cancelled) return;
      if (!apiKey) {
        setError(NO_KEY_MESSAGE);
        setStatus("error");
        return;
      }
      setSuggestionsVisible(!levelEstimate || SUGGESTIONS_DEFAULT_LEVELS.includes(levelEstimate.level));

      const session = new LiveChatSession(apiKey, liveModel, {
        onStatusChange: (next) => {
          setStatus(next);
          if (next === "listening" || next === "speaking") setReconnecting(false);
        },
        onSessionHandle: (handle) => { resumeHandleRef.current = handle; },
        onDropped: (message, wasStable) => {
          if (cancelled) return;
          // A call that ran for a while and then dropped is a new problem, not
          // a continuation of the old one — give it a full retry budget again.
          // Without this check a permanently broken setup would loop forever.
          if (wasStable) reconnectAttemptsRef.current = 0;
          if (reconnectAttemptsRef.current >= MAX_AUTO_RECONNECTS) {
            setReconnecting(false);
            setError(`${message}. Разговор сохранён — нажмите «Продолжить разговор».`);
            setStatus("error");
            return;
          }
          const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS_MS.length - 1)];
          reconnectAttemptsRef.current += 1;
          setReconnecting(true);
          setStatus("connecting");
          reconnectTimerRef.current = window.setTimeout(() => setRetryToken((t) => t + 1), delay);
        },
        onUserTranscript: (text) => {
          liveUserRef.current += text;
          setLiveUser(liveUserRef.current);
        },
        onModelTranscript: (text) => {
          liveModelRef.current += text;
          setLiveModel(liveModelRef.current);
        },
        onUserTurnEnd: () => {
          const text = cleanText(liveUserRef.current);
          if (text) setHistory((h) => [...h, { role: "user", text }]);
          liveUserRef.current = "";
          setLiveUser("");
          setSuggestions([]);
        },
        onModelTurnEnd: (audioChunks) => {
          const text = cleanText(liveModelRef.current);
          if (text) {
            setHistory((h) => [...h, { role: "model", text, audioChunks }]);
            fetchSuggestionsFor(text);
          }
          liveModelRef.current = "";
          setLiveModel("");
        },
        onInterrupted: () => {
          // The model's partial turn was cut short by the user barging in —
          // discard it instead of finalizing a truncated message into history.
          liveModelRef.current = "";
          setLiveModel("");
        },
        onError: (message) => setError(message),
      });
      sessionRef.current = session;
      // The mic switch belongs to the learner, not to the connection.
      session.setMuted(mutedRef.current);

      session
        .connect(nativeLanguage, targetLanguage, {
          mode,
          levelSummary: levelEstimate?.summary,
          textContext: contextText && selectedScenario ? { text: contextText, scenario: selectedScenario } : undefined,
          previousTranscript: resumeFrom,
          resumeHandle,
        })
        .catch((err) => {
          if (cancelled) return;
          const message = err?.name === "NotAllowedError" ? MIC_DENIED_MESSAGE : (err?.message || "Не удалось начать звонок");
          setReconnecting(false);
          setError(message);
          setStatus("error");
        });
    })();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [isOpen, nativeLanguage, targetLanguage, mode, needsScenario, contextText, selectedScenario, retryToken]);

  const fetchSuggestionsFor = useCallback(
    (lastLine: string) => {
      setSuggestionsLoading(true);
      fetchLiveSuggestions(lastLine, nativeLanguage, targetLanguage, selectedScenario?.prompt, scenarioKind)
        .then((list) => setSuggestions(list))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestionsLoading(false));
    },
    [nativeLanguage, targetLanguage, selectedScenario, scenarioKind]
  );

  // Only auto-scroll on discrete events (a finalized line, a suggestion
  // batch) rather than on every streaming transcript delta — scrolling
  // several times a second while the model is mid-sentence was shifting
  // the layout out from under the user's finger, making taps on the
  // translation/word/replay targets land on the wrong element.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, suggestions]);

  function handleClose() {
    sessionRef.current?.close();
    onClose();
  }

  // Manual retry after the automatic ones ran out. The transcript is kept and
  // replayed into the new session, so the conversation picks up where it was.
  function handleReconnect() {
    reconnectAttemptsRef.current = 0;
    setReconnecting(true);
    setRetryToken((t) => t + 1);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }

  function handleSwitchScenario() {
    sessionRef.current?.close();
    sessionRef.current = null;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnecting(false);
    setError(null);
    setSelectedScenario(null);
    setStatus("idle");
  }

  function handleSuggestionTap(suggestion: LiveSuggestion) {
    sessionRef.current?.sendText(suggestion.text);
    setHistory((h) => [...h, { role: "user", text: suggestion.text }]);
    setSuggestions([]);
  }

  function handleTextSubmit(e: FormEvent) {
    e.preventDefault();
    const text = textInput.trim();
    if (!text) return;
    sessionRef.current?.sendText(text);
    setHistory((h) => [...h, { role: "user", text }]);
    setSuggestions([]);
    setTextInput("");
  }

  const revealTranslation = useCallback(
    async (index: number, text: string) => {
      if (revealed.has(index)) return;
      setRevealed((prev) => new Set(prev).add(index));
      setTranslating((prev) => new Set(prev).add(index));
      try {
        const translation = await translateText(text, targetLanguage, nativeLanguage);
        setTranslations((prev) => ({ ...prev, [index]: translation }));
      } catch {
        setTranslations((prev) => ({ ...prev, [index]: "Не удалось перевести" }));
      } finally {
        setTranslating((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }
    },
    [revealed, targetLanguage, nativeLanguage]
  );

  const stopReplay = useCallback(() => {
    for (const node of replaySourcesRef.current) {
      try {
        node.onended = null;
        node.stop();
      } catch {
        // already stopped
      }
    }
    replaySourcesRef.current = [];
    setPlayingIndex(null);
  }, []);

  /** Replays an already-received AI turn straight from its cached PCM chunks — no network call, no tokens spent. */
  const playCachedAudio = useCallback(
    (index: number, audioChunks: string[]) => {
      if (playingIndex === index) {
        stopReplay();
        return;
      }
      stopReplay();
      if (!replayCtxRef.current) {
        replayCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      }
      const ctx = replayCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      setPlayingIndex(index);

      let playTime = ctx.currentTime;
      let remaining = audioChunks.length;
      for (const chunk of audioChunks) {
        const floats = base64Pcm16ToFloat32(chunk);
        if (floats.length === 0) {
          remaining -= 1;
          continue;
        }
        const buffer = ctx.createBuffer(1, floats.length, OUTPUT_SAMPLE_RATE);
        buffer.copyToChannel(floats, 0);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.destination);
        node.start(playTime);
        playTime += buffer.duration;
        node.onended = () => {
          remaining -= 1;
          if (remaining <= 0) setPlayingIndex((cur) => (cur === index ? null : cur));
        };
        replaySourcesRef.current.push(node);
      }
      if (remaining === 0) setPlayingIndex(null);
    },
    [playingIndex, stopReplay]
  );

  const loadWordModalAnalysis = useCallback(
    async (word: string, contextSentence: string) => {
      const cacheKey = makeAiCacheKey("word", word, targetLanguage, nativeLanguage);
      setWmLoading(true);
      setWmAnalysis(null);
      try {
        const localCached = getLocalAiAnalysis(cacheKey);
        if (localCached?.word) {
          setWmAnalysis(localCached);
          return;
        }
        const remoteCached = await sbGetCachedAnalysis(cacheKey);
        if (remoteCached?.word) {
          saveLocalAiAnalysis(cacheKey, remoteCached);
          setWmAnalysis(remoteCached);
          return;
        }
        const result = await analyzeSelection({
          mode: "word",
          word,
          text: word,
          sentence: contextSentence,
          sentenceBefore: "",
          sentenceAfter: "",
          nativeLanguage,
          targetLanguage,
        });
        saveLocalAiAnalysis(cacheKey, result);
        void sbSaveCachedAnalysis(cacheKey, "word", result);
        setWmAnalysis(result);
      } catch (err) {
        console.error("Word modal analysis failed:", err);
      } finally {
        setWmLoading(false);
      }
    },
    [targetLanguage, nativeLanguage]
  );

  const handleWordTap = useCallback(
    (word: string, contextSentence: string) => {
      const norm = normalizeToken(word);
      if (!norm) return;
      setWmWord(word);
      setWmOpen(true);
      void loadWordModalAnalysis(word, contextSentence);
    },
    [loadWordModalAnalysis]
  );

  async function handleAddCardFromWordModal() {
    const translation = wmAnalysis?.word?.translation;
    if (!translation) return;
    const front = wmWord;
    if (findDuplicateCard(front, cards)) {
      showToast("Такая карточка уже добавлена");
      return;
    }
    const srsFields = createDefaultSrsFields(null, "Голосовой чат");
    const localCard: Flashcard = {
      id: `card-${Date.now()}`,
      type: "word",
      source: "Голосовой чат",
      addedAt: new Date().toISOString(),
      ...srsFields,
      front,
      back: translation,
    };
    if (user) {
      const dbId = await sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: localCard.front,
        back: localCard.back,
        source_book_title: "Голосовой чат",
        selection_type: "word",
        repetitions: srsFields.repetitions,
        lapses: srsFields.lapses,
        easiness_factor: srsFields.easeFactor,
        interval_days: srsFields.intervalDays,
        next_review_at: srsFields.dueAt,
        last_reviewed_at: srsFields.lastReviewedAt,
        source_book_id: null,
        status: srsFields.status,
      });
      if (dbId) localCard.id = dbId;
    }
    onAddCard(localCard);
    showToast("✓ Карточка добавлена");
  }

  if (!isOpen) return null;

  const isLive = status === "listening" || status === "speaking";
  const pendingUser = cleanText(liveUser);
  const pendingModel = cleanText(liveModel);
  const showingScenarioPicker = needsScenario && !selectedScenario;
  const placeholder = needsScenario && selectedScenario
    ? selectedScenario.kind === "analyze"
      ? "Спрашивайте по-русски всё, что непонятно в тексте: грамматику, слова, порядок слов."
      : `Сценарий: ${selectedScenario.label}. Начните говорить!`
    : EMPTY_PLACEHOLDER[mode];
  const statusLabel = reconnecting && status === "connecting"
    ? "Связь прервалась, восстанавливаю…"
    : STATUS_LABEL[status];

  return (
    <div className="modal-backdrop livechat-backdrop">
      <section className="livechat-modal" role="dialog" aria-modal aria-label="Голосовой чат с AI">
        <header className="livechat-header">
          <span>Голосовой чат</span>
          {callSeconds > 0 && (
            <span
              className="livechat-meter"
              title="Примерная стоимость этого разговора. Считается по тарифу за минуту аудио."
            >
              {formatDuration(callSeconds)} · {formatLiveCost(callSeconds)}
            </span>
          )}
          <div className="livechat-header-actions">
            {needsScenario && selectedScenario && (
              <button className="icon-btn" type="button" onClick={handleSwitchScenario} aria-label="Сменить сценарий" title="Сменить сценарий">
                <Shuffle size={18} />
              </button>
            )}
            <button className="icon-btn" type="button" onClick={handleClose} aria-label="Закрыть">
              <X size={19} />
            </button>
          </div>
        </header>

        {showingScenarioPicker ? (
          <div className="livechat-scenario-picker">
            <p className="livechat-scenario-intro">Как будем практиковать этот текст?</p>
            {scenarioError && <div className="livechat-error"><p>{scenarioError}</p></div>}
            {!scenarios && !scenarioError && (
              <div className="livechat-scenario-loading">
                <Loader2 size={20} className="spin" /> Подбираю сценарии...
              </div>
            )}
            {scenarios && (
              <div className="livechat-scenario-list">
                {scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    className="livechat-scenario-btn"
                    onClick={() => setSelectedScenario(scenario)}
                  >
                    <strong>{scenario.label}</strong>
                    <span>
                      {scenario.kind === "analyze"
                        ? "Разговор на родном языке — объяснить грамматику и слова"
                        : `${scenario.aiRole} ↔ ${scenario.userRole} · разговор на изучаемом языке`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {!needsScenario && (
              <div className="livechat-mode-toggle" role="tablist" aria-label="Режим голосового чата">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "call"}
                  className={`livechat-mode-btn${mode === "call" ? " active" : ""}`}
                  onClick={() => setMode("call")}
                >
                  Звонок
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "discuss"}
                  className={`livechat-mode-btn${mode === "discuss" ? " active" : ""}`}
                  onClick={() => setMode("discuss")}
                >
                  Обсуждение языка
                </button>
              </div>
            )}

            <div className="livechat-body">
              <div className="livechat-status-row">
                <div className={`livechat-orb ${status}`}>
                  {status === "connecting" || status === "idle" ? <Loader2 size={16} className="spin" /> : <Mic size={16} />}
                </div>
                <strong className="livechat-status">{statusLabel}</strong>
              </div>

              {error && (
                <div className="livechat-error">
                  <p>{error}</p>
                  {error === NO_KEY_MESSAGE ? (
                    <button type="button" className="primary-btn" onClick={onOpenSettings}>
                      Открыть настройки
                    </button>
                  ) : (
                    <button type="button" className="primary-btn" onClick={handleReconnect}>
                      {history.length > 0 ? "Продолжить разговор" : "Переподключиться"}
                    </button>
                  )}
                </div>
              )}

              <div className="livechat-transcript">
                {history.length === 0 && !pendingUser && !pendingModel && !error && (
                  <p className="livechat-empty">{placeholder}</p>
                )}
                {history.map((line, index) => (
                  <TranscriptLineView
                    key={index}
                    line={line}
                    index={index}
                    isPlaying={playingIndex === index}
                    isRevealed={revealed.has(index)}
                    isTranslating={translating.has(index)}
                    translation={translations[index]}
                    showTranslation={scenarioKind === "practice"}
                    onWordTap={handleWordTap}
                    onReplay={playCachedAudio}
                    onReveal={revealTranslation}
                  />
                ))}
                {pendingUser && <p className="livechat-line user pending">{pendingUser}</p>}
                {pendingModel && <p className="livechat-line model pending">{pendingModel}</p>}
                <div ref={endRef} />
              </div>

              {(suggestions.length > 0 || suggestionsLoading) && (
                <div className="livechat-suggestions">
                  {!suggestionsVisible ? (
                    <button type="button" className="livechat-suggestions-toggle" onClick={() => setSuggestionsVisible(true)}>
                      Показать варианты ответа
                    </button>
                  ) : (
                    <>
                      <div className="livechat-suggestions-header">
                        <span>Варианты ответа</span>
                        <button
                          type="button"
                          className="livechat-suggestions-hide"
                          onClick={() => setSuggestionsVisible(false)}
                          aria-label="Скрыть варианты ответа"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="livechat-suggestions-list">
                        {suggestionsLoading ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          suggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              type="button"
                              className="livechat-suggestion-btn"
                              onClick={() => handleSuggestionTap(suggestion)}
                            >
                              <span className="livechat-suggestion-text">{suggestion.text}</span>
                              {suggestion.translation && (
                                <span className="livechat-suggestion-translation">{suggestion.translation}</span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <form className="livechat-text-form" onSubmit={handleTextSubmit}>
              <input
                type="text"
                className="livechat-text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Напишите сообщение вместо голоса..."
                disabled={!isLive}
                aria-label="Текстовое сообщение"
              />
              <button
                type="submit"
                className="livechat-text-send"
                disabled={!isLive || !textInput.trim()}
                aria-label="Отправить сообщение"
              >
                <Send size={18} />
              </button>
            </form>

            <div className="livechat-controls">
              <button
                type="button"
                className="livechat-slower-btn"
                onClick={() => sessionRef.current?.requestSlower()}
                disabled={!isLive}
                aria-label="Сказать медленнее"
                title="Попросить AI повторить медленнее"
              >
                <Gauge size={18} />
              </button>
              <button
                type="button"
                className={`livechat-mute-btn${muted ? " active" : ""}`}
                onClick={toggleMute}
                disabled={!isLive}
                aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
              >
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button type="button" className="livechat-end-btn" onClick={handleClose} aria-label="Завершить звонок">
                <PhoneOff size={22} />
              </button>
            </div>
          </>
        )}
      </section>

      <WordModal
        analysis={wmAnalysis}
        isOpen={wmOpen}
        isLoading={wmLoading}
        lang={targetLanguage}
        nativeLang={nativeLanguage}
        selectedWord={wmWord}
        onClose={() => setWmOpen(false)}
        onAddCard={() => void handleAddCardFromWordModal()}
        onWordTap={(word, context) => handleWordTap(word, context)}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** "3:07" — elapsed call time. */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Running cost of the call so far.
 *
 * Uses an even split between speaking and listening — the API does not report
 * the split live, and assuming half is closer than assuming either extreme.
 * Shown with "≈" for that reason.
 */
function formatLiveCost(seconds: number): string {
  const amount = (seconds / 60) * estimateLiveChatPerMinute();
  return amount < 0.01 ? "≈ <$0.01" : `≈ $${amount.toFixed(2)}`;
}
