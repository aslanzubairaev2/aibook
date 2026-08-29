"use client";

import { useMemo } from "react";
import { AlertTriangle, X } from "lucide-react";
import { CONFIDENCE_LABEL, GENDER_ARTICLE, GENDER_RULES, type NounGender } from "@/lib/nounForms";
import { getLocalGenderRuleStats } from "@/lib/db/local";

type Props = { onClose: () => void };

const GROUPS: { gender: NounGender; title: string; blurb: string }[] = [
  { gender: "f", title: "die — женский род", blurb: "Самая надёжная группа: по окончанию угадывается почти всегда." },
  { gender: "m", title: "der — мужской род", blurb: "Здесь чаще встречаются исключения, но правила покрывают большинство слов." },
  { gender: "n", title: "das — средний род", blurb: "Уменьшительные, заимствования и слова с приставкой Ge-." },
];

/**
 * The whole suffix table on one screen — the thing the drill is drilling.
 *
 * A quiz alone teaches by collision: you get it wrong, you read one line of
 * explanation, you move on. The cheat sheet is the other half — the map the
 * learner comes back to, with their own weak endings pulled to the top so
 * re-reading it is aimed rather than exhaustive.
 */
export function GenderRulesSheet({ onClose }: Props) {
  // Read once on open: it is a snapshot to study, not a live counter.
  const stats = useMemo(() => getLocalGenderRuleStats(), []);

  // An ending is "weak" once it has been asked a few times and is missed at
  // least a third of the time — below that the sample says nothing.
  const weak = useMemo(() => {
    return GENDER_RULES
      .map((rule) => ({ rule, stat: stats[rule.id] }))
      .filter(({ stat }) => stat && stat.right + stat.wrong >= 3 && stat.wrong / (stat.right + stat.wrong) >= 0.34)
      .sort((a, b) => (b.stat!.wrong / (b.stat!.right + b.stat!.wrong)) - (a.stat!.wrong / (a.stat!.right + a.stat!.wrong)))
      .slice(0, 5);
  }, [stats]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="gender-rules-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Правила родов">
        <header className="gender-rules-head">
          <div>
            <p className="eyebrow">Шпаргалка</p>
            <h2>Род по окончанию</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        {weak.length > 0 && (
          <section className="gender-rules-weak">
            <strong><AlertTriangle size={14} /> Ваши слабые окончания</strong>
            <div className="gender-rules-weak-list">
              {weak.map(({ rule, stat }) => (
                <span key={rule.id} className={`filter-chip gender-${rule.gender}`}>
                  {rule.label} · {stat!.wrong} из {stat!.right + stat!.wrong} мимо
                </span>
              ))}
            </div>
            <p>Эти правила стоит перечитать перед следующей тренировкой.</p>
          </section>
        )}

        {GROUPS.map((group) => (
          <section key={group.gender} className="gender-rules-group">
            <h3 className={`gender-${group.gender}`}>{group.title}</h3>
            <p className="gender-rules-blurb">{group.blurb}</p>
            <ul className="gender-rules-list">
              {GENDER_RULES.filter((r) => r.gender === group.gender).map((rule) => (
                <li key={rule.id} className="gender-rules-item">
                  <div className="gender-rules-item-head">
                    <code className={`gender-${rule.gender}`}>{GENDER_ARTICLE[rule.gender]} …{rule.label.replace(/^-/, "")}</code>
                    <span className={`gender-rules-confidence c-${rule.confidence}`}>{CONFIDENCE_LABEL[rule.confidence]}</span>
                  </div>
                  {rule.family && <span className="gender-rules-family">{rule.family}</span>}
                  <p>{rule.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="gender-rules-footer">
          Правило не заменяет слово: если существительное попало в исключения, тренажёр скажет об этом прямо в разборе.
        </p>
      </div>
    </div>
  );
}
