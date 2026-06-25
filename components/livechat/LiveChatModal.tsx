"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { getLocalGeminiKey } from "@/lib/db/local";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { LiveChatSession, type LiveChatStatus } from "@/lib/ai/liveChat";

type Props = {
  isOpen: boolean;
  nativeLanguage: string;
  targetLanguage: string;
  onClose: () => void;
  onOpenSettings: () => void;
};

type TranscriptLine = { role: "user" | "model"; text: string };

const STATUS_LABEL: Record<LiveChatStatus, string> = {
  idle: "Подключение...",
  connecting: "Подключение...",
  listening: "Слушаю вас",
  speaking: "AI отвечает",
  error: "Ошибка соединения",
  closed: "Звонок завершён",
};

const NO_KEY_MESSAGE = "Добавьте свой Gemini API ключ в настройках, чтобы начать голосовой чат.";
const MIC_DENIED_MESSAGE = "Нет доступа к микрофону. Разрешите доступ в настройках браузера и попробуйте снова.";

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

export function LiveChatModal({ isOpen, nativeLanguage, targetLanguage, onClose, onOpenSettings }: Props) {
  const [status, setStatus] = useState<LiveChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<TranscriptLine[]>([]);
  const [liveUser, setLiveUser] = useState("");
  const [liveModel, setLiveModel] = useState("");

  const sessionRef = useRef<LiveChatSession | null>(null);
  const prevStatusRef = useRef<LiveChatStatus>("idle");
  const liveUserRef = useRef("");
  const liveModelRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    setError(null);
    setHistory([]);
    setLiveUser("");
    setLiveModel("");
    liveUserRef.current = "";
    liveModelRef.current = "";
    prevStatusRef.current = "idle";
    setStatus("connecting");

    (async () => {
      const apiKey = await resolveGeminiKey();
      if (cancelled) return;
      if (!apiKey) {
        setError(NO_KEY_MESSAGE);
        setStatus("error");
        return;
      }

      const session = new LiveChatSession(apiKey, {
        onStatusChange: setStatus,
        onUserTranscript: (text) => {
          liveUserRef.current += text;
          setLiveUser(liveUserRef.current);
        },
        onModelTranscript: (text) => {
          liveModelRef.current += text;
          setLiveModel(liveModelRef.current);
        },
        onError: (message) => setError(message),
      });
      sessionRef.current = session;

      session.connect(nativeLanguage, targetLanguage).catch((err) => {
        const message = err?.name === "NotAllowedError" ? MIC_DENIED_MESSAGE : (err?.message || "Не удалось начать звонок");
        setError(message);
        setStatus("error");
      });
    })();

    return () => {
      cancelled = true;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [isOpen, nativeLanguage, targetLanguage]);

  // Turn user speech / model speech into finalized transcript lines as the call progresses.
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === "listening" && status === "speaking" && liveUserRef.current.trim()) {
      setHistory((h) => [...h, { role: "user", text: liveUserRef.current.trim() }]);
      liveUserRef.current = "";
      setLiveUser("");
    }
    if (prev === "speaking" && status === "listening" && liveModelRef.current.trim()) {
      setHistory((h) => [...h, { role: "model", text: liveModelRef.current.trim() }]);
      liveModelRef.current = "";
      setLiveModel("");
    }
    prevStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, liveUser, liveModel]);

  function handleClose() {
    sessionRef.current?.close();
    onClose();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }

  if (!isOpen) return null;

  const isLive = status === "listening" || status === "speaking";

  return (
    <div className="modal-backdrop livechat-backdrop">
      <section className="livechat-modal" role="dialog" aria-modal aria-label="Голосовой чат с AI">
        <header className="livechat-header">
          <span>Голосовой чат</span>
          <button className="icon-btn" type="button" onClick={handleClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>

        <div className="livechat-body">
          <div className={`livechat-orb ${status}`}>
            {status === "connecting" || status === "idle" ? <Loader2 size={28} className="spin" /> : <Mic size={28} />}
          </div>
          <strong className="livechat-status">{STATUS_LABEL[status]}</strong>

          {error && (
            <div className="livechat-error">
              <p>{error}</p>
              {error === NO_KEY_MESSAGE && (
                <button type="button" className="primary-btn" onClick={onOpenSettings}>
                  Открыть настройки
                </button>
              )}
            </div>
          )}

          <div className="livechat-transcript">
            {history.length === 0 && !liveUser && !liveModel && !error && (
              <p className="livechat-empty">Скажите что-нибудь — AI вас услышит и ответит голосом.</p>
            )}
            {history.map((line, index) => (
              <p key={index} className={`livechat-line ${line.role}`}>
                {line.text}
              </p>
            ))}
            {liveUser && <p className="livechat-line user pending">{liveUser}</p>}
            {liveModel && <p className="livechat-line model pending">{liveModel}</p>}
            <div ref={endRef} />
          </div>
        </div>

        <div className="livechat-controls">
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
      </section>
    </div>
  );
}
