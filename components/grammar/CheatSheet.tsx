"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { FAMILIES, determiner, fold, type Case, type Family, type Gender } from "@/lib/grammar/common";
import { COMBOS } from "@/lib/grammar/verbPrepositions";
import type { TrainerId } from "@/lib/grammar/task";

const CASES: Case[] = ["nom", "acc", "dat"];
const CASE_SHORT: Record<Case, string> = { nom: "Nom", acc: "Akk", dat: "Dat" };
const GENDERS: Gender[] = ["m", "f", "n", "pl"];
const GENDER_HEAD: Record<Gender, string> = { m: "муж.", f: "жен.", n: "ср.", pl: "мн."};

/**
 * The reference card, over the task — the task stays exactly where it was.
 * Opening it before answering is fine; the answer is then recorded as given
 * with help, apart from independent ones.
 */
export function CheatSheet({ trainer, onClose }: { trainer: TrainerId; onClose: () => void }) {
  return (
    <div className="gr-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Шпаргалка" onClick={onClose}>
      <div className="gr-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="gr-sheet-header">
          <strong>Шпаргалка · {trainer === "verb_prepositions" ? "глаголы и предлоги" : "артикли и падежи"}</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть шпаргалку" autoFocus><X size={18} /></button>
        </header>
        <div className="gr-sheet-body">
          {trainer === "verb_prepositions" ? <VerbSheet /> : <ArticleSheet />}
        </div>
      </div>
    </div>
  );
}

