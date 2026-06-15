"use client";

import { getCardSkillState } from "@/lib/db/local";
import type { ProductiveSkill, SkillProgress } from "@/lib/types";

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

export function SkillBadges({ cardId }: { cardId: string }) {
  const state = getCardSkillState(cardId);
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
}
