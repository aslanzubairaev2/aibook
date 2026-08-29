// Немецкая морфология глагола — локально, без обращения к модели.
//
// Быстрое превью формы глагола должно появляться под пальцем мгновенно, а
// самый быстрый сетевой вызов — это тот, которого нет. Настоящее время и
// Partizip II слабых глаголов выводятся правилами детерминированно, а сильные
// и неправильные глаголы немецкого — закрытый список: он лежит здесь целиком.
//
// Про доверие к этим формам. Ошибиться модуль может ровно одним способом:
// глагол сильный, но его нет в таблице — тогда правило выдаст «gehte» вместо
// «ging». Такой ответ помечается `provisional: true`, и UI его не показывает,
// а ждёт `/api/ai/quick-word`. Всё остальное здесь либо выписано в таблице
// вручную и покрыто тестами, либо выведено правилом, у которого в немецком
// нет исключений (слабое спряжение, -ieren / -eln / -ern / -igen).

/** Насколько можно доверять формам: из таблицы или выведены правилом. */
export type FormSource = "table" | "rule";

export type GermanVerbForms = {
  /** Инфинитив в том виде, в каком его показывать. */
  infinitive: string;
  /** Präsens, единственное число — то, что учат первым. */
  present: { ich: string; du: string; er: string };
  /** Präteritum, 3 л. ед. ч. («ging», у отделяемых — «stand auf»). */
  praeteritum: string;
  partizip2: string;
  /** «haben» / «sein» — вспомогательный для Perfekt. */
  hilfsverb: "haben" | "sein";
  /** Отделяемая приставка, если она есть («auf» у «aufstehen»). */
  separablePrefix: string | null;
  irregular: boolean;
  source: FormSource;
  /**
   * Формы выведены правилом для глагола, который может оказаться сильным.
   *
   * Единственный способ ошибиться в этом модуле — не найти сильный глагол в
   * таблице и просклонять его как слабый. Такие ответы помечаются, и UI их не
   * показывает вовсе: лучше полсекунды ожидания, чем заученное «gehte».
   *
   * Обычные слабые глаголы сюда НЕ попадают — см. `STRONG_LIKE_RIMES`.
   */
  provisional: boolean;
};

// ─── Таблица сильных и неправильных глаголов ────────────────────────────────
//
// Формат строки: инфинитив | du | er/sie/es | Präteritum 3sg | Partizip II | aux
//
// Формы выписаны явно, а не выводятся из er-формы: «liest» → «liest», но
// «gibt» → «gibst», и любое общее правило здесь ошибается на десятках слов.

