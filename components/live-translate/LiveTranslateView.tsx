"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Languages, Mic, MicOff, Volume2, X } from "lucide-react";
import { getLocalGeminiKey } from "@/lib/db/local";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { LiveTranslateSession } from "@/lib/ai/liveTranslate";
import { GptLiveTranslateSession } from "@/lib/ai/gptLiveTranslate";
import { GptRealtimeSession } from "@/lib/ai/gptRealtimeTranslate";
import { LIVE_TRANSLATE_LABELS, accumulateLiveUsage, appendTranscript, calculateLiveUsage, type LiveTranslateState, type LiveUsageMetadata, type LiveUsageTotals } from "@/lib/ai/liveTranslateState";
import { LIVE_TRANSLATE_MODEL } from "@/lib/ai/liveModels";
import { GPT_TRANSLATE_MODEL, GPT_TRANSLATE_USD_PER_MINUTE } from "@/lib/ai/gptTranslateModels";
import { GPT_REALTIME_MODEL } from "@/lib/ai/gptRealtimeModels";
import { keepScreenAwake, type ScreenAwakeHandle } from "@/lib/audio/wakeLock";
import type { UserProfile } from "@/lib/types";

type Props = { onBack: () => void; profile: UserProfile };

/** Transcript deltas arrive several times a second; repainting on each one is
 *  pointless work on the same thread that has to encode outgoing audio. */
const TRANSCRIPT_FLUSH_MS = 200;

/** Whatever engine is active only needs to be stopped the same way. */
type AnyLiveSession = { close: () => void };

