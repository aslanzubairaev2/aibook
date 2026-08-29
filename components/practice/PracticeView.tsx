"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { getCardVariantProgressMap, getLocalNounsDict, getLocalVerbsDict } from "@/lib/db/local";
import { computeHomeStats, mergeDictionaries } from "@/lib/home/homeStats";
import type { Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  profile: UserProfile;
  onOpenCards: () => void;
  onOpenVerbs: () => void;
  onOpenNouns: () => void;
};

/**
 * The one place the app trains anything.
 *
 * Карточки, Глаголы and Существительные are three drills over the same
 * dictionary, so they sit behind one door rather than each taking a slot in a
 * five-slot tab bar.
 *
 * Оформление намеренно то же, что на главной: три одинаковые «плашки» с
 * иконкой, надписью, заголовком, подписью и стрелкой читались как три
 * одинаковых прямоугольника, между которыми нечего выбирать. Строка с
 * конкретным числом — «5 глаголов без форм» — говорит больше, чем плашка.
 *
 * Числа читаются из тех же локальных кэшей, что и на главной: это подсказка о
 * размере материала, а не величина, ради которой стоит ходить в сеть.
 */
export function PracticeView({ cards, profile, onOpenCards, onOpenVerbs, onOpenNouns }: Props) {
  const entries = useState(() =>
    mergeDictionaries(
      getLocalVerbsDict(profile.targetLanguage)?.entries ?? [],
      getLocalNounsDict(profile.targetLanguage)?.entries ?? [],
    ),
  )[0];

  const { words, verbs, nouns } = useMemo(
    () => computeHomeStats(cards, getCardVariantProgressMap(), entries),
    [cards, entries],
  );

  return (
    <section className="screen practice-view">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Практика</p>
          <h1>Что тренируем</h1>
        </div>
      </header>

      <div className="home-rows">
        <PracticeRow
          title="Карточки"
          detail={
            words.total > 0
              ? `${words.total} карточек · ${words.learned} в памяти`
              : "Слова, фразы и предложения"
          }
          badge={words.due > 0 ? String(words.due) : undefined}
          onClick={onOpenCards}
        />
        <PracticeRow
          title="Глаголы и времена"
          detail={
            verbs.total > 0
              ? `${verbs.total} глаголов · неправильных ${verbs.irregular}`
              : "Infinitiv · Präteritum · Partizip II"
          }
          hint={verbs.missingForms > 0 ? `${verbs.missingForms} без форм` : undefined}
          onClick={onOpenVerbs}
        />
        <PracticeRow
          title="Артикли и существительные"
          detail={
            nouns.total > 0
              ? `${nouns.total} существительных · с артиклем ${nouns.withArticle}`
              : "der · die · das и множественное число"
          }
          hint={nouns.withoutArticle > 0 ? `${nouns.withoutArticle} без артикля` : undefined}
          onClick={onOpenNouns}
        />
      </div>
    </section>
  );
}

function PracticeRow({
  title, detail, hint, badge, onClick,
}: { title: string; detail: string; hint?: string; badge?: string; onClick: () => void }) {
  return (
    <button className="home-row" type="button" onClick={onClick}>
      <span className="home-row-text">
        <strong>{title}</strong>
        <small>
          {detail}
          {hint && <em className="home-row-hint"> · {hint}</em>}
        </small>
      </span>
      {badge && <span className="home-row-badge">{badge}</span>}
      <ChevronRight size={15} className="home-row-arrow" />
    </button>
  );
}