const STRONG_ROWS = [
  "sein|bist|ist|war|gewesen|sein",
  "haben|hast|hat|hatte|gehabt|haben",
  "werden|wirst|wird|wurde|geworden|sein",
  "können|kannst|kann|konnte|gekonnt|haben",
  "müssen|musst|muss|musste|gemusst|haben",
  "wollen|willst|will|wollte|gewollt|haben",
  "sollen|sollst|soll|sollte|gesollt|haben",
  "dürfen|darfst|darf|durfte|gedurft|haben",
  "mögen|magst|mag|mochte|gemocht|haben",
  "wissen|weißt|weiß|wusste|gewusst|haben",
  "tun|tust|tut|tat|getan|haben",
  "gehen|gehst|geht|ging|gegangen|sein",
  "stehen|stehst|steht|stand|gestanden|haben",
  "sehen|siehst|sieht|sah|gesehen|haben",
  "geben|gibst|gibt|gab|gegeben|haben",
  "nehmen|nimmst|nimmt|nahm|genommen|haben",
  "kommen|kommst|kommt|kam|gekommen|sein",
  "fahren|fährst|fährt|fuhr|gefahren|sein",
  "laufen|läufst|läuft|lief|gelaufen|sein",
  "lesen|liest|liest|las|gelesen|haben",
  "essen|isst|isst|aß|gegessen|haben",
  "trinken|trinkst|trinkt|trank|getrunken|haben",
  "sprechen|sprichst|spricht|sprach|gesprochen|haben",
  "treffen|triffst|trifft|traf|getroffen|haben",
  "helfen|hilfst|hilft|half|geholfen|haben",
  "schlafen|schläfst|schläft|schlief|geschlafen|haben",
  "tragen|trägst|trägt|trug|getragen|haben",
  "schlagen|schlägst|schlägt|schlug|geschlagen|haben",
  "halten|hältst|hält|hielt|gehalten|haben",
  "fallen|fällst|fällt|fiel|gefallen|sein",
  "lassen|lässt|lässt|ließ|gelassen|haben",
  "finden|findest|findet|fand|gefunden|haben",
  "bringen|bringst|bringt|brachte|gebracht|haben",
  "denken|denkst|denkt|dachte|gedacht|haben",
  "kennen|kennst|kennt|kannte|gekannt|haben",
  "nennen|nennst|nennt|nannte|genannt|haben",
  "rennen|rennst|rennt|rannte|gerannt|sein",
  "brennen|brennst|brennt|brannte|gebrannt|haben",
  "senden|sendest|sendet|sandte|gesandt|haben",
  "wenden|wendest|wendet|wandte|gewandt|haben",
  "bleiben|bleibst|bleibt|blieb|geblieben|sein",
  "schreiben|schreibst|schreibt|schrieb|geschrieben|haben",
  "treiben|treibst|treibt|trieb|getrieben|haben",
  "reiben|reibst|reibt|rieb|gerieben|haben",
  "steigen|steigst|steigt|stieg|gestiegen|sein",
  "schweigen|schweigst|schweigt|schwieg|geschwiegen|haben",
  "leihen|leihst|leiht|lieh|geliehen|haben",
  "scheinen|scheinst|scheint|schien|geschienen|haben",
  "heißen|heißt|heißt|hieß|geheißen|haben",
  "greifen|greifst|greift|griff|gegriffen|haben",
  "pfeifen|pfeifst|pfeift|pfiff|gepfiffen|haben",
  "reiten|reitest|reitet|ritt|geritten|sein",
  "schneiden|schneidest|schneidet|schnitt|geschnitten|haben",
  "streiten|streitest|streitet|stritt|gestritten|haben",
  "leiden|leidest|leidet|litt|gelitten|haben",
  "beißen|beißt|beißt|biss|gebissen|haben",
  "reißen|reißt|reißt|riss|gerissen|haben",
  "gleichen|gleichst|gleicht|glich|geglichen|haben",
  "weichen|weichst|weicht|wich|gewichen|sein",
  "gleiten|gleitest|gleitet|glitt|geglitten|sein",
  "meiden|meidest|meidet|mied|gemieden|haben",
  "weisen|weist|weist|wies|gewiesen|haben",
  "biegen|biegst|biegt|bog|gebogen|haben",
  "bieten|bietest|bietet|bot|geboten|haben",
  "fliegen|fliegst|fliegt|flog|geflogen|sein",
  "fliehen|fliehst|flieht|floh|geflohen|sein",
  "fließen|fließt|fließt|floss|geflossen|sein",
  "frieren|frierst|friert|fror|gefroren|haben",
  "gießen|gießt|gießt|goss|gegossen|haben",
  "riechen|riechst|riecht|roch|gerochen|haben",
  "kriechen|kriechst|kriecht|kroch|gekrochen|sein",
  "schieben|schiebst|schiebt|schob|geschoben|haben",
  "schießen|schießt|schießt|schoss|geschossen|haben",
  "schließen|schließt|schließt|schloss|geschlossen|haben",
  "wiegen|wiegst|wiegt|wog|gewogen|haben",
  "ziehen|ziehst|zieht|zog|gezogen|haben",
  "lügen|lügst|lügt|log|gelogen|haben",
  "beginnen|beginnst|beginnt|begann|begonnen|haben",
  "gewinnen|gewinnst|gewinnt|gewann|gewonnen|haben",
  "schwimmen|schwimmst|schwimmt|schwamm|geschwommen|sein",
  "singen|singst|singt|sang|gesungen|haben",
  "sinken|sinkst|sinkt|sank|gesunken|sein",
  "springen|springst|springt|sprang|gesprungen|sein",
  "zwingen|zwingst|zwingt|zwang|gezwungen|haben",
  "binden|bindest|bindet|band|gebunden|haben",
  "klingen|klingst|klingt|klang|geklungen|haben",
  "dringen|dringst|dringt|drang|gedrungen|sein",
  "stinken|stinkst|stinkt|stank|gestunken|haben",
  "bitten|bittest|bittet|bat|gebeten|haben",
  "liegen|liegst|liegt|lag|gelegen|haben",
  "sitzen|sitzt|sitzt|saß|gesessen|haben",
  "messen|misst|misst|maß|gemessen|haben",
  "werfen|wirfst|wirft|warf|geworfen|haben",
  "sterben|stirbst|stirbt|starb|gestorben|sein",
  "brechen|brichst|bricht|brach|gebrochen|haben",
  "stechen|stichst|sticht|stach|gestochen|haben",
  "gelten|giltst|gilt|galt|gegolten|haben",
  "werben|wirbst|wirbt|warb|geworben|haben",
  "schmelzen|schmilzt|schmilzt|schmolz|geschmolzen|sein",
  "stehlen|stiehlst|stiehlt|stahl|gestohlen|haben",
  "befehlen|befiehlst|befiehlt|befahl|befohlen|haben",
  "empfehlen|empfiehlst|empfiehlt|empfahl|empfohlen|haben",
  "treten|trittst|tritt|trat|getreten|sein",
  "waschen|wäschst|wäscht|wusch|gewaschen|haben",
  "wachsen|wächst|wächst|wuchs|gewachsen|sein",
  "backen|bäckst|bäckt|backte|gebacken|haben",
  "laden|lädst|lädt|lud|geladen|haben",
  "raten|rätst|rät|riet|geraten|haben",
  "braten|brätst|brät|briet|gebraten|haben",
  "blasen|bläst|bläst|blies|geblasen|haben",
  "graben|gräbst|gräbt|grub|gegraben|haben",
  "schaffen|schaffst|schafft|schuf|geschaffen|haben",
  "fangen|fängst|fängt|fing|gefangen|haben",
  "hängen|hängst|hängt|hing|gehangen|haben",
  "rufen|rufst|ruft|rief|gerufen|haben",
  "stoßen|stößt|stößt|stieß|gestoßen|haben",
  "schreien|schreist|schreit|schrie|geschrien|haben",
  "schleichen|schleichst|schleicht|schlich|geschlichen|sein",
  "streichen|streichst|streicht|strich|gestrichen|haben",
  "schwören|schwörst|schwört|schwor|geschworen|haben",
  "heben|hebst|hebt|hob|gehoben|haben",
  "gedeihen|gedeihst|gedeiht|gedieh|gediehen|sein",
  "genesen|genest|genest|genas|genesen|sein",
  "kneifen|kneifst|kneift|kniff|gekniffen|haben",
  "schleifen|schleifst|schleift|schliff|geschliffen|haben",
  "schlingen|schlingst|schlingt|schlang|geschlungen|haben",
  "schmeißen|schmeißt|schmeißt|schmiss|geschmissen|haben",
  "schwinden|schwindest|schwindet|schwand|geschwunden|sein",
  "schwingen|schwingst|schwingt|schwang|geschwungen|haben",
  "spinnen|spinnst|spinnt|spann|gesponnen|haben",
  "sinnen|sinnst|sinnt|sann|gesonnen|haben",
  "rinnen|rinnst|rinnt|rann|geronnen|sein",
  "ringen|ringst|ringt|rang|gerungen|haben",
  "preisen|preist|preist|pries|gepriesen|haben",
  "speien|speist|speit|spie|gespien|haben",
  "quellen|quillst|quillt|quoll|gequollen|sein",
  "schwellen|schwillst|schwillt|schwoll|geschwollen|sein",
  "schelten|schiltst|schilt|schalt|gescholten|haben",
  "melken|melkst|melkt|molk|gemolken|haben",
  "bergen|birgst|birgt|barg|geborgen|haben",
  "fechten|fichtst|ficht|focht|gefochten|haben",
  "flechten|flichtst|flicht|flocht|geflochten|haben",
  "gebären|gebierst|gebiert|gebar|geboren|haben",
  "gelingen|gelingst|gelingt|gelang|gelungen|sein",
  "geschehen|geschiehst|geschieht|geschah|geschehen|sein",
  "saugen|saugst|saugt|sog|gesogen|haben",
  "sieden|siedest|siedet|sott|gesotten|haben",
  "verderben|verdirbst|verdirbt|verdarb|verdorben|sein",
  "weben|webst|webt|wob|gewoben|haben",
  "winden|windest|windet|wand|gewunden|haben",
  "betrügen|betrügst|betrügt|betrog|betrogen|haben",
  "bewegen|bewegst|bewegt|bewog|bewogen|haben",
  "erlöschen|erlischst|erlischt|erlosch|erloschen|sein",
  "gären|gärst|gärt|gor|gegoren|haben",
  "dreschen|drischst|drischt|drosch|gedroschen|haben",
  "glimmen|glimmst|glimmt|glomm|geglommen|haben",
  "klimmen|klimmst|klimmt|klomm|geklommen|sein",
  "stieben|stiebst|stiebt|stob|gestoben|sein",
  "triefen|triefst|trieft|troff|getroffen|haben",
];

