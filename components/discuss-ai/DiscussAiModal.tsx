"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2, Mic, Square, Send, X, Quote, Plus, Table2, MessageCircle } from "lucide-react";
import { useGeminiDictation } from "@/lib/audio/useGeminiDictation";
import { discussWithAi } from "@/lib/ai/discuss";
import { INITIAL_DISCUSS_REQUEST } from "@/lib/ai/buildDiscussPrompt";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import { loadGrammarContext, saveGrammarPatterns } from "@/lib/ai/grammarContext";
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
  GrammarEncounter,
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
  const appendDictation = useCallback((text: string) => {
    setInput(previous => [previous.trim(), text].filter(Boolean).join(" "));
  }, []);
  const dictation = useGeminiDictation(isOpen, `${selectedText} ${sentence}`, appendDictation);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  // Estimated from books read and deck size, locally — see lib/ai/userLevel.
  // `ready` gates the opening request so the very first answer is already
  // pitched at the right level instead of being generic.
  const [learnerLevel, setLearnerLevel] = useState<{ ready: boolean; summary?: string }>({ ready: false });
  const [grammarFor, setGrammarFor] = useState<{ word: string; posTag: PosTag } | null>(null);
  const grammarContextRef = useRef<GrammarEncounter[]>([]);
  const initialSentRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const latestSelectionRef = useRef("");
  const latestMessagesRef = useRef(messages);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

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
    // Load grammar context synchronously from localStorage.
    grammarContextRef.current = loadGrammarContext(targetLanguage);
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
        grammarContext: grammarContextRef.current,
        history: [],
        message: INITIAL_DISCUSS_REQUEST,
      });
      if (response.grammarPatterns?.length) {
        saveGrammarPatterns(targetLanguage, response.grammarPatterns);
      }
      if (latestMessagesRef.current.length === 0) {
        latestMessagesRef.current = [response];
        onMessagesChange([response]);
      }
    } catch {
      if (latestMessagesRef.current.length === 0) {
        const fallback: DiscussMessage[] = [
          {
            role: "model",
            contentParts: [{ type: "text", text: ERROR_TEXT }],
          },
        ];
        latestMessagesRef.current = fallback;
        onMessagesChange(fallback);
      }
    } finally {
      setIsSending(false);
    }
  }
  sendInitialPromptRef.current = sendInitialPrompt;

  const sendMessage = useCallback(async function sendMessage(messageText: string) {
    const text = messageText.trim();
    if (!text || isSending || dictation.busy) return;

    const previousMessages = latestMessagesRef.current;
    let fullText = text;
    if (quotedText) {
      fullText = `[Цитата: "${quotedText}"] ${text}`;
      setQuotedText(null);
    }

    const userMessage: DiscussMessage = { role: "user", text };
    const history = [...previousMessages, userMessage];
    latestMessagesRef.current = history;
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
        grammarContext: grammarContextRef.current,
        history: previousMessages,
        message: fullText,
      });
      if (response.grammarPatterns?.length) {
        saveGrammarPatterns(targetLanguage, response.grammarPatterns);
      }
      const nextMessages = [...history, response];
      latestMessagesRef.current = nextMessages;
      onMessagesChange(nextMessages);
    } catch {
      const nextMessages: DiscussMessage[] = [
        ...history,
        {
          role: "model",
          contentParts: [{ type: "text", text: ERROR_TEXT }],
        },
      ];
      latestMessagesRef.current = nextMessages;
      onMessagesChange(nextMessages);
    } finally {
      setIsSending(false);
    }
  }, [isSending, dictation.busy, quotedText, onMessagesChange, mode, selectedText, sentence, sentenceBefore, sentenceAfter, nativeLanguage, targetLanguage, learnerLevel.summary, wordProfile, homeworkContext]);

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

  const { supported: dictationSupported, toggle: toggleDictation } = dictation;
  const toggleListening = useCallback(() => {
    if (!isSending && dictationSupported) void toggleDictation();
  }, [isSending, dictationSupported, toggleDictation]);

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
      <section className="discuss-modal" data-word-language={targetLanguage} role="dialog" aria-modal aria-label={DISCUSS_LABEL} onClick={(e) => e.stopPropagation()}>
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
                  onDiscussExample={(text) => {
                    void sendMessage(`Разбери этот пример подробнее: «${text}». Объясни грамматику и дай несколько новых примеров.`);
                  }}
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
                disabled={isSending || dictation.busy}
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
            aria-label={QUESTION_PLACEHOLDER}
            placeholder={dictation.phase === "recording" ? "Записываю…" : QUESTION_PLACEHOLDER}
            disabled={isSending || dictation.busy}
          />
          {dictation.supported && (
            <button
              type="button"
              className={dictation.phase === "recording" ? "listening" : ""}
              onClick={toggleListening}
              disabled={isSending || dictation.phase === "requesting" || dictation.phase === "transcribing"}
              aria-label={dictation.phase === "recording" ? "Остановить запись и распознать" : VOICE_INPUT_LABEL}
              title={`${VOICE_INPUT_LABEL} — клавиша 5`}
            >
              {dictation.phase === "recording" ? <Square size={17} /> : dictation.busy ? <Loader2 size={17} className="spin" /> : <Mic size={17} />}
            </button>
          )}
          <button type="submit" disabled={!input.trim() || isSending || dictation.busy} aria-label={SEND_LABEL}>
            <Send size={17} />
          </button>
          <div className="discuss-dictation-status">
            <span role="status">Gemini Transcribe {Math.ceil(dictation.phase === "recording" ? dictation.seconds : dictation.submittedSeconds)} с: ~${((Math.max(dictation.seconds, dictation.submittedSeconds) / 60) * GEMINI_TRANSCRIBE_USD_PER_MINUTE).toFixed(4)}</span>
            {dictation.busy && <button type="button" onClick={dictation.cancel}>Отмена</button>}
          </div>
          {dictation.error && <div className="discuss-dictation-error" role="alert">{dictation.error}</div>}
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
  onDiscussExample,
}: {
  message: DiscussMessage;
  lang: string;
  onWordTap: (word: string, contextSentence: string) => void;
  onAddExample?: (text: string, translation: string) => void;
  onDiscussExample?: (text: string) => void;
}) {
  if (message.contentParts?.length) {
    return (
      <div className="discuss-content-parts">
        {message.contentParts.map((part, index) => (
          <Part key={`${part.text}-${index}`} part={part} lang={lang} onWordTap={onWordTap} onAddExample={onAddExample} onDiscussExample={onDiscussExample} />
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
  onDiscussExample,
}: {
  part: DiscussContentPart;
  lang: string;
  onWordTap: (word: string, contextSentence: string) => void;
  onAddExample?: (text: string, translation: string) => void;
  onDiscussExample?: (text: string) => void;
}) {
  if (part.type !== "learning") return <span>{part.text}</span>;

  return (
    <span className="discuss-learning-part">
      <span className="discuss-learning-content">
        <span className="discuss-learning-main">
          <span className="discuss-learning-text" data-word-context={part.text}>
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
        </span>
        {part.translation && <span className="discuss-learning-translation">{part.translation}</span>}
      </span>
      <span className="discuss-learning-actions">
          <SpeakButton text={part.text} lang={lang} size={20} />
          {onDiscussExample && (
            <button
              type="button"
              className="discuss-example-btn"
              aria-label="Обсудить пример подробнее"
              title="Обсудить этот пример подробнее"
              onClick={() => onDiscussExample(part.text)}
            >
              <MessageCircle size={20} />
            </button>
          )}

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
