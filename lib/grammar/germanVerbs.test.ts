import assert from "node:assert/strict";
import { test } from "node:test";
import { conjugateGerman, needsAiBackfill } from "./germanVerbs.ts";

/** Короткая запись ожидания: du · er · Präteritum · Partizip II · aux. */
function forms(word: string) {
  const f = conjugateGerman(word);
  assert.ok(f, `нет форм для «${word}»`);
  return [f.present.ich, f.present.du, f.present.er, f.praeteritum, f.partizip2, f.hilfsverb].join(" ");
}

test("сильные глаголы берутся из таблицы целиком", () => {
  assert.equal(forms("gehen"), "gehe gehst geht ging gegangen sein");
  assert.equal(forms("geben"), "gebe gibst gibt gab gegeben haben");
  assert.equal(forms("lesen"), "lese liest liest las gelesen haben");
  assert.equal(forms("sein"), "bin bist ist war gewesen sein");
  assert.equal(forms("haben"), "habe hast hat hatte gehabt haben");
});

test("модальные глаголы: ich совпадает с er", () => {
  assert.equal(forms("können"), "kann kannst kann konnte gekonnt haben");
  assert.equal(forms("wissen"), "weiß weißt weiß wusste gewusst haben");
});

test("слабые глаголы выводятся правилом", () => {
  assert.equal(forms("machen"), "mache machst macht machte gemacht haben");
  assert.equal(forms("spielen"), "spiele spielst spielt spielte gespielt haben");
});

test("основа на -t/-d получает соединительную -e-", () => {
  assert.equal(forms("arbeiten"), "arbeite arbeitest arbeitet arbeitete gearbeitet haben");
  assert.equal(forms("reden"), "rede redest redet redete geredet haben");
});

test("основа на свистящий: du-форма сливается с er-формой", () => {
  assert.equal(forms("tanzen"), "tanze tanzt tanzt tanzte getanzt haben");
  assert.equal(forms("reisen"), "reise reist reist reiste gereist sein");
});

test("глаголы на -ieren и неотделяемые приставки идут без ge-", () => {
  assert.equal(forms("studieren"), "studiere studierst studiert studierte studiert haben");
  assert.equal(forms("besuchen"), "besuche besuchst besucht besuchte besucht haben");
});

test("-eln теряет -e- в первом лице", () => {
  assert.equal(forms("sammeln"), "sammle sammelst sammelt sammelte gesammelt haben");
});

test("отделяемая приставка уходит в конец, но остаётся в причастии", () => {
  assert.equal(forms("aufstehen"), "stehe auf stehst auf steht auf stand auf aufgestanden haben");
  assert.equal(forms("anrufen"), "rufe an rufst an ruft an rief an angerufen haben");
  assert.equal(forms("mitkommen"), "komme mit kommst mit kommt mit kam mit mitgekommen sein");
});

test("неотделяемая приставка над сильным корнем", () => {
  assert.equal(forms("verstehen"), "verstehe verstehst versteht verstand verstanden haben");
  assert.equal(forms("bekommen"), "bekomme bekommst bekommt bekam bekommen sein");
});

test("не-инфинитивы отклоняются", () => {
  assert.equal(conjugateGerman("Haus"), null);
  assert.equal(conjugateGerman("schnell"), null);
  assert.equal(conjugateGerman(""), null);
});

test("табличные глаголы и их производные не ходят в сеть", () => {
  assert.equal(needsAiBackfill(conjugateGerman("gehen")), false);
  assert.equal(needsAiBackfill(conjugateGerman("aufstehen")), false, "приставочные наследуют таблицу");
  assert.equal(needsAiBackfill(conjugateGerman("verstehen")), false);
});

test("словообразовательно слабые классы не ходят в сеть", () => {
  assert.equal(needsAiBackfill(conjugateGerman("studieren")), false);
  assert.equal(needsAiBackfill(conjugateGerman("sammeln")), false);
  assert.equal(needsAiBackfill(conjugateGerman("wandern")), false);
  assert.equal(needsAiBackfill(conjugateGerman("reinigen")), false);
});

test("неизвестный глагол вне гарантированно слабых классов уточняется у модели", () => {
  // «verdrießen» — редкий сильный глагол, которого в таблице нет: правило дало
  // бы «verdrießte» вместо «verdross», поэтому ответ помечается непроверенным.
  assert.equal(needsAiBackfill(conjugateGerman("verdrießen")), true);
});

test("обычные слабые глаголы показываются сразу, без ожидания сети", () => {
  for (const word of ["machen", "spielen", "lernen", "kaufen", "wohnen", "sagen", "fragen", "zeigen",
                      "arbeiten", "baden", "reichen", "studieren", "sammeln", "wandern",
                      "gehen", "aufstehen", "verstehen"]) {
    assert.equal(conjugateGerman(word)?.provisional, false, `${word} не должен ждать модель`);
  }
});

/**
 * Тот самый тест, ради которого вся конструкция и держится.
 *
 * Утверждение «нет в таблице ⇒ глагол слабый» верно ровно настолько, насколько
 * полон список сильных. Класс закрыт, поэтому полноту можно проверить: ниже —
 * контрольная выборка сильных и неправильных глаголов, каждый со своими
 * настоящими формами. Если какой-то из них выпадет из таблицы, тест покажет
 * это здесь, а не пользователь — в подсказке.
 */
test("таблица сильных глаголов полна на контрольной выборке", () => {
  const REFERENCE: Array<[string, string, string]> = [
    ["gehen", "ging", "gegangen"],
    ["stehen", "stand", "gestanden"],
    ["nehmen", "nahm", "genommen"],
    ["sprechen", "sprach", "gesprochen"],
    ["schreiben", "schrieb", "geschrieben"],
    ["bleiben", "blieb", "geblieben"],
    ["ziehen", "zog", "gezogen"],
    ["fliegen", "flog", "geflogen"],
    ["finden", "fand", "gefunden"],
    ["singen", "sang", "gesungen"],
    ["trinken", "trank", "getrunken"],
    ["werfen", "warf", "geworfen"],
    ["helfen", "half", "geholfen"],
    ["fahren", "fuhr", "gefahren"],
    ["tragen", "trug", "getragen"],
    ["laufen", "lief", "gelaufen"],
    ["rufen", "rief", "gerufen"],
    ["essen", "aß", "gegessen"],
    ["sitzen", "saß", "gesessen"],
    ["liegen", "lag", "gelegen"],
    ["bitten", "bat", "gebeten"],
    ["denken", "dachte", "gedacht"],
    ["bringen", "brachte", "gebracht"],
    ["kennen", "kannte", "gekannt"],
    ["wissen", "wusste", "gewusst"],
    ["werden", "wurde", "geworden"],
  ];

  for (const [inf, praet, part2] of REFERENCE) {
    const f = conjugateGerman(inf);
    assert.ok(f, `«${inf}» вообще не разобрался`);
    assert.equal(f.provisional, false, `«${inf}» — сильный глагол, но помечен как непроверенный`);
    assert.equal(f.praeteritum, praet, `Präteritum «${inf}»`);
    assert.equal(f.partizip2, part2, `Partizip II «${inf}»`);
  }
});

test("сильный глагол вне таблицы не показывает выдуманную форму, а ждёт модель", () => {
  // «verdrießen» в таблице нет: правило дало бы «verdrießte» вместо «verdross».
  // Флаг ловит это по финали -ießen, и UI такие формы не рисует.
  assert.equal(conjugateGerman("verdrießen")?.provisional, true);
});