// Модальные глаголы и «wissen» теряют окончание -e в 1 л. ед. ч. и совпадают
// там с 3 л. ед. ч.: «ich kann», «ich weiß».
const ICH_EQUALS_ER = new Set(["können", "müssen", "wollen", "sollen", "dürfen", "mögen", "wissen"]);

type StrongEntry = { du: string; er: string; praet: string; part2: string; aux: "haben" | "sein" };

const STRONG: Map<string, StrongEntry> = new Map(
  STRONG_ROWS.map((line) => {
    const [inf, du, er, praet, part2, aux] = line.split("|");
    return [inf, { du, er, praet, part2, aux: aux as "haben" | "sein" }] as const;
  }),
);

// ─── Приставки ───────────────────────────────────────────────────────────────
//
// Отделяемые приставки уходят в конец предложения и вставляют «ge-» внутрь
// Partizip II: aufstehen → stand auf → aufgestanden. Неотделяемые «ge-»
// не дают вовсе: verstehen → verstand → verstanden.
//
// Длинные варианты стоят раньше коротких, иначе «herausfinden» разбирается
// как «her» + «ausfinden».

const SEPARABLE_PREFIXES = [
  "gegenüber", "auseinander", "zusammen", "entgegen", "herunter", "herüber", "hinunter", "hinüber",
  "zurecht", "zurück", "voraus", "vorbei", "vorüber", "hervor", "heraus", "herein", "hinaus",
  "hinein", "weiter", "entlang", "vorher", "nieder", "wieder", "empor", "davon", "statt", "teil",
  "voran", "fest", "fort", "frei", "hoch", "dazu", "nach", "vor", "mit", "bei", "ein", "aus",
  "auf", "ab", "an", "zu", "her", "hin", "los", "weg", "um",
];

