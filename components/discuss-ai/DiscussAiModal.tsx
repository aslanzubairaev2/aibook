"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, X } from "lucide-react";
import { discussWithAi } from "@/lib/ai/discuss";
import { normalizeToken, splitIntoTokens } from "@/lib/selector/text";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { AiMode, DiscussContentPart, DiscussMessage } from "@/lib/types";

type Props = {
  isOpen: boolean;
  mode: AiMode;
  selectedText: string;
  sentence: string;
  sentenceBefore?: string;
  sentenceAfter?: string;
  nativeLanguage: string;
  targetLanguage: string;
  messages: DiscussMessage[];
  onMessagesChange: (messages: DiscussMessage[]) => void;
  onClose: () => void;
  onWordTap: (word: string, contextSentence: string) => void;
};

const MODE_LABEL: Record<AiMode, string> = {
  word: "слово",
  phrase: "фразу",
  sentence: "предложение",
};

const QUICK_PROMPTS: Record<AiMode, string[]> = {
  word: ["Дай примеры", "Чем отличается?", "Как запомнить?"],
  phrase: ["Когда так говорят?", "Дай 3 примера", "Разбери слова"],
  sentence: ["Разбери структуру", "Проще объясни", "Дай похожее"],
};

export function DiscussAiModal({
  isOpen,
  mode,
  selectedText,
  sentence,
  sentenceBefore,
  sentenceAfter,
  nativeLanguage,
  targetLanguage,
  messages,
  onMessagesChange,
  onClose,
  onWordTap,
}: Props) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const initialSentRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = nativeLanguage === "ru" ? "ru-RU" : nativeLanguage;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) setInput((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [isOpen, nativeLanguage]);

  useEffect(() => {
    if (!isOpen) return;
    const initialKey = `${mode}:${selectedText}:${sentence}`;
    if (messages.length > 0 || initialSentRef.current === initialKey) return;
    initialSentRef.current = initialKey;
    void sendMessage("Дай короткий общий анализ и сводку по выбранному тексту.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, selectedText, sentence]);

  async function sendMessage(messageText: string) {
    const text = messageText.trim();
    if (!text || isSending) return;

    const userMessage: DiscussMessage = { role: "user", text };
    const history = [...messages, userMessage];
    onMessagesChange(history);
    setInput("");
    setIsSending(true);

    try {
      const response = await discussWithAi({
        mode,
        selectedText,
        sentence,
        sentenceBefore,
        sentenceAfter,
        nativeLanguage,
        targetLanguage,
        history: messages,
        message: text,
      });
      onMessagesChange([...history, response]);
    } catch {
      onMessagesChange([
        ...history,
        {
          role: "model",
          contentParts: [{ type: "text", text: "Не получилось связаться с AI. Попробуйте еще раз." }],
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function toggleListening() {
    if (!recognitionRef.current || isSending) return;
    if (isListening) recognitionRef.current.stop();
    else recognitionRef.current.start();
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop discuss-backdrop" onClick={onClose}>
      <section className="discuss-modal" role="dialog" aria-modal aria-label="Обсудить с AI" onClick={(e) => e.stopPropagation()}>
        <header className="discuss-header">
          <div>
            <span>Обсудить с AI</span>
            <strong>{MODE_LABEL[mode]}: {selectedText}</strong>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>

        <div className="discuss-messages">
          {messages.length === 0 && (
            <div className="discuss-empty">
              Спросите, как это употребляется, чем отличается от похожих вариантов или попросите примеры.
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`discuss-row ${message.role === "user" ? "user" : "model"}`}>
              <div className="discuss-bubble">
                <DiscussMessageContent
                  message={message}
                  lang={targetLanguage}
                  onWordTap={onWordTap}
                />
              </div>
            </div>
          ))}
          {isSending && (
            <div className="discuss-row model">
              <div className="discuss-bubble typing">
                <Loader2 size={14} className="spin" />
                AI печатает...
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="discuss-input"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(input);
          }}
        >
          <div className="discuss-quick-prompts">
            {QUICK_PROMPTS[mode].map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={isSending}
                onClick={() => void sendMessage(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={isListening ? "Слушаю..." : "Короткий вопрос"}
            disabled={isSending}
          />
          {speechSupported && (
            <button type="button" className={isListening ? "listening" : ""} onClick={toggleListening} disabled={isSending} aria-label="Голосовой ввод">
              <Mic size={17} />
            </button>
          )}
          <button type="submit" disabled={!input.trim() || isSending} aria-label="Отправить">
            <Send size={17} />
          </button>
        </form>
      </section>
    </div>
  );
}

function DiscussMessageContent({
  message,
  lang,
  onWordTap,
}: {
  message: DiscussMessage;
  lang: string;
  onWordTap: (word: string, contextSentence: string) => void;
}) {
  if (message.contentParts?.length) {
    return (
      <div className="discuss-content-parts">
        {message.contentParts.map((part, index) => (
          <Part key={`${part.text}-${index}`} part={part} lang={lang} onWordTap={onWordTap} />
        ))}
      </div>
    );
  }

  return <p>{message.text}</p>;
}

function Part({
  part,
  lang,
  onWordTap,
}: {
  part: DiscussContentPart;
  lang: string;
  onWordTap: (word: string, contextSentence: string) => void;
}) {
  if (part.type !== "learning") return <span>{part.text}</span>;

  return (
    <span className="discuss-learning-part">
      <span>
        {splitIntoTokens(part.text).map((token, index) => {
          if (!normalizeToken(token)) return <span key={index}>{token}</span>;
          return (
            <span
              key={index}
              role="button"
              tabIndex={0}
              className="discuss-clickable-word"
              onClick={() => onWordTap(token, part.text)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onWordTap(token, part.text);
              }}
            >
              {token}
            </span>
          );
        })}
      </span>
      <SpeakButton text={part.text} lang={lang} size={12} />
    </span>
  );
}
