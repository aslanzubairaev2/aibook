import { useState, useEffect } from "react";
import { Download, BookOpen, X, MessageSquare, Loader2, Info } from "lucide-react";
import type { Book } from "@/lib/types";
import { aiChat } from "@/lib/ai/chat";

// Let's assume we pass the GutendexBook
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
  onClose: () => void;
  onDownload: () => void;
  onOpen: () => void;
};

export function BookDetailModal({ book, coverUrl, coverColor, inLibrary, isDownloading, onClose, onDownload, onOpen }: Props) {
  const [review, setReview] = useState<string | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  
  // Chat state
  const [messages, setMessages] = useState<{role: "user"|"ai", text: string}[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    async function loadReview() {
      setIsLoadingReview(true);
      try {
        const prompt = `Расскажи кратко и без спойлеров о книге "${book.title}" автора ${book.authors?.[0]?.name || "Неизвестен"}. Также укажи примерный уровень сложности (A1-C2) для изучающих язык.`;
        const result = await aiChat(prompt);
        setReview(result || "Не удалось получить рецензию.");
      } catch (err) {
        setReview("Ошибка при генерации рецензии.");
      } finally {
        setIsLoadingReview(false);
      }
    }
    void loadReview();
  }, [book]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const userText = input;
    setMessages(prev => [...prev, { role: "user", text: userText }]);
    setInput("");
    setIsSending(true);

    try {
      const context = `Мы обсуждаем книгу "${book.title}". Отвечай кратко и по делу.\n\nПользователь: ${userText}`;
      const response = await aiChat(context);
      setMessages(prev => [...prev, { role: "ai", text: response || "Ошибка ответа." }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "ai", text: "Ошибка при обращении к ИИ." }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(10, 10, 10, 0.8)", backdropFilter: "blur(4px)",
      display: "flex", flexDirection: "column", justifyContent: "flex-end"
    }}>
      <div style={{
        background: "var(--bg-elevated)", width: "100%", height: "90vh",
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        display: "flex", flexDirection: "column",
        boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
        overflow: "hidden"
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>О книге</h2>
          <button onClick={onClose} className="icon-btn"><X size={24} /></button>
        </div>

        <div style={{ flexGrow: 1, overflowY: "auto", padding: 20 }}>
          {/* Main Info */}
          <div style={{ display: "flex", gap: 20, marginBottom: 24 }}>
            <div style={{
              width: 120, height: 180, borderRadius: 12, flexShrink: 0,
              backgroundImage: coverUrl ? `url(${coverUrl})` : "none",
              backgroundColor: coverColor,
              backgroundSize: "cover", backgroundPosition: "center",
              boxShadow: "0 8px 16px rgba(0,0,0,0.2)"
            }} />
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h1 style={{ fontSize: 22, marginBottom: 8 }}>{book.title}</h1>
              <p style={{ fontSize: 16, color: "var(--text-secondary)", marginBottom: 16 }}>{book.authors?.[0]?.name}</p>
              
              {inLibrary ? (
                <button className="pill-btn" onClick={onOpen} style={{ background: "var(--bg-secondary)", alignSelf: "flex-start" }}>
                  <BookOpen size={16} /> Читать
                </button>
              ) : (
                <button className="pill-btn" onClick={onDownload} disabled={isDownloading} style={{ alignSelf: "flex-start" }}>
                  {isDownloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />} 
                  {isDownloading ? "Загрузка..." : "В библиотеку"}
                </button>
              )}
            </div>
          </div>

          {/* AI Review */}
          <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: 20, marginBottom: 24, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--accent)" }}>
              <Info size={20} />
              <strong style={{ fontSize: 16 }}>AI Рецензия</strong>
            </div>
            {isLoadingReview ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}>
                <Loader2 size={16} className="spin" /> <span>ИИ пишет рецензию...</span>
              </div>
            ) : (
              <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--text)" }}>{review}</p>
            )}
          </div>

          {/* Chat */}
          <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: 20, border: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 300 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: "var(--green)" }}>
              <MessageSquare size={20} />
              <strong style={{ fontSize: 16 }}>Спросить ИИ о книге</strong>
            </div>
            
            <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 12, marginBottom: 16, maxHeight: 250, overflowY: "auto" }}>
              {messages.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", marginTop: 20 }}>
                  Задайте вопрос: например, "Сложный ли тут английский?" или "О чем сюжет?"
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ 
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  background: m.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                  color: m.role === "user" ? "#000" : "var(--text)",
                  padding: "10px 14px", borderRadius: 16, maxWidth: "80%",
                  fontSize: 14, lineHeight: 1.4
                }}>
                  {m.text}
                </div>
              ))}
              {isSending && (
                <div style={{ alignSelf: "flex-start", color: "var(--text-muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <Loader2 size={12} className="spin" /> ИИ печатает...
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input 
                type="text" 
                value={input} 
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="Ваш вопрос..."
                style={{ flexGrow: 1, padding: "12px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text)", outline: "none" }}
              />
              <button onClick={handleSend} disabled={!input.trim() || isSending} className="pill-btn" style={{ padding: "0 20px" }}>
                Отправить
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