const INSEPARABLE_PREFIXES = ["emp", "ent", "miss", "ver", "zer", "be", "er", "ge"];

/** Слабые глаголы, которые всё-таки берут «sein» — движение и смена состояния. */
const WEAK_SEIN = new Set([
  "reisen", "verreisen", "wandern", "folgen", "begegnen", "passieren", "landen", "klettern",
  "segeln", "rutschen", "stürzen", "platzen", "explodieren", "erwachen", "eilen", "reifen",
]);

/** Основа слабого глагола: инфинитив без -en (или без -n у -eln/-ern). */
function weakStem(infinitive: string): string {
  if (/(el|er)n$/.test(infinitive)) return infinitive.slice(0, -1);
  if (infinitive.endsWith("en")) return infinitive.slice(0, -2);
  if (infinitive.endsWith("n")) return infinitive.slice(0, -1);
  return infinitive;
}

/** ich-форма сильного глагола: обычно основа инфинитива + -e, кроме модальных. */
function strongIch(infinitive: string, entry: StrongEntry): string {
  if (infinitive === "sein") return "bin";
  if (infinitive === "tun") return "tue";
  if (ICH_EQUALS_ER.has(infinitive)) return entry.er;
  return `${weakStem(infinitive)}e`;
}

/** Нужна ли соединительная -e-: основа на d/t или на согласный + m/n. */
function needsEpenthesis(stem: string): boolean {
  if (/[dt]$/.test(stem)) return true;
  return /[^aeiouäöülrmnh][mn]$/.test(stem);
}

