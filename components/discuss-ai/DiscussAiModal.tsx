"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2, Mic, Send, X, Quote, Plus, Table2 } from "lucide-react";
import { discussWithAi } from "@/lib/ai/discuss";
import { INITIAL_DISCUSS_REQUEST } from "@/lib/ai/buildDiscussPrompt";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import { normalizeToken, splitIntoTokens } from "@/lib/selector/text";
import { discussHotkey, isTypingTarget } from "@/lib/srs/trainerHotkeys";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { GrammarModal } from "@/components/word-modal/GrammarModal";
import type {
  AiMode,
  DiscussAction,
  DiscussActionKind,
  DiscussContentPart,
  DiscussMessage,
  DiscussWordProfile,
  PosTag,
} from "@/lib/types";

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
  /**
   * How well this learner already knows the thing being discussed, read off
   * their own card for it. Lets the tutor hand over a memory hook for a word
   * that keeps being forgotten and skip the basics for one that is known.
   */
  wordProfile?: DiscussWordProfile;
  /** mode "homework" only: the exercise being discussed, blanks and all — required for that mode, since it is what the model's no-spoiler rule is checked against. */
  homeworkContext?: { instruction: string; items: string[] };
};

const MODE_LABEL: Record<AiMode, string> = {
  word: "слово",
  phrase: "фраза",
  sentence: "предложение",
  homework: "упражнение",
  audiobook: "аудиокнига",
};

// Shown only until the model's own follow-ups arrive with its first answer.
// Phrased the way the learner would ask, so tapping one reads as a question
// rather than as a category ("Отличия" answered a question nobody had asked).
const BASE_QUICK_PROMPTS: Record<AiMode, string[]> = {
  word: ["Как сказать «я …»", "Примеры из жизни", "Как запомнить"],
  phrase: ["Когда так говорят", "Сказать иначе", "Что ответить"],
  sentence: ["Скажи проще", "Разбери по частям", "Как ответить"],
  homework: ["Объясни ещё раз проще", "Похожий пример", "На что обратить внимание"],
  audiobook: ["О чём книга без спойлеров", "Подходит ли мне уровень", "Насколько быстро говорят"],
};

/** Which grammar table each button kind opens. */
const ACTION_POS: Record<Exclude<DiscussActionKind, "word">, PosTag> = {
  conjugation: "verb",
  declension: "noun",
  comparison: "adjective",
  forms: "other",
};

const DISCUSS_LABEL = "Обсудить с AI";
const CLOSE_LABEL = "Закрыть";
const LISTENING_PLACEHOLDER = "Слушаю...";
const QUESTION_PLACEHOLDER = "Короткий вопрос";
const VOICE_INPUT_LABEL = "Голосовой ввод";
const SEND_LABEL = "Отправить";
const EMPTY_TEXT = "Сейчас разберём: что это значит и как это сказать самому — с живыми примерами.";
const TYPING_TEXT = "AI печатает...";
const ERROR_TEXT = "Не получилось связаться с AI. Попробуйте еще раз.";
const QUOTE_LABEL = "Цитировать";
const FORMS_ACTION_LABEL = "Формы слова";

