"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Mic, Send, X, Quote, Plus } from "lucide-react";
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
  onAddExample?: (text: string, translation: string) => void;
  isHistoryLoading?: boolean;
};

const MODE_LABEL: Record<AiMode, string> = {
  word: "слово",
  phrase: "фраза",
  sentence: "предложение",
};

const BASE_QUICK_PROMPTS: Record<AiMode, string[]> = {
  word: ["Примеры", "Отличия", "Как запомнить"],
  phrase: ["Когда говорят", "3 примера", "Разбор слов"],
  sentence: ["Структура", "Проще", "Похожее"],
};

const FOLLOW_UP_PROMPTS = [
  "Ещё примеры",
  "А синонимы?",
  "Подробнее",
  "Когда используют?",
  "Антонимы",
];

const DISCUSS_LABEL = "Обсудить с AI";
const CLOSE_LABEL = "Закрыть";
const LISTENING_PLACEHOLDER = "Слушаю...";
const QUESTION_PLACEHOLDER = "Короткий вопрос";
const VOICE_INPUT_LABEL = "Голосовой ввод";
const SEND_LABEL = "Отправить";
const EMPTY_TEXT = "AI сейчас подготовит короткий разбор. Можно сразу спросить о примерах, отличиях или грамматике.";
const TYPING_TEXT = "AI печатает...";
const ERROR_TEXT = "Не получилось связаться с AI. Попробуйте еще раз.";
const QUOTE_LABEL = "Цитировать";

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
  onAddExample,
  isHistoryLoading = false,
}: Props) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [dynamicPrompts, setDynamicPrompts] = useState<string[] | null>(null);
  const [placeholderOverride, setPlaceholderOverride] = useState<string | null>(null);
  const initialSentRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const interimRef = useRef("");
  const latestSelectionRef = useRef("");
  const placeholderTimerRef = useRef<any>(null);
  const latestMessagesRef = useRef(messages);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (placeholderTimerRef.current) {
        clearTimeout(placeholderTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  // Document selection change listener to preserve mobile/desktop highlight selections before click clears them
  useEffect(() => {
    if (!isOpen) return;

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text) {
        let node = selection?.anchorNode;
        let isModelBubble = false;
        while (node) {
          if (node instanceof HTMLElement && node.classList.contains("model-selectable")) {
            isModelBubble = true;
            break;
          }
          node = node.parentNode;
        }
        if (isModelBubble) {
          latestSelectionRef.current = text;
          return;
        }
      }
      // Don't immediately clear on click/touch to give click handler time to read it
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [isOpen]);

  const sendInitialPromptRef = useRef<() => void>(() => {});
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Speech recognition setup with ref-based callbacks to completely avoid stale state closures
  useEffect(() => {
    if (!isOpen) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = nativeLanguage === "ru" ? "ru-RU" : nativeLanguage;
    recognition.continuous = false; // continuous: false is critical for iOS and Android webview stability
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      interimRef.current = "";
    };

    recognition.onend = () => {
      setIsListening(false);
      const finalText = interimRef.current.trim();
      if (finalText) {
        void sendMessageRef.current(finalText);
        interimRef.current = "";
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      setIsListening(false);
      interimRef.current = "";

      let errorMsg = "";
      if (event.error === "not-allowed") {
        errorMsg = "Требуется HTTPS и доступ к микрофону";
      } else if (event.error === "no-speech") {
        errorMsg = "Речь не услышана";
      } else if (event.error === "audio-capture") {
        errorMsg = "Микрофон не найден";
      } else if (event.error === "network") {
        errorMsg = "Ошибка сети";
      } else {
        errorMsg = `Ошибка ввода: ${event.error}`;
      }

      setPlaceholderOverride(errorMsg);
      if (placeholderTimerRef.current) {
        clearTimeout(placeholderTimerRef.current);
      }
      placeholderTimerRef.current = setTimeout(() => {
        setPlaceholderOverride(null);
      }, 4000);
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        interimRef.current = finalTranscript.trim();
        setInput("");
        recognition.stop();
      } else if (interimTranscript.trim()) {
        setInput(interimTranscript.trim());
      }
    };

    recognitionRef.current = recognition;
    return () => {
      try { recognition.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, [isOpen, nativeLanguage]);

  // Auto-send initial analysis prompt (hidden from user)
  useEffect(() => {
    if (!isOpen || isHistoryLoading) return;
    const initialKey = `${mode}:${selectedText}:${sentence}`;
    if (messages.length > 0 || initialSentRef.current === initialKey) return;
    initialSentRef.current = initialKey;
    void sendInitialPromptRef.current();
  }, [isOpen, mode, selectedText, sentence, messages.length, isHistoryLoading]);

  // Update dynamic prompts after AI responds
  useEffect(() => {
    if (messages.length < 2) {
      setDynamicPrompts(null);
      return;
    }
    const shuffled = [...FOLLOW_UP_PROMPTS].sort(() => Math.random() - 0.5);
    setDynamicPrompts(shuffled.slice(0, 3));
  }, [messages.length]);

  // Send the initial prompt WITHOUT showing it in the chat
  async function sendInitialPrompt() {
    if (isSending) return;
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
        history: [],
        message: INITIAL_ANALYSIS_PROMPT,
      });
      if (latestMessagesRef.current.length === 0) {
        onMessagesChange([response]);
      }
    } catch {
      if (latestMessagesRef.current.length === 0) {
        onMessagesChange([
          {
            role: "model",
            contentParts: [{ type: "text", text: ERROR_TEXT }],
          },
        ]);
      }
    } finally {
      setIsSending(false);
    }
  }
  sendInitialPromptRef.current = sendInitialPrompt;

  const sendMessage = useCallback(async function sendMessage(messageText: string) {
    const text = messageText.trim();
    if (!text || isSending) return;

    let fullText = text;
    if (quotedText) {
      fullText = `[Цитата: "${quotedText}"] ${text}`;
      setQuotedText(null);
    }

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
        message: fullText,
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
  }, [isSending, quotedText, messages, onMessagesChange, mode, selectedText, sentence, sentenceBefore, sentenceAfter, nativeLanguage, targetLanguage]);

  // Keep ref updated to prevent SpeechRecognition from getting stale values
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  function toggleListening() {
    if (!recognitionRef.current || isSending) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setInput("");
      interimRef.current = "";
      recognitionRef.current.start();
    }
  }

  function handleQuoteFromBubble(text: string) {
    if (latestSelectionRef.current) {
      setQuotedText(latestSelectionRef.current);
      // Clear the ref once consumed
      latestSelectionRef.current = "";
    } else {
      setQuotedText(text);
    }
  }

  if (!isOpen) return null;

  const currentPrompts = dynamicPrompts || BASE_QUICK_PROMPTS[mode];

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
              {isSending ? TYPING_TEXT : EMPTY_TEXT}
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`discuss-row ${message.role === "user" ? "user" : "model"}`}>
              <div className={`discuss-bubble${message.role === "model" ? " model-selectable" : ""}`}>
                <DiscussMessageContent
                  message={message}
                  lang={targetLanguage}
                  onWordTap={onWordTap}
                  onAddExample={onAddExample}
                />
                {message.role === "model" && (
                  <button
                    type="button"
                    className="discuss-bubble-quote-btn"
                    onClick={() => {
                      const text = message.contentParts?.map(p => p.text).join(" ") || message.text || "";
                      handleQuoteFromBubble(text);
                    }}
                    aria-label={QUOTE_LABEL}
                    title={QUOTE_LABEL}
                  >
                    <Quote size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {isSending && messages.length > 0 && (
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
          {quotedText && (
            <div className="discuss-quote-bar">
              <span>«{quotedText}»</span>
              <button type="button" onClick={() => setQuotedText(null)} aria-label="Убрать цитату">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="discuss-quick-prompts">
            {currentPrompts.map((prompt) => (
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
            placeholder={placeholderOverride || (isListening ? LISTENING_PLACEHOLDER : QUESTION_PLACEHOLDER)}
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
  onAddExample,
}: {
  message: DiscussMessage;
  lang: string;
  onWordTap: (word: string, contextSentence: string) => void;
  onAddExample?: (text: string, translation: string) => void;
}) {
  if (message.contentParts?.length) {
    return (
      <div className="discuss-content-parts">
        {message.contentParts.map((part, index) => (
          <Part key={`${part.text}-${index}`} part={part} lang={lang} onWordTap={onWordTap} onAddExample={onAddExample} />
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
  onAddExample,
}: {
  part: DiscussContentPart;
  lang: string;
  onWordTap: (word: string, contextSentence: string) => void;
  onAddExample?: (text: string, translation: string) => void;
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
        {onAddExample && part.translation && (
          <button
            type="button"
            className="discuss-add-example-btn"
            aria-label="Добавить в карточки"
            title="Добавить в карточки"
            onClick={() => onAddExample(part.text, part.translation ?? "")}
          >
            <Plus size={12} />
          </button>
        )}
      </span>
      {part.translation && <span className="discuss-learning-translation">{part.translation}</span>}
    </span>
  );
}