function duEnding(stem: string): string {
  if (/[sßxz]$/.test(stem)) return "t"; // «heißt», «tanzt» — -s основы сливается с окончанием
  return needsEpenthesis(stem) ? "est" : "st";
}

function erEnding(stem: string): string {
  return needsEpenthesis(stem) ? "et" : "t";
}

/** Разбирает глагол на отделяемую приставку и базу, если она есть. */
function splitSeparable(infinitive: string): { prefix: string; base: string } | null {
  for (const prefix of SEPARABLE_PREFIXES) {
    if (!infinitive.startsWith(prefix)) continue;
    const base = infinitive.slice(prefix.length);
    // Осмысленная база, а не двухбуквенный огрызок.
    if (base.length < 3 || !base.endsWith("n")) continue;
    return { prefix, base };
  }
  return null;
}

function hasInseparablePrefix(infinitive: string): boolean {
  return INSEPARABLE_PREFIXES.some((p) => infinitive.startsWith(p) && infinitive.length > p.length + 2);
}

/** Partizip II слабого глагола: ge- + основа + -t, кроме -ieren и неотделяемых. */
function weakPartizip2(infinitive: string, stem: string): string {
  const ending = erEnding(stem);
  if (infinitive.endsWith("ieren") || hasInseparablePrefix(infinitive)) return stem + ending;
  return `ge${stem}${ending}`;
}

/**
 * Слабость глагола, гарантированная его строением, а не статистикой.
 *
 * Эти четыре словообразовательных класса в немецком не бывают сильными:
 * -ieren (заимствования), -eln / -ern (итеративы), -igen (отымённые).
 */
function structurallyWeak(infinitive: string): boolean {
  return /(?:ieren|eln|ern|igen)$/.test(infinitive);
}

/**
 * Финали, на которых живут немецкие сильные глаголы (классы аблаута).
 *
 * Класс сильных глаголов в немецком закрыт — новые в него не приходят, — и
 * таблица выше перечисляет его целиком (см. тест на полноту). Поэтому «нет в
 * таблице ⇒ слабый» — вывод, а не догадка.
 *
 * Этот список закрывает остаточный риск: если сильный глагол в таблицу всё же
 * не попал, его финаль почти наверняка здесь, и вместо выведенной правилом
 * (то есть неверной) формы пользователь увидит ожидание ответа модели.
 *
 * Финали отобраны по тому, чем в них можно ошибиться. Взяты только те, где
 * сильные глаголы преобладают: -ießen, -inden, -ingen, -echen. Не взяты
 * -aufen, -eigen, -eiten, -aden и подобные — сильные глаголы оттуда все уже
 * в таблице, а вот слабых там много и они частотные («kaufen», «zeigen»,
 * «arbeiten», «baden»), и ждать модель на каждом из них не за что.
 *
 * Остаточные ложные срабатывания («stimmen», «fehlen», «lieben», «mieten»)
 * стоят одного ожидания при первом просмотре, дальше слово в кэше. Пропуск
 * сильного глагола стоит неверно выученной формы — цена несопоставима.
 */
const STRONG_LIKE_RIMES = [
  // Классы I–II: ei / ie в корне.
  "eiben", "eifen", "eißen", "iegen", "iehen", "ieben", "ieten", "ießen",
  // Класс III: i + носовой или сонорный.
  "inden", "ingen", "innen", "immen", "inken",
  // Классы IV–V: e в корне.
  "echen", "echten", "ehlen", "ehmen", "elten", "erben", "erfen",
];

/** Похож ли глагол на сильный по своей финали. */
function looksStrongLike(infinitive: string): boolean {
  // -ieren заимствованное и всегда слабое, хотя и оканчивается на «ieren».
  if (structurallyWeak(infinitive)) return false;
  return STRONG_LIKE_RIMES.some((rime) => infinitive.endsWith(rime));
}

/**
 * Формы одного немецкого глагола.
 *
 * Возвращает `null`, если слово не похоже на инфинитив — тогда показывать
 * нечего и превью просто не рисует блок глагола.
 */
