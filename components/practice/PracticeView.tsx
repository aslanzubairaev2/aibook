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

      {/* Те же три плитки, что и на главной: два входа в одни и те же
          тренажёры не должны выглядеть как два разных приложения. */}
      <div className="home-triad">
        <PracticeTile
          tone="words" title="Слова" value={words.total}
          note={words.due > 0 ? `${words.due} на сегодня` : `${words.learned} в памяти`}
          alert={words.due > 0}
          onClick={onOpenCards}
        />
        <PracticeTile
          tone="verbs" title="Глаголы" value={verbs.total}
          note={verbs.missingForms > 0 ? `${verbs.missingForms} без форм` : `${verbs.irregular} неправильных`}
          alert={verbs.missingForms > 0}
          onClick={onOpenVerbs}
        />
        <PracticeTile
          tone="nouns" title="Артикли" value={nouns.total}
          note={nouns.withoutArticle > 0 ? `${nouns.withoutArticle} без артикля` : `${nouns.withArticle} с артиклем`}
          alert={nouns.withoutArticle > 0}
          onClick={onOpenNouns}
        />
      </div>

      <div className="home-more">
        <PracticeEntry
          title="Карточки"
          note="Слова, фразы и предложения — интервальное повторение"
          onClick={onOpenCards}
        />
        <PracticeEntry
          title="Глаголы и времена"
          note="Infinitiv · Präteritum · Partizip II, спряжение по временам"
          onClick={onOpenVerbs}
        />
        <PracticeEntry
          title="Артикли и существительные"
          note="der · die · das, род по окончанию и множественное число"
          onClick={onOpenNouns}
        />
      </div>
    </section>
  );
}

function PracticeTile({
  tone, title, value, note, alert, onClick,
}: { tone: string; title: string; value: number; note: string; alert?: boolean; onClick: () => void }) {
  return (
    <button className={`tile tile--${tone}`} type="button" onClick={onClick}>
      <span className="tile-title">{title}</span>
      <span className="tile-value">{value}</span>
      <span className={`tile-note${alert ? " is-alert" : ""}`}>{note}</span>
    </button>
  );
}

function PracticeEntry({ title, note, onClick }: { title: string; note: string; onClick: () => void }) {
  return (
    <button className="more-row" type="button" onClick={onClick}>
      <span className="more-row-text">
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      <ChevronRight size={15} className="more-row-arrow" />
    </button>
  );
}