function VerbSheet() {
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const matches = useMemo(() => COMBOS.filter((c) => !q || fold(c.label).includes(q) || fold(c.meaning).includes(q) || fold(c.prep ?? "без предлога").includes(q)), [q]);
  const withPrep = matches.filter((c) => c.prep);
  const without = matches.filter((c) => !c.prep);
  return (
    <>
      <label className="gr-search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Глагол или предлог: warten, auf, mit…" aria-label="Поиск по глаголу и предлогу" autoCapitalize="none" spellCheck={false} />
      </label>
      <p className="gr-sheet-note">
        Предлог после глагола — часть самого глагола, его учат вместе: <b>warten auf + Akk</b>. Это не «куда?» — никто
        никуда не движется. Русский предлог не подсказывает немецкий: «думать <i>о</i>» — denken <b>an</b>, «заботиться <i>о</i>» — sich kümmern <b>um</b>.
      </p>
      <p className="gr-sheet-note">
        Один глагол — разные значения: <b>sprechen mit</b> — <i>с кем</i> говорят; <b>sprechen über</b> — <i>о чём</i> говорят.
        <b> fragen</b> — кого спрашивают; <b>fragen nach</b> — о чём спрашивают. <b>sich freuen auf</b> — тому, что будет; <b>über</b> — тому, что уже есть.
      </p>
      {withPrep.length > 0 && <h3 className="gr-sheet-h">С предлогом</h3>}
      <ul className="gr-combos">
        {withPrep.map((c) => (
          <li key={c.id}>
            <div className="gr-combo-head"><b>{c.label}</b> <span className={`gr-case ${c.case}`}>{c.case === "dat" ? "Dativ" : "Akkusativ"}</span> <small>{c.level}</small></div>
            <span>{c.meaning}</span>
            {c.examples.slice(0, 2).map((e) => <em key={e.de}>{e.de} — {e.ru}</em>)}
          </li>
        ))}
      </ul>
      {without.length > 0 && <h3 className="gr-sheet-h">Без предлога</h3>}
      <ul className="gr-combos">
        {without.map((c) => (
          <li key={c.id}>
            <div className="gr-combo-head"><b>{c.label}</b> <span className={`gr-case ${c.case}`}>{c.case === "dat" ? "Dativ" : "Akkusativ"}</span></div>
            <span>{c.meaning}</span>
            {c.examples.slice(0, 1).map((e) => <em key={e.de}>{e.de} — {e.ru}</em>)}
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="gr-sheet-note">Ничего не найдено.</p>}
      <h3 className="gr-sheet-h">Местоимения после предлога</h3>
      <table className="gr-table">
        <thead><tr><th /><th>ich</th><th>du</th><th>er</th><th>sie</th><th>wir</th><th>ihr</th><th>sie/Sie</th></tr></thead>
        <tbody>
          <tr><th>Akk</th><td>mich</td><td>dich</td><td>ihn</td><td>sie</td><td>uns</td><td>euch</td><td>sie / Sie</td></tr>
          <tr><th>Dat</th><td>mir</td><td>dir</td><td>ihm</td><td>ihr</td><td>uns</td><td>euch</td><td>ihnen / Ihnen</td></tr>
        </tbody>
      </table>
    </>
  );
}

function DeterminerTable({ family, title }: { family: Family; title: string }) {
  return (
    <div className="gr-table-wrap">
      <h4>{title}</h4>
      <table className="gr-table">
        <thead><tr><th />{GENDERS.map((g) => <th key={g}>{GENDER_HEAD[g]}</th>)}</tr></thead>
        <tbody>
          {CASES.map((c) => (
            <tr key={c}><th>{CASE_SHORT[c]}</th>{GENDERS.map((g) => <td key={g}>{determiner(family, g, c) ?? "—"}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArticleSheet() {
  const possessives = FAMILIES.filter((f) => f !== "der" && f !== "ein" && f !== "kein");
  return (
    <>
      <p className="gr-sheet-note">
        Падеж показывает <b>роль</b> слова, а не его место: <b>Den Schlüssel</b> sucht mein Bruder — ключ стоит первым, но его ищут: Akkusativ.
      </p>
      <ul className="gr-rules">
        <li><b>Nominativ</b> — кто? что? Подлежащее и после sein: <i>Der Drucker ist kaputt. Das ist mein Tisch.</i></li>
        <li><b>Akkusativ</b> — кого? что? Прямое дополнение: <i>Ich brauche einen Drucker. Ich suche meinen Schlüssel.</i> Меняется только мужской род: der → den, ein → einen.</li>
        <li><b>Dativ</b> — кому? и после mit, bei, zu (всегда): <i>Ich fahre mit dem Bus. Ich bin beim Arzt. Ich gehe zur Post.</i></li>
      </ul>
      <div className="gr-tables">
        <DeterminerTable family="der" title="Определённый: der" />
        <DeterminerTable family="ein" title="Неопределённый: ein" />
        <DeterminerTable family="kein" title="Отрицательный: kein" />
        <DeterminerTable family="mein" title="Притяжательный: mein" />
      </div>
      <p className="gr-sheet-note">
        У <b>ein</b> нет множественного числа: ein Buch → Bücher. Отрицание — keine Bücher.
        Притяжательные склоняются как kein: {possessives.join(", ")} (Ihr — вежливое «Ваш»; euer → eure, euren, eurem).
      </p>
      <h3 className="gr-sheet-h">Dativ: mit, bei, zu</h3>
      <ul className="gr-rules">
        <li><b>mit</b> + Dat — с кем / на чём: mit dem Lehrer, mit der Straßenbahn, mit meinen Freunden.</li>
        <li><b>bei</b> + Dat — у кого: bei dem → <b>beim</b> Arzt, bei der Oma, bei meinen Eltern.</li>
        <li><b>zu</b> + Dat — к кому / куда: zu dem → <b>zum</b> Arzt, zu der → <b>zur</b> Post, zu meinen Eltern.</li>
        <li>Dativ мн. числа: к существительному <b>+ n</b> — den Kindern, meinen Freunden (кроме форм на -s и -n: den Autos, den Eltern).</li>
        <li>«Куда?» не делает Akkusativ: после zu всегда Dativ — Ich gehe zum Bahnhof.</li>
      </ul>
    </>
  );
}