export function conjugateGerman(rawInfinitive: string): GermanVerbForms | null {
  const infinitive = rawInfinitive.trim().toLowerCase().replace(/^(sich|zu)\s+/, "");
  if (!/^[a-zäöüß]+$/.test(infinitive)) return null;
  if (!infinitive.endsWith("n") || infinitive.length < 3) return null;

  const direct = STRONG.get(infinitive);
  if (direct) {
    return {
      infinitive,
      present: { ich: strongIch(infinitive, direct), du: direct.du, er: direct.er },
      praeteritum: direct.praet,
      partizip2: direct.part2,
      hilfsverb: direct.aux,
      separablePrefix: null,
      irregular: true,
      source: "table",
      provisional: false,
    };
  }

  // Отделяемая приставка: считаем базу и ставим приставку туда, куда её ставит
  // немецкий — в конец у личных форм и в начало у причастия.
  const split = splitSeparable(infinitive);
  if (split) {
    const base = conjugateGerman(split.base);
    if (base) {
      return {
        infinitive,
        present: {
          ich: `${base.present.ich} ${split.prefix}`,
          du: `${base.present.du} ${split.prefix}`,
          er: `${base.present.er} ${split.prefix}`,
        },
        praeteritum: `${base.praeteritum} ${split.prefix}`,
        partizip2: split.prefix + base.partizip2,
        hilfsverb: base.hilfsverb,
        separablePrefix: split.prefix,
        irregular: base.irregular,
        source: base.source,
        provisional: base.provisional,
      };
    }
  }

  // Неотделяемая приставка над сильным корнем: verstehen → stehen.
  for (const prefix of INSEPARABLE_PREFIXES) {
    if (!infinitive.startsWith(prefix)) continue;
    const root = STRONG.get(infinitive.slice(prefix.length));
    if (!root) continue;
    const stripGe = (form: string) => (form.startsWith("ge") ? form.slice(2) : form);
    return {
      infinitive,
      present: {
        ich: `${weakStem(infinitive)}e`,
        du: prefix + root.du,
        er: prefix + root.er,
      },
      praeteritum: prefix + root.praet,
      partizip2: prefix + stripGe(root.part2),
      hilfsverb: root.aux,
      separablePrefix: null,
      irregular: true,
      source: "table",
      provisional: false,
    };
  }

  // Слабый глагол — правила детерминированы.
  const stem = weakStem(infinitive);
  const isEln = infinitive.endsWith("eln");
  return {
    infinitive,
    present: {
      // «sammeln» → «ich sammle», а не «ich sammele».
      ich: isEln ? `${stem.slice(0, -2)}le` : `${stem}e`,
      du: stem + duEnding(stem),
      er: stem + erEnding(stem),
    },
    praeteritum: `${stem}${needsEpenthesis(stem) ? "ete" : "te"}`,
    partizip2: weakPartizip2(infinitive, stem),
    hilfsverb: WEAK_SEIN.has(infinitive) ? "sein" : "haben",
    separablePrefix: null,
    irregular: false,
    source: "rule",
    // Слабое спряжение детерминировано. Единственный риск — сильный глагол,
    // не попавший в таблицу; его выдаёт финаль.
    provisional: looksStrongLike(infinitive),
  };
}

/**
 * Стоит ли уточнить формы у модели.
 *
 * Отличить «machen» (слабый) от «gedeihen» (сильный) без списка нельзя, а
 * список конечен, но не бесконечен. Поэтому здесь не гадают: если формы
 * выведены правилом и строение слова не гарантирует слабость — ответ «да».
 *
 * Это не задерживает подсказку. Локальные формы показываются сразу же, запрос
 * уходит фоном и молча заменяет их, если модель не согласна; результат
 * кэшируется, так что второй раз это слово уже мгновенное. Для полутора сотен
 * самых частых глаголов и всех их приставочных производных сети нет вовсе.
 */
export function needsAiBackfill(forms: GermanVerbForms | null): boolean {
  return forms?.provisional ?? false;
}

/** Известен ли глагол таблице сильных — для тестов и отладки. */
export function isTabulatedVerb(infinitive: string): boolean {
  return STRONG.has(infinitive.trim().toLowerCase());
}
