"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, HelpCircle, Lightbulb, Loader2, MessageCircle, RotateCcw, Send, Sparkles } from "lucide-react";
import { DictateButton } from "@/components/discover/DictateButton";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { fetchVerbPhraseTutor, type VerbPhraseTutorCorrection, type VerbPhraseTutorMessage, type VerbPhraseTutorReply } from "@/lib/ai/verbPhraseTutor";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";

type Props = {
  entry: DictionaryEntry;
  targetLanguage: string;
  nativeLanguage: string;
  onAccepted: () => void;
  onFinish: () => void;
};

const DEFAULT_SUGGESTIONS = ["Дай подсказку", "Объясни проще", "Дай похожий пример"];

function messageForReply(reply: VerbPhraseTutorReply): VerbPhraseTutorMessage {
  return { role: "model", text: reply.reply };
}

export function VerbPhraseTutor({ entry, targetLanguage, nativeLanguage, onAccepted, onFinish }: Props) {
  const [messages, setMessages] = useState<VerbPhraseTutorMessage[]>([]);
  const [challenge, setChallenge] = useState<{ nativePrompt: string } | null>(null);
  const [correction, setCorrection] = useState<VerbPhraseTutorCorrection | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<"answer" | "question">("answer");
  const [busy, setBusy] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"start" | "answer" | "hint" | "question">("start");
  const [startAttempt, setStartAttempt] = useState(0);
  const messagesRef = useRef<VerbPhraseTutorMessage[]>([]);
  const challengeRef = useRef<{ nativePrompt: string } | undefined>(undefined);
  const acceptedReportedRef = useRef(false);
  const onAcceptedRef = useRef(onAccepted);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onAcceptedRef.current = onAccepted;
  }, [onAccepted]);

  useEffect(() => {
    let cancelled = false;
    messagesRef.current = [];
    challengeRef.current = undefined;
    void fetchVerbPhraseTutor({
      action: "start",
      lemma: entry.lemma,
      headword: entry.headword,
      translation: entry.translation,
      targetLanguage,
      nativeLanguage,
    }).then((reply) => {
      if (cancelled) return;
      const nextMessages = [messageForReply(reply)];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      const nextChallenge = reply.challenge ?? null;
      challengeRef.current = nextChallenge ?? undefined;
      setChallenge(nextChallenge);
      setSuggestions(reply.suggestions?.length ? reply.suggestions : DEFAULT_SUGGESTIONS);
      setCorrection(reply.correction ?? null);
      setAccepted(reply.status === "accepted");
      if (reply.status === "accepted" && !acceptedReportedRef.current) {
        acceptedReportedRef.current = true;
        onAcceptedRef.current();
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось запустить практику.");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [entry.id, entry.lemma, entry.headword, entry.translation, targetLanguage, nativeLanguage, startAttempt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy, correction]);

  async function send(action: "answer" | "hint" | "question", value: string) {
    if (busy || accepted) return;
    const text = value.trim();
    if (!text && action !== "hint") return;

    const visibleText = action === "hint" ? "Дай небольшую подсказку" : text;
    const previousMessages = messagesRef.current;
    const nextMessages = [...previousMessages, { role: "user" as const, text: visibleText }];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setError(null);
    setCorrection(null);
    setLastAction(action);

    try {
      const reply = await fetchVerbPhraseTutor({
        action,
        lemma: entry.lemma,
        headword: entry.headword,
        translation: entry.translation,
        targetLanguage,
        nativeLanguage,
        challenge: challengeRef.current,
        history: previousMessages,
        message: visibleText,
      });
      const withReply = [...messagesRef.current, messageForReply(reply)];
      messagesRef.current = withReply;
      setMessages(withReply);
      if (reply.challenge) {
        challengeRef.current = reply.challenge;
        setChallenge(reply.challenge);
      }
      setCorrection(reply.correction ?? null);
      setSuggestions(reply.suggestions?.length ? reply.suggestions : DEFAULT_SUGGESTIONS);
      if (reply.status === "accepted") {
        setAccepted(true);
        if (!acceptedReportedRef.current) {
          acceptedReportedRef.current = true;
          onAcceptedRef.current();
        }
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Не удалось получить ответ репетитора.");
    } finally {
      setBusy(false);
    }
  }

  function retryRequest() {
    if (lastAction === "start") {
      setBusy(true);
      setError(null);
      setStartAttempt((attempt) => attempt + 1);
      return;
    }
    const retryText = lastAction === "hint" ? "" : input;
    void send(lastAction, retryText);
  }

  return (
    <div className="verb-phrase-tutor" aria-label="Практика фраз с ИИ">
      <div className="verb-phrase-tutor-heading">
        <div className="verb-phrase-tutor-heading-icon"><Sparkles size={17} /></div>
        <div>
          <strong>Живой репетитор</strong>
          <span>Пиши как умеешь — разберём вместе</span>
        </div>
        <MessageCircle size={17} className="verb-phrase-tutor-heading-chat" />
      </div>

      {challenge && (
        <div className="verb-phrase-tutor-challenge">
          <span className="verb-phrase-tutor-label">Твоя задача</span>
          <strong>{challenge.nativePrompt}</strong>
          <span>Скажи это на языке обучения с глаголом «{entry.headword}».</span>
        </div>
      )}

      <div className="verb-phrase-tutor-messages" aria-live="polite">
        {messages.map((message, index) => (
          <div key={String(index) + message.role + message.text.slice(0, 12)} className={"verb-phrase-tutor-message " + message.role}>
            <span className="verb-phrase-tutor-message-role">{message.role === "model" ? "AI-репетитор" : "Ты"}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {busy && (
          <div className="verb-phrase-tutor-message model typing">
            <span className="verb-phrase-tutor-message-role">AI-репетитор</span>
            <span className="verb-phrase-tutor-typing"><Loader2 size={14} className="spin" /> Думаю над ответом…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {correction && (correction.target || correction.explanation) && (
        <div className={"verb-phrase-tutor-correction" + (accepted ? " accepted" : "")}>
          <div className="verb-phrase-tutor-correction-title">
            {accepted ? <CheckCircle2 size={17} /> : <Lightbulb size={17} />}
            <strong>{accepted ? "Отлично — фраза засчитана" : "Вот как сказать естественнее"}</strong>
          </div>
          {correction.target && (
            <div className="verb-phrase-tutor-correction-target">
              <strong>{correction.target}</strong>
              <SpeakButton text={correction.target} lang={targetLanguage} size={17} />
            </div>
          )}
          {correction.translation && <span className="verb-phrase-tutor-correction-translation">{correction.translation}</span>}
          {correction.explanation && <p>{correction.explanation}</p>}
        </div>
      )}

      {error && (
        <div className="verb-phrase-tutor-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={retryRequest} disabled={busy}>
            <RotateCcw size={14} /> Повторить
          </button>
        </div>
      )}

      {!accepted && (
        <>
          <div className="verb-phrase-tutor-suggestions">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={busy}
                onClick={() => void send(suggestion.toLocaleLowerCase().includes("подсказ") ? "hint" : "question", suggestion)}
              >
                {suggestion.toLocaleLowerCase().includes("подсказ") ? <Lightbulb size={13} /> : <HelpCircle size={13} />}
                {suggestion}
              </button>
            ))}
          </div>
          <form
            className="verb-phrase-tutor-input"
            onSubmit={(event) => {
              event.preventDefault();
              void send(inputMode, input);
            }}
          >
            <div className="verb-phrase-tutor-mode-row">
              <span>{inputMode === "answer" ? "Твой вариант на языке обучения" : "Спроси репетитора"}</span>
              <button
                type="button"
                onClick={() => setInputMode((mode) => mode === "answer" ? "question" : "answer")}
                disabled={busy}
              >
                {inputMode === "answer" ? "Задать вопрос" : "Вернуться к ответу"}
              </button>
            </div>
            <div className="verb-phrase-tutor-input-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={inputMode === "answer" ? "Напиши фразу… можно с ошибками" : "Например: почему здесь такой порядок слов?"}
                rows={2}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                aria-label={inputMode === "answer" ? "Твой вариант фразы" : "Вопрос репетитору"}
              />
              <div className="verb-phrase-tutor-input-actions">
                <DictateButton
                  lang={targetLanguage}
                  title="Продиктовать фразу"
                  disabled={busy}
                  onText={(text) => setInput((previous) => [previous.trim(), text].filter(Boolean).join(" "))}
                />
                <button type="submit" className="verb-phrase-tutor-send" disabled={busy || !input.trim()} aria-label="Отправить">
                  <Send size={17} />
                </button>
              </div>
            </div>
          </form>
        </>
      )}

      {accepted && (
        <button type="button" className="primary-btn verb-phrase-tutor-next" onClick={onFinish}>
          Следующая фраза <ArrowRight size={17} />
        </button>
      )}
    </div>
  );
}
