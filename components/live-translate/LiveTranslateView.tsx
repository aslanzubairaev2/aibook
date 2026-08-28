"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Languages, Mic, MicOff, Radio, Volume2 } from "lucide-react";
import { getLocalGeminiKey } from "@/lib/db/local";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { LiveTranslateSession } from "@/lib/ai/liveTranslate";
import { LIVE_TRANSLATE_LABELS, accumulateLiveUsage, appendTranscript, calculateLiveUsage, type LiveTranslateState, type LiveUsageMetadata, type LiveUsageTotals } from "@/lib/ai/liveTranslateState";
import { LIVE_TRANSLATE_MODEL } from "@/lib/ai/liveModels";

type Props = { onBack: () => void };

export function LiveTranslateView({ onBack }: Props) {
  const [state, setState] = useState<LiveTranslateState>("ready");
  const [sourceText, setSourceText] = useState("");
  const [showText, setShowText] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<LiveUsageTotals>(() => calculateLiveUsage());
  const sessionRef = useRef<LiveTranslateSession | null>(null);

  useEffect(() => () => { sessionRef.current?.close(); }, []);

  async function toggleSession() {
    if (sessionRef.current) {
      sessionRef.current.close(); sessionRef.current = null; setSessionActive(false); setState("stopped"); return;
    }
    setError(null); setSourceText("");
    setUsage(calculateLiveUsage());
    try {
      const headers = await sbAuthHeaders();
      const localKey = getLocalGeminiKey();
      if (localKey) headers["x-gemini-key"] = localKey;
      const response = await fetch("/api/ai/live-translate-token", { headers });
      const data = await response.json() as { token?: string; error?: string };
      if (!response.ok || !data.token) throw new Error(data.error || "Токен недоступен");
      const session = new LiveTranslateSession(data.token, {
        onState: setState,
        onSourceText: (text) => setSourceText((current) => appendTranscript(current, text)),
        onUsage: (metadata: LiveUsageMetadata) => setUsage((current) => accumulateLiveUsage(current, metadata)),
        onError: (kind, message) => { sessionRef.current?.close(); sessionRef.current = null; setSessionActive(false); setState(kind); setError(message); },
      });
      sessionRef.current = session;
      setSessionActive(true);
      await session.connect();
    } catch (err) {
      setSessionActive(false);
      setState("connection-error"); setError(err instanceof Error ? err.message : "Не удалось подключиться");
    }
  }

  const running = sessionActive && !["ready", "stopped", "mic-error", "connection-error"].includes(state);

  return (
    <section className="live-translate-screen" aria-label="Live перевод">
      <header className="live-translate-header">
        <button type="button" className="icon-btn" onClick={() => { sessionRef.current?.close(); sessionRef.current = null; setSessionActive(false); onBack(); }} aria-label="Назад"><ArrowLeft size={20} /></button>
        <span className="live-translate-brand"><Languages size={17} /> Live перевод</span>
        <span className="live-translate-badge">RU</span>
      </header>

      <main className="live-translate-main">
        <div className={`live-translate-orbit${running ? " active" : ""}`} aria-hidden="true"><div className="live-translate-orbit-core"><Radio size={34} /></div></div>
        <p className="live-translate-kicker">Перевод разговора</p>
        <h1>{running ? "Говорите свободно" : state === "stopped" ? "До встречи" : "Русский перевод"}</h1>
        <p className="live-translate-status" role="status">{LIVE_TRANSLATE_LABELS[state]}</p>
        <button type="button" className={`live-translate-start${running ? " is-running" : ""}`} onClick={() => void toggleSession()} aria-pressed={running}>
          {running ? <MicOff size={22} /> : <Mic size={22} />}
          <span>{running ? "Остановить перевод" : "Начать перевод"}</span>
        </button>
        <p className="live-translate-hint"><Volume2 size={14} /> Лучше использовать наушники, чтобы избежать эха</p>
        {error && <div className="live-translate-error" role="alert">{error}</div>}
      </main>

      <footer className="live-translate-footer">
        <button type="button" className="live-translate-text-toggle" onClick={() => setShowText((value) => !value)} aria-expanded={showText}>
          {showText ? "Скрыть текст" : "Показать текст"}
        </button>
        {showText && <div className="live-translate-transcript"><span>Исходная речь</span><p>{sourceText || "Транскрипция появится здесь во время разговора…"}</p></div>}
        <small>Язык собеседника определяется автоматически · перевод на русский<br />Модель: {LIVE_TRANSLATE_MODEL}</small>
        <div className="live-translate-usage" title="Оценка по usageMetadata текущей сессии. Включённая транскрипция может добавить текстовые токены сверх аудио-стоимости.">
          <span>Расход · оценка</span><span>вход {usage.inputTokens.toLocaleString("ru-RU")}</span><span>выход {usage.outputTokens.toLocaleString("ru-RU")}</span><span>всего {usage.totalTokens.toLocaleString("ru-RU")}</span><strong>${usage.estimatedUsd.toFixed(4)}</strong>
          {usage.detailUnavailable && <em>детализация недоступна</em>}
        </div>
        <small className="live-translate-usage-note">Оценка по токенам, не счёт. Транскрипция может добавить текстовые токены.</small>
      </footer>
    </section>
  );
}
