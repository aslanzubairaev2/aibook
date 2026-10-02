"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import type { Flashcard } from "@/lib/types";
import type { CardVerifyClarification, CardVerifyDictionaryEntry } from "@/lib/ai/cardVerify";
import { verifyCard } from "@/lib/ai/verifyCard";

type Props = {
  card: Flashcard;
  /** The dictionary row the card came from, when the app has one. */
  entry: CardVerifyDictionaryEntry | null;
  targetLanguage: string;
  nativeLanguage: string;
  /** Saves the corrected card. Returns a message when it cannot be saved. */
  onApply: (front: string, back: string) => string | null;
  onClose: () => void;
};

type Phase =
  | { kind: "checking" }
  | { kind: "question"; question: string }
  | { kind: "ok"; note: string }
  | { kind: "fixed"; front: string; back: string; changes: string[]; note: string }
  | { kind: "error"; message: string };

/**
 * Проверка и исправление одной карточки.
 *
 * Модальное окно блокирует всё остальное, пока идёт проверка: пока ИИ решает,
 * что значит карточка, тренировка не должна двигаться, а карточка — меняться
 * под руками. Когда ИИ не уверен, он спрашивает; «Отменить» отменяет всю
 * правку целиком — карточка остаётся как была.
 */
export function CardFixModal({ card, entry, targetLanguage, nativeLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [answer, setAnswer] = useState("");
  const clarifications = useRef<CardVerifyClarification[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const cardRef = useRef(card);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const current = cardRef.current;
      const result = await verifyCard({
        card: {
          type: current.type,
          front: current.front,
          back: current.back,
          cefr: current.cefr ?? "",
          source: current.sourceBookTitle || current.source || "",
        },
        entry,
        clarifications: clarifications.current,
        targetLanguage,
        nativeLanguage,
      }, controller.signal);
      if (controller.signal.aborted) return;

      if (result.verdict === "question") {
        setAnswer("");
        setPhase({ kind: "question", question: result.question });
      } else if (result.verdict === "ok") {
        setPhase({ kind: "ok", note: result.note });
      } else {
        const failure = onApply(result.front, result.back);
        setPhase(failure
          ? { kind: "error", message: failure }
          : { kind: "fixed", front: result.front, back: result.back, changes: result.changes, note: result.note });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Не удалось проверить карточку." });
    }
  }, [entry, nativeLanguage, onApply, targetLanguage]);

  // The check starts once, when the modal opens. State is only set after the
  // request resolves, never synchronously here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Another round: back to «checking», then ask again with what is known now. */
  const recheck = useCallback(() => {
    setPhase({ kind: "checking" });
    void run();
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); cancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel]);

  function submitAnswer(event: React.FormEvent) {
    event.preventDefault();
    if (phase.kind !== "question" || !answer.trim()) return;
    clarifications.current = [...clarifications.current, { question: phase.question, answer: answer.trim() }];
    recheck();
  }

  const finished = phase.kind === "ok" || phase.kind === "fixed" || phase.kind === "error";

  return (
    <div className="card-fix-backdrop" role="presentation">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="card-fix-modal" role="dialog" aria-modal="true" aria-label="Проверка карточки">
        <div className="card-fix-head">
          <ShieldCheck size={18} />
          <h2>Проверка карточки</h2>
        </div>

        <div className="card-fix-card">
          <strong>{card.front}</strong>
          <span>{card.back}</span>
        </div>

        {phase.kind === "checking" && (
          <div className="card-fix-status" role="status">
            <Loader2 size={18} className="spin" />
            <span>ИИ проверяет перевод, артикль и значение слова…</span>
          </div>
        )}

        {phase.kind === "question" && (
          <form className="card-fix-question" onSubmit={submitAnswer}>
            <div className="card-fix-ask">
              <MessageCircleQuestion size={18} />
              <p>{phase.question}</p>
            </div>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitAnswer(event);
              }}
              placeholder="Ваш ответ"
              rows={3}
              maxLength={1000}
              autoFocus
            />
            <div className="card-fix-actions">
              <button type="button" className="card-fix-btn" onClick={cancel}>Отменить</button>
              <button type="submit" className="card-fix-btn primary" disabled={!answer.trim()}>Отправить</button>
            </div>
          </form>
        )}

        {phase.kind === "ok" && (
          <div className="card-fix-result">
            <p className="card-fix-verdict ok"><Check size={16} /> Карточка в порядке, исправлять нечего.</p>
            {phase.note && <p className="card-fix-note">{phase.note}</p>}
          </div>
        )}

        {phase.kind === "fixed" && (
          <div className="card-fix-result">
            <p className="card-fix-verdict ok"><Check size={16} /> Карточка исправлена.</p>
            {phase.changes.length > 0 && (
              <ul className="card-fix-changes">
                {phase.changes.map((change, i) => <li key={i}>{change}</li>)}
              </ul>
            )}
            <div className="card-fix-after">
              <strong>{phase.front}</strong>
              <span>{phase.back}</span>
            </div>
            {phase.note && <p className="card-fix-note">{phase.note}</p>}
          </div>
        )}

        {phase.kind === "error" && (
          <div className="card-fix-result">
            <p className="card-fix-verdict bad"><AlertCircle size={16} /> {phase.message}</p>
            <p className="card-fix-note">Карточка не изменена.</p>
          </div>
        )}

        {phase.kind === "checking" && (
          <div className="card-fix-actions">
            <button type="button" className="card-fix-btn" onClick={cancel}>Отменить</button>
          </div>
        )}

        {finished && (
          <div className="card-fix-actions">
            {phase.kind === "error" && (
              <button type="button" className="card-fix-btn" onClick={recheck}>Повторить</button>
            )}
            <button type="button" className="card-fix-btn primary" onClick={onClose} autoFocus>Готово</button>
          </div>
        )}
      </div>
    </div>
  );
}

