"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Shuffle, X } from "lucide-react";
import { getLocalGeminiKey } from "@/lib/db/local";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { LiveChatSession, type LiveChatMode, type LiveChatStatus } from "@/lib/ai/liveChat";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import {
  fetchLiveScenarios,
  fetchLiveSuggestions,
  translateText,
  type LiveScenario,
  type LiveSuggestion,
} from "@/lib/ai/liveChatExtras";
import type { CefrLevel } from "@/lib/types";

type Props = {
  isOpen: boolean;
  nativeLanguage: string;
  targetLanguage: string;
  /** Set when the call was started from a specific text passage (the phone icon on a CEFR text) — adds a scenario-picker step and grounds the conversation in that text. */
  textContext?: { text: string } | null;
  onClose: () => void;
  onOpenSettings: () => void;
};

type TranscriptLine = { role: "user" | "model"; text: string };

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

const EMPTY_PLACEHOLDER: Record<LiveChatMode, string> = {
  call: "Скажите что-нибудь — AI вас услышит и ответит голосом.",
  discuss: "Спросите что-нибудь о языке — например, про грамматику или слово.",
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

export function LiveChatModal({ isOpen, nativeLanguage, targetLanguage, textContext, onClose, onOpenSettings }: Props) {
  const [status, setStatus] = useState<LiveChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<TranscriptLine[]>([]);
  const [liveUser, setLiveUser] = useState("");
  const [liveModel, setLiveModel] = useState("");
  const [mode, setMode] = useState<LiveChatMode>("call");

  const [scenarios, setScenarios] = useState<LiveScenario[] | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<LiveScenario | null>(null);

  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translating, setTranslating] = useState<Set<number>>(new Set());

  const [suggestions, setSuggestions] = useState<LiveSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(true);

  const sessionRef = useRef<LiveChatSession | null>(null);
  const prevStatusRef = useRef<LiveChatStatus>("idle");
  const liveUserRef = useRef("");
  const liveModelRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);

  const contextText = textContext?.text ?? null;
  const needsScenario = !!contextText;

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

    setHistory([]);
    setError(null);
    setLiveUser("");
    setLiveModel("");
    setSuggestions([]);
    setRevealed(new Set());
    setTranslations({});
    liveUserRef.current = "";
    liveModelRef.current = "";
    prevStatusRef.current = "idle";
    setStatus("connecting");

    (async () => {
      const [apiKey, levelEstimate] = await Promise.all([
        resolveGeminiKey(),
        estimateTargetLanguageLevel(targetLanguage).catch(() => null),
      ]);
      if (cancelled) return;
      if (!apiKey) {
        setError(NO_KEY_MESSAGE);
        setStatus("error");
        return;
      }
      setSuggestionsVisible(!levelEstimate || SUGGESTIONS_DEFAULT_LEVELS.includes(levelEstimate.level));

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

      session
        .connect(nativeLanguage, targetLanguage, {
          mode,
          levelSummary: levelEstimate?.summary,
          textContext: contextText && selectedScenario ? { text: contextText, scenario: selectedScenario } : undefined,
        })
        .catch((err) => {
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
  }, [isOpen, nativeLanguage, targetLanguage, mode, needsScenario, contextText, selectedScenario]);

  const fetchSuggestionsFor = useCallback(
    (lastLine: string) => {
      setSuggestionsLoading(true);
      fetchLiveSuggestions(lastLine, nativeLanguage, targetLanguage, selectedScenario?.prompt)
        .then((list) => setSuggestions(list))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestionsLoading(false));
    },
    [nativeLanguage, targetLanguage, selectedScenario]
  );

  // Turn user speech / model speech into finalized transcript lines as the
  // call progresses, and fetch quick-reply suggestions after each AI turn.
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === "listening" && status === "speaking") {
      const text = cleanText(liveUserRef.current);
      if (text) setHistory((h) => [...h, { role: "user", text }]);
      liveUserRef.current = "";
      setLiveUser("");
      setSuggestions([]);
    }
    if (prev === "speaking" && status === "listening") {
      const text = cleanText(liveModelRef.current);
      if (text) {
        setHistory((h) => [...h, { role: "model", text }]);
        fetchSuggestionsFor(text);
      }
      liveModelRef.current = "";
      setLiveModel("");
    }
    prevStatusRef.current = status;
  }, [status, fetchSuggestionsFor]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, liveUser, liveModel, suggestions]);

  function handleClose() {
    sessionRef.current?.close();
    onClose();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }

  function handleSwitchScenario() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setSelectedScenario(null);
    setStatus("idle");
  }

  function handleSuggestionTap(suggestion: LiveSuggestion) {
    sessionRef.current?.sendText(suggestion.text);
    setHistory((h) => [...h, { role: "user", text: suggestion.text }]);
    setSuggestions([]);
  }

  async function revealTranslation(index: number, text: string) {
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
  }

  if (!isOpen) return null;

  const isLive = status === "listening" || status === "speaking";
  const pendingUser = cleanText(liveUser);
  const pendingModel = cleanText(liveModel);
  const showingScenarioPicker = needsScenario && !selectedScenario;
  const placeholder = needsScenario && selectedScenario
    ? `Сценарий: ${selectedScenario.label}. Начните говорить!`
    : EMPTY_PLACEHOLDER[mode];

  return (
    <div className="modal-backdrop livechat-backdrop">
      <section className="livechat-modal" role="dialog" aria-modal aria-label="Голосовой чат с AI">
        <header className="livechat-header">
          <span>Голосовой чат</span>
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
                    <span>{scenario.aiRole} ↔ {scenario.userRole}</span>
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
                {history.length === 0 && !pendingUser && !pendingModel && !error && (
                  <p className="livechat-empty">{placeholder}</p>
                )}
                {history.map((line, index) => (
                  <div key={index} className={`livechat-line-wrap ${line.role}`}>
                    <p className={`livechat-line ${line.role}`}>{line.text}</p>
                    {line.role === "model" && (
                      <div
                        className="livechat-translation"
                        onClick={() => revealTranslation(index, line.text)}
                        role="button"
                        tabIndex={0}
                        title={revealed.has(index) ? undefined : "Нажмите, чтобы увидеть перевод"}
                      >
                        <span className={revealed.has(index) ? "revealed" : "blurred"}>
                          {revealed.has(index)
                            ? (translating.has(index) ? <Loader2 size={12} className="spin" /> : translations[index])
                            : line.text}
                        </span>
                      </div>
                    )}
                  </div>
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
                              <span className="livechat-suggestion-translation">{suggestion.translation}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
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
          </>
        )}
      </section>
    </div>
  );
}
