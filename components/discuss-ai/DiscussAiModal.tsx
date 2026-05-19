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
  word: "\u0441\u043b\u043e\u0432\u043e",
  phrase: "\u0444\u0440\u0430\u0437\u0430",
  sentence: "\u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435",
};

const QUICK_PROMPTS: Record<AiMode, string[]> = {
  word: ["\u041f\u0440\u0438\u043c\u0435\u0440\u044b", "\u041e\u0442\u043b\u0438\u0447\u0438\u044f", "\u041a\u0430\u043a \u0437\u0430\u043f\u043e\u043c\u043d\u0438\u0442\u044c"],
  phrase: ["\u041a\u043e\u0433\u0434\u0430 \u0433\u043e\u0432\u043e\u0440\u044f\u0442", "3 \u043f\u0440\u0438\u043c\u0435\u0440\u0430", "\u0420\u0430\u0437\u0431\u043e\u0440 \u0441\u043b\u043e\u0432"],
  sentence: ["\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430", "\u041f\u0440\u043e\u0449\u0435", "\u041f\u043e\u0445\u043e\u0436\u0435\u0435"],
};

const DISCUSS_LABEL = "\u041e\u0431\u0441\u0443\u0434\u0438\u0442\u044c \u0441 AI";
const CLOSE_LABEL = "\u0417\u0430\u043a\u0440\u044b\u0442\u044c";
const LISTENING_PLACEHOLDER = "\u0421\u043b\u0443\u0448\u0430\u044e...";
const QUESTION_PLACEHOLDER = "\u041a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u0432\u043e\u043f\u0440\u043e\u0441";
const VOICE_INPUT_LABEL = "\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u043e\u0439 \u0432\u0432\u043e\u0434";
const SEND_LABEL = "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c";
const EMPTY_TEXT = "AI \u0441\u0435\u0439\u0447\u0430\u0441 \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442 \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u0440\u0430\u0437\u0431\u043e\u0440. \u041c\u043e\u0436\u043d\u043e \u0441\u0440\u0430\u0437\u0443 \u0441\u043f\u0440\u043e\u0441\u0438\u0442\u044c \u043e \u043f\u0440\u0438\u043c\u0435\u0440\u0430\u0445, \u043e\u0442\u043b\u0438\u0447\u0438\u044f\u0445 \u0438\u043b\u0438 \u0433\u0440\u0430\u043c\u043c\u0430\u0442\u0438\u043a\u0435.";
const TYPING_TEXT = "AI \u043f\u0435\u0447\u0430\u0442\u0430\u0435\u0442...";
const ERROR_TEXT = "\u041d\u0435 \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c \u0441\u0432\u044f\u0437\u0430\u0442\u044c\u0441\u044f \u0441 AI. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0435 \u0440\u0430\u0437.";

const INITIAL_ANALYSIS_PROMPT =
  "Give a short general analysis and summary for the selected text. If you use examples in the target language, add translations to the native language.";

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
    void sendMessage(INITIAL_ANALYSIS_PROMPT);
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
          contentParts: [{ type: "text", text: ERROR_TEXT }],
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
      <section className="discuss-modal" role="dialog" aria-modal aria-label={DISCUSS_LABEL} onClick={(e) => e.stopPropagation()}>
        <header className="discuss-header">
          <div>
            <span>{DISCUSS_LABEL}</span>
            <strong>{MODE_LABEL[mode]}: {selectedText}</strong>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label={CLOSE_LABEL}>
            <X size={19} />
          </button>
        </header>

        <div className="discuss-messages">
          {messages.length === 0 && (
            <div className="discuss-empty">
              {EMPTY_TEXT}
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
                {TYPING_TEXT}
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
            placeholder={isListening ? LISTENING_PLACEHOLDER : QUESTION_PLACEHOLDER}
            disabled={isSending}
          />
          {speechSupported && (
            <button type="button" className={isListening ? "listening" : ""} onClick={toggleListening} disabled={isSending} aria-label={VOICE_INPUT_LABEL}>
              <Mic size={17} />
            </button>
          )}
          <button type="submit" disabled={!input.trim() || isSending} aria-label={SEND_LABEL}>
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
      <span className="discuss-learning-main">
        <span className="discuss-learning-text">
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
      {part.translation && <span className="discuss-learning-translation">{part.translation}</span>}
    </span>
  );
}
