import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, Info, Loader2, MessageSquare, Send, X } from "lucide-react";
import { aiChat } from "@/lib/ai/chat";

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string }[];
  languages: string[];
  formats: Record<string, string>;
};

type Props = {
  book: GutendexBook;
  coverUrl: string | null;
  coverColor: string;
  inLibrary: boolean;
  isDownloading: boolean;
  downloadTask?: {
    progress: number;
    status: "downloading" | "parsing" | "saving" | "done" | "error";
    message: string;
  };
  onClose: () => void;
  onDownload: () => void;
  onOpen: () => void;
};

type ChatMessage = {
  role: "user" | "ai";
  text: string;
};

const LANG_NAMES: Record<string, string> = {
  en: "английский",
  de: "немецкий",
  fr: "французский",
  es: "испанский",
  it: "итальянский",
  ru: "русский",
};

function cleanAiText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/^[\s•\-*#]+/gm, "")
    .replace(/[·]{2,}/g, "·")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitReview(value: string | null) {
  if (!value) return [];

  const cleaned = cleanAiText(value);
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length > 1) return lines.slice(0, 4);

  return cleaned
    .split(/(?<=\.)\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function BookDetailModal({
  book,
  coverUrl,
  coverColor,
  inLibrary,
  isDownloading,
  downloadTask,
  onClose,
  onDownload,
  onOpen,
}: Props) {
  const [review, setReview] = useState<string | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const author = book.authors?.[0]?.name || "Неизвестен";
  const language = LANG_NAMES[book.languages?.[0] ?? ""] ?? book.languages?.[0] ?? "не указан";
  const reviewLines = useMemo(() => splitReview(review), [review]);

  useEffect(() => {
    let isActive = true;

    async function loadReview() {
      setIsLoadingReview(true);
      try {
        const prompt = [
          `Книга: "${book.title}", автор: ${author}, язык: ${language}.`,
          "Сделай очень короткую карточку без спойлеров, без markdown и без спецсимволов.",
          "Строго 4 строки:",
          "О чем: одно короткое предложение.",
          "Жанр: 2-4 слова.",
          "Язык: примерный уровень A1-C2 и почему.",
          "Кому: кому подойдет.",
        ].join("\n");
        const result = await aiChat(prompt);
        if (isActive) setReview(result || "О чем: краткое описание недоступно.");
      } catch {
        if (isActive) {
          setReview(
            `О чем: классическая книга для спокойного чтения.\nЖанр: художественная литература.\nЯзык: примерно B1-C1, зависит от издания.\nКому: тем, кто хочет читать больше на ${language}.`,
          );
        }
      } finally {
        if (isActive) setIsLoadingReview(false);
      }
    }

    setReview(null);
    setMessages([]);
    void loadReview();

    return () => {
      isActive = false;
    };
  }, [book.id, book.title, author, language]);

  async function handleSend() {
    const userText = input.trim();
    if (!userText || isSending) return;

    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setInput("");
    setIsSending(true);

    try {
      const prompt = [
        `Мы обсуждаем книгу "${book.title}" автора ${author}.`,
        "Отвечай кратко, понятно, без markdown и без длинных списков.",
        `Вопрос: ${userText}`,
      ].join("\n");
      const response = await aiChat(prompt);
      setMessages((prev) => [...prev, { role: "ai", text: cleanAiText(response || "Не получилось ответить.") }]);
    } catch {
      setMessages((prev) => [...prev, { role: "ai", text: "Не получилось связаться с AI. Попробуйте ещё раз." }]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="book-modal-backdrop">
      <div className="book-modal">
        <div className="book-modal-header">
          <strong>О книге</strong>
          <button onClick={onClose} className="icon-btn modal-close" type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="book-modal-content">
          <div className="book-modal-main">
            <div
              className="book-modal-cover"
              style={
                coverUrl
                  ? { backgroundImage: `url(${coverUrl})` }
                  : { background: coverColor }
              }
            />
            <div className="book-modal-title-block">
              <h1>{book.title}</h1>
              <p>{author}</p>
              <span>{language}</span>
              {inLibrary ? (
                <button className="pill-btn" onClick={onOpen} type="button">
                  <BookOpen size={16} />
                  Читать
                </button>
              ) : (
                <button className="pill-btn" onClick={onDownload} disabled={isDownloading} type="button">
                  {isDownloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                  {isDownloading ? "Загрузка..." : "В библиотеку"}
                </button>
              )}
              {downloadTask && (
                <div className={`book-download-progress ${downloadTask.status}`}>
                  <div>
                    <span>{downloadTask.message}</span>
                    <b>{Math.round(downloadTask.progress)}%</b>
                  </div>
                  <span className="book-download-track">
                    <span style={{ width: `${downloadTask.progress}%` }} />
                  </span>
                </div>
              )}
            </div>
          </div>

          <section className="ai-review-card">
            <div className="compact-section-title">
              <Info size={17} />
              <strong>AI-обзор</strong>
            </div>
            {isLoadingReview ? (
              <div className="compact-loader">
                <Loader2 size={15} className="spin" />
                <span>Пишу кратко...</span>
              </div>
            ) : (
              <dl className="review-list">
                {reviewLines.map((line, index) => {
                  const [label, ...rest] = line.split(":");
                  const text = rest.join(":").trim() || line;
                  const hasLabel = rest.length > 0 && label.length < 18;
                  return (
                    <div key={`${line}-${index}`}>
                      {hasLabel && <dt>{label}</dt>}
                      <dd>{hasLabel ? text : line}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>

          <section className="book-chat-card">
            <div className="compact-section-title chat-title">
              <MessageSquare size={17} />
              <strong>Спросить AI</strong>
            </div>

            <div className="book-chat-messages">
              {messages.length === 0 && (
                <p className="chat-empty">Например: насколько сложный язык или о чем книга без спойлеров?</p>
              )}
              {messages.map((message, index) => (
                <div key={index} className={`chat-bubble ${message.role}`}>
                  {message.text}
                </div>
              ))}
              {isSending && (
                <div className="typing-row">
                  <Loader2 size={12} className="spin" />
                  AI печатает...
                </div>
              )}
            </div>

            <div className="book-chat-input">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSend();
                }}
                placeholder="Короткий вопрос"
              />
              <button onClick={() => void handleSend()} disabled={!input.trim() || isSending} type="button" aria-label="Отправить">
                <Send size={17} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