export function LiveTranslateView({ onBack, profile }: Props) {
  const provider = profile.liveTranslateProvider ?? "gemini";
  const [state, setState] = useState<LiveTranslateState>("ready");
  const [sourceText, setSourceText] = useState("");
  const [showText, setShowText] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<LiveUsageTotals>(() => calculateLiveUsage());
  const [confirmedModel, setConfirmedModel] = useState<string | null>(null);
  const sessionRef = useRef<AnyLiveSession | null>(null);
  const transcriptRef = useRef("");
  const wakeRef = useRef<ScreenAwakeHandle | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  function stopSession() {
    sessionRef.current?.close();
    sessionRef.current = null;
    wakeRef.current?.release();
    wakeRef.current = null;
    setSourceText(transcriptRef.current);
    setSessionActive(false);
  }

  useEffect(() => () => { sessionRef.current?.close(); wakeRef.current?.release(); }, []);

  // Mirror the buffered transcript into state on a slow tick instead of on
  // every delta — see TRANSCRIPT_FLUSH_MS.
  useEffect(() => {
    if (!sessionActive) return;
    const timer = window.setInterval(() => {
      setSourceText((current) => (current === transcriptRef.current ? current : transcriptRef.current));
    }, TRANSCRIPT_FLUSH_MS);
    return () => window.clearInterval(timer);
  }, [sessionActive]);

  // The newest line stays in view; everything older scrolls off the top.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [sourceText, showText]);

  async function connectGemini(headers: Record<string, string>) {
    const localKey = getLocalGeminiKey();
    if (localKey) headers["x-gemini-key"] = localKey;
    const response = await fetch("/api/ai/live-translate-token", { headers });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error || "Токен недоступен");
    const session = new LiveTranslateSession(data.token, {
      onState: setState,
      onSourceText: (text) => { transcriptRef.current = appendTranscript(transcriptRef.current, text); },
      onUsage: (metadata: LiveUsageMetadata) => setUsage((current) => accumulateLiveUsage(current, metadata)),
      onError: (kind, message) => { stopSession(); setState(kind); setError(message); },
    });
    sessionRef.current = session;
    setSessionActive(true);
    wakeRef.current = keepScreenAwake();
    await session.connect();
  }

  async function connectGpt(headers: Record<string, string>) {
    const response = await fetch("/api/ai/gpt-translate-token", { headers });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error || "Токен недоступен");
    const session = new GptLiveTranslateSession(data.token, {
      onState: setState,
      onSourceText: (text) => { transcriptRef.current = appendTranscript(transcriptRef.current, text); },
      onUsage: (totals) => setUsage(totals),
      onError: (kind, message) => { stopSession(); setState(kind); setError(message); },
    });
    sessionRef.current = session;
    setSessionActive(true);
    wakeRef.current = keepScreenAwake();
    await session.connect();
  }

  async function connectGptRealtime(headers: Record<string, string>) {
    const response = await fetch("/api/ai/gpt-realtime-token", { headers });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error || "Токен недоступен");
    const session = new GptRealtimeSession(data.token, {
      onState: setState,
      onSourceText: (text) => { transcriptRef.current = appendTranscript(transcriptRef.current, text); },
      onUsage: (totals) => setUsage(totals),
      onError: (kind, message) => { stopSession(); setState(kind); setError(message); },
      onModelConfirmed: setConfirmedModel,
    });
    sessionRef.current = session;
    setSessionActive(true);
    wakeRef.current = keepScreenAwake();
    await session.connect();
  }

  async function toggleSession() {
    if (sessionRef.current) { stopSession(); setState("stopped"); return; }
    setError(null);
    transcriptRef.current = "";
    setSourceText("");
    setUsage(calculateLiveUsage());
    setConfirmedModel(null);
    try {
      const headers = await sbAuthHeaders();
      if (provider === "openai") await connectGpt(headers);
      else if (provider === "openai-realtime") await connectGptRealtime(headers);
      else await connectGemini(headers);
    } catch (err) {
      stopSession();
      setState("connection-error");
      setError(err instanceof Error ? err.message : "Не удалось подключиться");
    }
  }

  const running = sessionActive && !["ready", "stopped", "mic-error", "connection-error"].includes(state);
  // For the duplex engine, prefer what the server actually confirmed
  // (session.created) over the requested id — the whole point of tracking it
  // is to catch a silent fallback to a different model.
  const modelLabel = provider === "openai"
    ? GPT_TRANSLATE_MODEL
    : provider === "openai-realtime"
      ? (confirmedModel ?? GPT_REALTIME_MODEL)
      : LIVE_TRANSLATE_MODEL;
  // Driven by the selected engine, not usage.costBasis: before the first
  // session callback arrives, usage is still Gemini-shaped even when GPT is
  // the active provider, which would otherwise flash "вход 0 · выход 0".
  const perMinute = provider === "openai";

  return (
    <section className="live-translate-screen" aria-label="Live перевод">
      <header className="live-translate-header">
        <button type="button" className="live-translate-back" onClick={() => { stopSession(); onBack(); }} aria-label="Назад"><ArrowLeft size={20} /></button>
        <span className="live-translate-brand"><Languages size={16} /> Live перевод</span>
        <span className="live-translate-badge">RU</span>
      </header>

      <main className="live-translate-stage">
        <button
          type="button"
          className={`live-translate-orb${running ? " is-live" : ""}`}
          onClick={() => void toggleSession()}
          aria-pressed={running}
          aria-label={running ? "Остановить перевод" : "Начать перевод"}
        >
          {running ? <MicOff size={34} /> : <Mic size={34} />}
        </button>
        <p className="live-translate-status" role="status">{LIVE_TRANSLATE_LABELS[state]}</p>
        {error && <div className="live-translate-error" role="alert">{error}</div>}
      </main>

      <p className="live-translate-hint"><Volume2 size={13} /> Лучше в наушниках — иначе микрофон услышит перевод</p>

      <footer className="live-translate-bar">
        <button type="button" className={`live-translate-chip${showText ? " is-on" : ""}`} onClick={() => setShowText((value) => !value)} aria-expanded={showText}>
          {showText ? "Скрыть текст" : "Показать текст"}
        </button>
        <span
          className="live-translate-cost"
          title={perMinute
            ? `Оценка по времени сессии: $${GPT_TRANSLATE_USD_PER_MINUTE.toFixed(3)}/мин, а не счёт.`
            : "Оценка по usageMetadata текущей сессии, а не счёт. Транскрипция добавляет текстовые токены сверх аудио."}
        >
          ${usage.estimatedUsd.toFixed(4)}
        </span>
      </footer>

      {showText && (
        <aside className="live-translate-overlay" aria-label="Расшифровка речи">
          <div className="live-translate-overlay-head">
            <span>Исходная речь</span>
            <button type="button" className="live-translate-overlay-close" onClick={() => setShowText(false)} aria-label="Закрыть расшифровку"><X size={16} /></button>
          </div>
          <div className="live-translate-overlay-log" ref={logRef}>
            <p>{sourceText || "Транскрипция появится здесь во время разговора…"}</p>
          </div>
          <small>
            Язык собеседника определяется автоматически · {modelLabel}
            {!perMinute && ` · вход ${usage.inputTokens.toLocaleString("ru-RU")} · выход ${usage.outputTokens.toLocaleString("ru-RU")}`}
          </small>
        </aside>
      )}
    </section>
  );
}