// Google's published effective rate for Gemini 3.5 Transcribe Live is about
// $0.009 per minute (audio input plus transcript output).
const GEMINI_TRANSCRIBE_USD_PER_MINUTE = 0.009;

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
  wordProfile,
  homeworkContext,
}: Props) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [transcriptionSeconds, setTranscriptionSeconds] = useState(0);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [placeholderOverride, setPlaceholderOverride] = useState<string | null>(null);
  // Estimated from books read and deck size, locally — see lib/ai/userLevel.
  // `ready` gates the opening request so the very first answer is already
  // pitched at the right level instead of being generic.
  const [learnerLevel, setLearnerLevel] = useState<{ ready: boolean; summary?: string }>({ ready: false });
  const [grammarFor, setGrammarFor] = useState<{ word: string; posTag: PosTag } | null>(null);
  const initialSentRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const interimRef = useRef("");
  const latestSelectionRef = useRef("");
  const placeholderTimerRef = useRef<any>(null);
  const transcriptionStartedAtRef = useRef<number | null>(null);
  const transcriptionTimerRef = useRef<number | null>(null);
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

  useEffect(() => () => {
    if (transcriptionTimerRef.current !== null) window.clearInterval(transcriptionTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  // Read the learner's level once per opening. A failure here is not worth
  // showing anyone: the discussion just proceeds without the hint.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const estimate = await estimateTargetLanguageLevel(targetLanguage);
        if (!cancelled) setLearnerLevel({ ready: true, summary: estimate?.summary });
      } catch {
        if (!cancelled) setLearnerLevel({ ready: true });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, targetLanguage]);

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
      transcriptionStartedAtRef.current = Date.now();
      setTranscriptionSeconds(0);
      transcriptionTimerRef.current = window.setInterval(() => {
        const startedAt = transcriptionStartedAtRef.current;
        if (startedAt !== null) setTranscriptionSeconds(Math.max(0, Math.ceil((Date.now() - startedAt) / 1000)));
      }, 250);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (transcriptionTimerRef.current !== null) window.clearInterval(transcriptionTimerRef.current);
      transcriptionTimerRef.current = null;
      if (transcriptionStartedAtRef.current !== null) {
        setTranscriptionSeconds(Math.max(0, Math.ceil((Date.now() - transcriptionStartedAtRef.current) / 1000)));
      }
      transcriptionStartedAtRef.current = null;
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
    if (!isOpen || isHistoryLoading || !learnerLevel.ready) return;
    const initialKey = `${mode}:${selectedText}:${sentence}`;
    if (messages.length > 0 || initialSentRef.current === initialKey) return;
    initialSentRef.current = initialKey;
    void sendInitialPromptRef.current();
  }, [isOpen, mode, selectedText, sentence, messages.length, isHistoryLoading, learnerLevel.ready]);

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
        learnerLevel: learnerLevel.summary,
        wordProfile,
        homeworkContext,
        history: [],
        message: INITIAL_DISCUSS_REQUEST,
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
        learnerLevel: learnerLevel.summary,
        wordProfile,
        homeworkContext,
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
  }, [isSending, quotedText, messages, onMessagesChange, mode, selectedText, sentence, sentenceBefore, sentenceAfter, nativeLanguage, targetLanguage, learnerLevel.summary, wordProfile, homeworkContext]);

  // Keep ref updated to prevent SpeechRecognition from getting stale values
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const lastModelMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "model"),
    [messages],
  );

  // The chips follow the answer: the model writes the three questions this
  // learner would plausibly ask next about this item. The fixed list is only
  // the opening hand, before there is anything to follow up on.
  const currentPrompts = lastModelMessage?.suggestions?.length
    ? lastModelMessage.suggestions
    : BASE_QUICK_PROMPTS[mode];

  // Buttons into the app's own tables. Whatever the model offered, plus a
  // standing one for the selected word — the forms are always one tap away,
  // whether or not the answer happened to mention them.
  const actions = useMemo(() => {
    const fromModel = lastModelMessage?.actions ?? [];
    const standing: DiscussAction[] =
      mode === "word" && selectedText.trim()
        ? [{ kind: "forms", label: FORMS_ACTION_LABEL, word: selectedText.trim() }]
        : [];
    const seen = new Set<string>();
    return [...fromModel, ...standing].filter((action) => {
      const key = action.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [lastModelMessage, mode, selectedText]);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current || isSending) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setInput("");
      interimRef.current = "";
      recognitionRef.current.start();
    }
  }, [isSending, isListening]);

  const handleAction = useCallback((action: DiscussAction) => {
    if (action.kind === "word") {
      onWordTap(action.word, sentence || selectedText);
      return;
    }
    setGrammarFor({ word: action.word, posTag: ACTION_POS[action.kind] });
  }, [onWordTap, sentence, selectedText]);

  // ── The keypad, here too ────────────────────────────────────────────────
  //
  // The discussion is opened from the keypad mid-session; having to find the
  // mouse to press the microphone is exactly the break in the flow the
  // shortcuts exist to remove. The layout follows what is on screen: the three
  // follow-up questions the model offered are 1–3, the grammar tables are 4,
  // the microphone is 5 — the key that speaks a card — and 9 closes.
  //
  // Bound whenever the modal is open, and stepped over while the learner is
  // typing their own question into the field.
  useEffect(() => {
    if (!isOpen) return;
    // A grammar table opened on top of the discussion owns the screen; the
    // digits under it would otherwise fire the chips it is covering.
    if (grammarFor) return;

    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const action = discussHotkey(event);
      if (!action) return;

      switch (action.kind) {
        case "suggestion": {
          const prompt = currentPrompts[action.index];
          if (!prompt || isSending) return;
          void sendMessage(prompt);
          break;
        }
        case "forms": {
          // The grammar tables under the answer, in the order they are shown;
          // «Формы слова» for the word being discussed is always among them.
          const target = actions[0];
          if (!target) return;
          handleAction(target);
          break;
        }
        case "mic":
          toggleListening();
          break;
        case "close":
          onClose();
          break;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, grammarFor, onClose, currentPrompts, actions, isSending, sendMessage, handleAction, toggleListening]);

  if (!isOpen) return null;

  function handleQuoteFromBubble(text: string) {
    if (latestSelectionRef.current) {
      setQuotedText(latestSelectionRef.current);
      // Clear the ref once consumed
      latestSelectionRef.current = "";
    } else {
      setQuotedText(text);
    }
  }

  return (
    <div className="modal-backdrop discuss-backdrop" onClick={onClose}>
      <section className="discuss-modal" role="dialog" aria-modal aria-label={DISCUSS_LABEL} onClick={(e) => e.stopPropagation()}>
        <header className="discuss-header">
          <div>
            <span>{DISCUSS_LABEL}</span>
            <strong>{MODE_LABEL[mode]}: {selectedText}</strong>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label={CLOSE_LABEL} title={`${CLOSE_LABEL} — клавиша 9`}>
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
          {actions.length > 0 && (
            <div className="discuss-actions">
              {actions.map((action, index) => (
                <button
                  key={`${action.kind}:${action.word}`}
                  type="button"
                  onClick={() => handleAction(action)}
                  title={index === 0 ? `${action.label} — клавиша 4` : action.label}
                >
                  {/* The key that presses it, where there is a keyboard to
                      press it with. */}
                  {index === 0 && <kbd className="discuss-key">4</kbd>}
                  <Table2 size={12} />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="discuss-quick-prompts">
            {currentPrompts.map((prompt, index) => (
              <button
                key={prompt}
                type="button"
                disabled={isSending}
                onClick={() => void sendMessage(prompt)}
                title={index < 3 ? `${prompt} — клавиша ${index + 1}` : prompt}
              >
                {index < 3 && <kbd className="discuss-key">{index + 1}</kbd>}
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
            <button
              type="button"
              className={isListening ? "listening" : ""}
              onClick={toggleListening}
              disabled={isSending}
              aria-label={VOICE_INPUT_LABEL}
              title={`${VOICE_INPUT_LABEL} — клавиша 5`}
            >
              <Mic size={17} />
            </button>
          )}
          <button type="submit" disabled={!input.trim() || isSending} aria-label={SEND_LABEL}>
            <Send size={17} />
          </button>
          <small className="discuss-transcription-cost" aria-label="Примерная стоимость транскрибации">
            Gemini Transcribe {transcriptionSeconds} с: ~${((transcriptionSeconds / 60) * GEMINI_TRANSCRIBE_USD_PER_MINUTE).toFixed(4)}
          </small>
        </form>
      </section>

      {/* The same conjugation/declension tables the word modal opens, reachable
          without leaving the discussion. */}
      {grammarFor && (
        <GrammarModal
          key={`${grammarFor.posTag}:${grammarFor.word}`}
          word={grammarFor.word}
          posTag={grammarFor.posTag}
          defaultLang={targetLanguage}
          nativeLang={nativeLanguage}
          onClose={() => setGrammarFor(null)}
        />
      )}
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
      <span className="discuss-learning-content">
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
      {onAddExample && part.translation && (
        <button
          type="button"
          className="discuss-add-example-btn"
          aria-label="Добавить в карточки"
          title="Добавить в карточки"
          onClick={() => onAddExample(part.text, part.translation ?? "")}
        >
          <Plus size={18} />
        </button>
      )}
    </span>
  );
}
