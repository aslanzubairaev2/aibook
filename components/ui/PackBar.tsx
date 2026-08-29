"use client";

import type { PackCoverage } from "@/lib/srs/packProgress";

/**
 * How far a pack has been worked through, as one bar.
 *
 * Two tones on purpose: solid for words answered correctly, dim for words that
 * came up and were missed. "8 из 12 верно, ещё 3 знаю плохо" is the answer to
 * «сколько осталось» — a single bar would report the same 8 whether the rest
 * was untouched or half-learned.
 */
export function PackBar({ coverage }: { coverage: PackCoverage }) {
  if (coverage.total === 0) return null;

  return (
    <div
      className="dict-batch-bar-wrap pack-bar"
      role="img"
      aria-label={`Пройдено ${coverage.learned} из ${coverage.total}${coverage.seen ? `, с ошибками ${coverage.seen}` : ""}`}
    >
      <div className="pack-bar-seen" style={{ width: `${coverage.touchedPercent}%` }} />
      <div className="dict-batch-bar pack-bar-learned" style={{ width: `${coverage.percent}%` }} />
    </div>
  );
}
