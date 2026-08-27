"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { aiChat } from "@/lib/ai/chat";
import { buildHomeworkHintPrompt, type HomeworkHintTurn } from "@/lib/ai/buildHomeworkHintPrompt";

type Props = {
  instruction: string;
  itemText: string;
  bank?: string[];
  nativeLanguage: string;
  onClose: () => void;
};

/**
 * "Обсудить" for one homework item — explains the task and the rule behind
 * it, never the answer. The no-spoiler rule lives entirely in the prompt
 * (buildHomeworkHintPrompt); there is no answer key here to check the reply
 * against, so a model that ignores the rule would still leak — worth
 * re-checking against real exercises before trusting this blindly.
 */
export function HomeworkHelpPanel({ instruction, itemText, bank, nativeLanguage, onClose }: Props) {
  const [history, setHistory] = useState<HomeworkHintTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const ask = async (learnerText: string | null) => {
    setLoading(true);
    setError(null);
    const withLearnerTurn = learnerText ? [...history, { role: "learner" as const, text: learnerText }] : history;
    if (learnerText) setHistory(withLearnerTurn);
    try {
      const prompt = buildHomeworkHintPrompt({
        instruction, itemText, bank, nativeLanguage, history: withLearnerTurn,
      });
      const reply = await aiChat(prompt);
      setHistory((prev) => [...prev, { role: "tutor", text: reply.trim() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить объяснение.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void ask(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const text = question.trim();
    if (!text || loading) return;
    setQuestion("");
    void ask(text);
  };

  return (
    <div className="hw-popup-backdrop" onClick={onClose}>
      <div className="hw-help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="hw-popup-header">
          <span>Помощь ИИ</span>
          <button type="button" className="hw-popup-close" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="hw-help-messages">
          {history.map((turn, i) => (
            <p key={i} className={`hw-help-msg hw-help-${turn.role}`}>{turn.text}</p>
          ))}
          {loading && <div className="hw-help-loading"><Loader2 className="spin" size={16} />Думаю...</div>}
          {error && <p className="hw-help-error">{error}</p>}
        </div>
        <div className="hw-help-input-row">
          <input
            type="text"
            placeholder="Уточняющий вопрос — не ответ, а объяснение"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            disabled={loading}
          />
          <button type="button" onClick={submit} disabled={loading || !question.trim()} aria-label="Спросить">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
