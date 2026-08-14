"use client";

import { memo } from "react";
import { getCardSkillState } from "@/lib/db/local";
import type { CardSkillState, ProductiveSkill, SkillProgress } from "@/lib/types";

const TRACKS: { skill: ProductiveSkill; letter: string; title: string }[] = [
  { skill: "recall", letter: "В", title: "Вспоминаю" },
  { skill: "listen", letter: "С", title: "Слушаю" },
  { skill: "produce", letter: "Г", title: "Говорю" },
];

// Maturity → color: untouched (grey) → learning (blue) → confident (green).
function maturityColor(p?: SkillProgress): string {
  if (!p || p.status === "new") return "var(--text-muted)";
  if (p.status === "review" && p.repetitions >= 2) return "var(--green)";
  if (p.status === "relearning") return "#e08888";
  return "var(--blue)";
}

/**
 * `state` is optional so a single badge can still look itself up, but any list
 * should read the whole progress map once and hand each row its slice — a
 * per-row lookup in a 500-card deck is 500 reads of the same store.
 */
export const SkillBadges = memo(function SkillBadges({ cardId, state: provided }: { cardId: string; state?: CardSkillState }) {
  const state = provided ?? getCardSkillState(cardId);
  return (
    <span style={{ display: "inline-flex", gap: 4 }} aria-label="Прогресс продуктивных навыков">
      {TRACKS.map(({ skill, letter, title }) => {
        const color = maturityColor(state[skill]);
        return (
          <span
            key={skill}
            title={title}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              borderRadius: 5,
              fontSize: 10,
              fontWeight: 800,
              color,
              border: `1px solid ${color}`,
              background: `${color}14`,
              lineHeight: 1,
            }}
          >
            {letter}
          </span>
        );
      })}
    </span>
  );
});