const STYLES = `
  .card-fix-backdrop { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,0.72); }
  .card-fix-modal { width: min(100%, 460px); max-height: calc(100dvh - 32px); overflow-y: auto; display: grid; gap: 14px; padding: 20px; border: 1px solid var(--border-strong); border-radius: 16px; background: var(--bg-secondary); color: var(--text-primary); box-shadow: 0 18px 60px rgba(0,0,0,0.5); }
  .card-fix-head { display: flex; align-items: center; gap: 8px; color: var(--accent); }
  .card-fix-head h2 { margin: 0; font-size: 17px; color: var(--text-primary); }
  .card-fix-card, .card-fix-after { display: grid; gap: 4px; padding: 11px 13px; border: 1px solid var(--border); border-radius: 10px; background: rgba(240,230,211,0.04); }
  .card-fix-card strong, .card-fix-after strong { font-size: 16px; color: var(--accent); }
  .card-fix-card span, .card-fix-after span { font-size: 13px; color: var(--text-muted); white-space: pre-line; }
  .card-fix-status { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--text-muted); }
  .card-fix-question { display: grid; gap: 12px; }
  .card-fix-ask { display: flex; gap: 10px; align-items: flex-start; color: var(--accent); }
  .card-fix-ask p { margin: 0; font-size: 15px; line-height: 1.45; color: var(--text-primary); }
  .card-fix-question textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--border); border-radius: 9px; padding: 10px 11px; background: rgba(240,230,211,0.04); color: var(--text-primary); font: inherit; font-size: 14px; }
  .card-fix-result { display: grid; gap: 10px; }
  .card-fix-verdict { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 14px; font-weight: 700; }
  .card-fix-verdict.ok { color: #8bbf7a; }
  .card-fix-verdict.bad { color: #e08a8a; }
  .card-fix-note { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-muted); }
  .card-fix-changes { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; line-height: 1.4; }
  .card-fix-actions { display: flex; justify-content: flex-end; gap: 10px; }
  .card-fix-btn { min-height: 40px; padding: 0 18px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--bg-card); color: var(--text-primary); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
  .card-fix-btn:hover:not(:disabled) { border-color: var(--accent); }
  .card-fix-btn.primary { background: var(--accent); border-color: var(--accent); color: #1a1710; }
  .card-fix-btn:disabled { opacity: 0.5; cursor: default; }
`;
