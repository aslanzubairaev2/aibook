"use client";

import { Languages, Loader2, Volume2, X } from "lucide-react";
import { formatChars, formatCost, type AudioCostEstimate, type CostEstimate } from "@/lib/ai/costs";

export type BulkAction = "translate" | "audio";

type Props = {
  action: BulkAction;
  estimate: CostEstimate | AudioCostEstimate;
  /** Paragraphs already cached — those cost nothing and are excluded from the quote. */
  cachedCount: number;
  totalCount: number;
  busy: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Confirmation before spending money on a whole text.
 *
 * Always shown for a large text, always states the size and the price. The
 * price is an estimate from configurable rates (lib/ai/costs.ts) and is marked
 * with "≈" — quoting an exact figure we cannot verify would be worse than
 * quoting an obvious approximation.
 */
export function BulkActionSheet({
  action, estimate, cachedCount, totalCount, busy, progress, error, onConfirm, onClose,
}: Props) {
  const isAudio = action === "audio";
  const minutes = isAudio ? (estimate as AudioCostEstimate).minutes : 0;
  const remaining = totalCount - cachedCount;

  return (
    <div className="bulk-backdrop" onClick={busy ? undefined : onClose}>
      <div className="bulk-sheet" onClick={(e) => e.stopPropagation()}>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />

        <div className="bulk-head">
          <strong>{isAudio ? "Озвучить весь текст" : "Перевести весь текст"}</strong>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        {estimate.isLarge && !busy && (
          <div className="bulk-warn">
            Это большой текст — {formatChars(estimate.chars)}.
            {isAudio ? " Озвучивание займёт время и место." : " Перевод займёт время."}
          </div>
        )}

        <dl className="bulk-facts">
          <div>
            <dt>Объём</dt>
            <dd>{formatChars(estimate.chars)}</dd>
          </div>
          {isAudio && (
            <div>
              <dt>Примерно звучания</dt>
              <dd>{minutes} мин</dd>
            </div>
          )}
          {cachedCount > 0 && (
            <div>
              <dt>Уже готово</dt>
              <dd>{cachedCount} из {totalCount} — бесплатно</dd>
            </div>
          )}
          <div className="bulk-price">
            <dt>Стоимость</dt>
            <dd>{remaining > 0 ? formatCost(estimate) : "бесплатно"}</dd>
          </div>
        </dl>

        <p className="bulk-note">
          Оценка по тарифам из настроек приложения — фактический счёт может отличаться.
          Повторное открытие уже {isAudio ? "озвученного" : "переведённого"} текста бесплатно.
        </p>

        {progress && (
          <div className="bulk-progress">
            <div className="bulk-progress-bar">
              <div style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            <span>{progress.done} из {progress.total}</span>
          </div>
        )}

        {error && <div className="inline-error">{error}</div>}

        <div className="bulk-actions">
          <button type="button" className="mini-btn" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="bulk-go" onClick={onConfirm} disabled={busy}>
            {busy
              ? <><Loader2 className="spin" size={16} />{isAudio ? "Озвучиваю..." : "Перевожу..."}</>
              : <>{isAudio ? <Volume2 size={16} /> : <Languages size={16} />}{isAudio ? "Озвучить" : "Перевести"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

const STYLES = `
  .bulk-backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(10,10,10,0.74);
    backdrop-filter: blur(5px);
  }
  .bulk-sheet {
    width: 100%;
    max-width: 640px;
    padding: 16px 18px max(20px, env(safe-area-inset-bottom));
    border: 1px solid var(--border);
    border-radius: 22px 22px 0 0;
    background: rgba(30,27,22,0.98);
  }
  .bulk-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .bulk-head strong { font-size: 16px; }

  .bulk-warn {
    padding: 9px 11px;
    margin-bottom: 12px;
    border: 1px solid rgba(212,168,71,0.4);
    border-radius: 10px;
    background: rgba(212,168,71,0.1);
    color: var(--accent);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .bulk-facts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .bulk-facts > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .bulk-facts dt { font-size: 12.5px; color: var(--text-muted); }
  .bulk-facts dd { font-size: 14px; font-weight: 600; }
  .bulk-price dd { color: var(--accent); font-size: 17px; font-weight: 800; }

  .bulk-note { font-size: 11.5px; line-height: 1.45; color: var(--text-muted); opacity: 0.85; margin-bottom: 14px; }

  .bulk-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .bulk-progress-bar { flex: 1; height: 6px; border-radius: 999px; background: rgba(240,230,211,0.1); overflow: hidden; }
  .bulk-progress-bar > div { height: 100%; background: var(--accent); transition: width 0.25s; }
  .bulk-progress span { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }

  .bulk-actions { display: flex; justify-content: flex-end; gap: 10px; }
  .bulk-go {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 18px;
    border: 0;
    border-radius: 11px;
    background: var(--accent);
    color: var(--text-dark);
    font-size: 14px;
    font-weight: 700;
  }
  .bulk-go:disabled { opacity: 0.6; }
`;
