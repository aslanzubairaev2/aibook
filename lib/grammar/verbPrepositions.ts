// «Глаголы и предлоги»: does this verb take a preposition, which one, and
// which case after it.
//
// The catalogue's unit is a verb in one meaning with its government —
// «sprechen mit» (с кем) and «sprechen über» (о чём) are two entries. Each
// entry carries its meaning, preposition, case, level, the grammar topics it
// needs, examples with translations, and the objects it is used with: people
// as pronouns, and noun phrases with their Russian rendering, written out by
// hand so a prompt never reads two ways. Verbs that take no preposition
// (sehen, hören, suchen…) are entries too: mixed in, they keep «is there a
// preposition at all?» a real question.

import {
  OBJECTS,
  PEOPLE,
  SUBJECTS,
  cap,
  contract,
  determiner,
  fold,
  naturalPair,
  personNotes,
  pickOne,
  pickWeighted,
  rng,
  shuffle,
  type Case,
  type Gender,
  type PersonId,
  type RuGov,
} from "./common";
import type { PersonKey } from "@/lib/pronouns/catalog";
import { sentenceText, type GrammarTask, type Mode, type QuickSpec, type Tok, type Variant } from "./task";

export const VP_TEMPLATE = "vp-v1";

type Forms = Record<PersonKey, string>;
function f(a: string, b: string, c: string, d: string, e: string, g: string): Forms {
  return { "1s": a, "2s": b, "3s": c, "1p": d, "2p": e, "3p": g };
}

/** A noun object as the catalogue writes it: the German noun, its determiner, and the Russian exactly as the prompt says it. */
export type Filler = { de: string; gender: Gender; det: "def" | "indef" | "none"; ru: string; /** The determiner cannot be swapped: «nach dem Weg», never «nach einem Weg». */ fixed?: boolean };

export type Combo = {
  id: string;
  /** How the learner sees it: «warten auf + Akk». */
  label: string;
  infinitive: string;
  prep: string | null;
  case: "acc" | "dat";
  meaning: string;
  level: "A1" | "A2";
  topics: string[];
  reflexive: boolean;
  prefix: string | null;
  present: Forms;
  ruPresent: Forms;
  ruInf: string;
  /** How Russian governs a person object: «меня», «обо мне», «со мной»… null: no person objects. */
  ruGov: RuGov | null;
  fillers: Filler[];
  /** bitten / danken: a person object stands before the prepositional one. */
  person?: { case: "acc" | "dat"; ruGov: RuGov; fillers: Filler[] };
  sentenceTypes: ("statement" | "question" | "negation")[];
  modal: boolean;
  /** Other constructions that are just as right: «sprechen von + Dat». */
  alternatives?: { prep: string; case: "acc" | "dat"; note: string }[];
  /** Prepositions that look plausible here and are wrong — the build mode's distractors. */
  confusable: string[];
  note: string;
  contrast?: string;
  examples: { de: string; ru: string }[];
};

const MODAL = { de: f("kann", "kannst", "kann", "können", "könnt", "können"), ru: f("могу", "можешь", "может", "можем", "можете", "могут") };

const WARTEN_NOTE = "warten auf — устойчивое сочетание: auf нужно запомнить вместе с глаголом. Объяснение «куда?» здесь не работает: никто никуда не движется, просто глагол warten требует auf + Akkusativ.";

export const COMBOS: Combo[] = [
  // ── With a preposition + Akkusativ ──
  {
    id: "warten_auf", label: "warten auf + Akk", infinitive: "warten", prep: "auf", case: "acc",
    meaning: "ждать кого-то / что-то", level: "A1", topics: ["Akkusativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("warte", "wartest", "wartet", "warten", "wartet", "warten"), ruPresent: f("жду", "ждёшь", "ждёт", "ждём", "ждёте", "ждут"), ruInf: "подождать",
    ruGov: "acc",
    fillers: [
      { de: "Bus", gender: "m", det: "def", ru: "автобус" },
      { de: "Zug", gender: "m", det: "def", ru: "поезд" },
      { de: "Lehrer", gender: "m", det: "def", ru: "учителя" },
      { de: "Freundin", gender: "f", det: "def", ru: "подругу" },
      { de: "Paket", gender: "n", det: "def", ru: "посылку" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["an", "für", "um"],
    note: WARTEN_NOTE,
    contrast: "Русское «ждать кого» — без предлога, по-немецки warten auf + Akk.",
    examples: [{ de: "Wir warten auf euch.", ru: "Мы ждём вас." }, { de: "Ich warte auf den Bus.", ru: "Я жду автобус." }],
  },
  {
    id: "denken_an", label: "denken an + Akk", infinitive: "denken", prep: "an", case: "acc",
    meaning: "думать о ком-то / о чём-то", level: "A2", topics: ["Akkusativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("denke", "denkst", "denkt", "denken", "denkt", "denken"), ruPresent: f("думаю", "думаешь", "думает", "думаем", "думаете", "думают"), ruInf: "думать",
    ruGov: "o_pre",
    fillers: [
      { de: "Urlaub", gender: "m", det: "def", ru: "об отпуске", fixed: true },
      { de: "Prüfung", gender: "f", det: "def", ru: "об экзамене", fixed: true },
      { de: "Arbeit", gender: "f", det: "def", ru: "о работе", fixed: true },
      { de: "Familie", gender: "f", det: "def", ru: "о семье", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["über", "von", "auf"],
    note: "denken an + Akkusativ — «думать о». Русское «о» соблазняет сказать über, но с denken нужен an.",
    contrast: "denken an — думать о ком-то; sprechen über — говорить о чём-то.",
    examples: [{ de: "Ich denke an dich.", ru: "Я думаю о тебе." }, { de: "Wir denken an die Prüfung.", ru: "Мы думаем об экзамене." }],
  },
  {
    id: "sprechen_ueber", label: "sprechen über + Akk", infinitive: "sprechen", prep: "über", case: "acc",
    meaning: "говорить о ком-то / о чём-то (тема)", level: "A2", topics: ["Akkusativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("spreche", "sprichst", "spricht", "sprechen", "sprecht", "sprechen"), ruPresent: f("говорю", "говоришь", "говорит", "говорим", "говорите", "говорят"), ruInf: "поговорить",
    ruGov: "o_pre",
    fillers: [
      { de: "Film", gender: "m", det: "def", ru: "о фильме", fixed: true },
      { de: "Wetter", gender: "n", det: "def", ru: "о погоде", fixed: true },
      { de: "Arbeit", gender: "f", det: "def", ru: "о работе", fixed: true },
      { de: "Reise", gender: "f", det: "def", ru: "о поездке", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["mit", "an", "um"],
    alternatives: [{ prep: "von", case: "dat", note: "Тоже верно: sprechen von + Dativ. Основной вариант для темы разговора — über + Akkusativ." }],
    note: "sprechen über + Akkusativ — говорить о чём-то, о ком-то: тема разговора.",
    contrast: "sprechen mit — с кем говорят; sprechen über — о чём говорят.",
    examples: [{ de: "Wir sprechen über den Film.", ru: "Мы говорим о фильме." }, { de: "Sprecht ihr über mich?", ru: "Вы говорите обо мне?" }],
  },
  {
    id: "bitten_um", label: "bitten + Akk + um + Akk", infinitive: "bitten", prep: "um", case: "acc",
    meaning: "просить (кого-то) о чём-то", level: "A2", topics: ["Akkusativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("bitte", "bittest", "bittet", "bitten", "bittet", "bitten"), ruPresent: f("прошу", "просишь", "просит", "просим", "просите", "просят"), ruInf: "попросить",
    ruGov: null,
    person: {
      case: "acc", ruGov: "acc",
      fillers: [
        { de: "Lehrer", gender: "m", det: "def", ru: "учителя" },
        { de: "Mutter", gender: "f", det: "def", ru: "маму" },
        { de: "Arzt", gender: "m", det: "def", ru: "врача" },
      ],
    },
    fillers: [
      { de: "Hilfe", gender: "f", det: "none", ru: "о помощи" },
      { de: "Rat", gender: "m", det: "none", ru: "о совете" },
      { de: "Geduld", gender: "f", det: "none", ru: "о терпении" },
      { de: "Pause", gender: "f", det: "indef", ru: "о перерыве", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["für", "nach", "über"],
    note: "jemanden um etwas bitten: кого просят — Akkusativ без предлога, о чём просят — um + Akkusativ.",
    contrast: "bitten um — просить о чём-то; fragen nach — спрашивать о чём-то.",
    examples: [{ de: "Ich bitte dich um Hilfe.", ru: "Я прошу тебя о помощи." }, { de: "Wir bitten den Lehrer um Rat.", ru: "Мы просим учителя о совете." }],
  },
  {
    id: "aufpassen_auf", label: "aufpassen auf + Akk", infinitive: "aufpassen", prep: "auf", case: "acc",
    meaning: "присматривать за кем-то / чем-то", level: "A2", topics: ["Akkusativ", "глагол с предлогом", "отделяемые приставки"], reflexive: false, prefix: "auf",
    present: f("passe", "passt", "passt", "passen", "passt", "passen"), ruPresent: f("присматриваю", "присматриваешь", "присматривает", "присматриваем", "присматриваете", "присматривают"), ruInf: "присмотреть",
    ruGov: "za_ins",
    fillers: [
      { de: "Kind", gender: "n", det: "def", ru: "за ребёнком" },
      { de: "Hund", gender: "m", det: "def", ru: "за собакой" },
      { de: "Tasche", gender: "f", det: "def", ru: "за сумкой" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["für", "an", "um"],
    note: "aufpassen auf + Akkusativ: auf — и приставка, и предлог. Ich passe auf dich auf: первое auf — предлог, последнее — отделившаяся приставка.",
    examples: [{ de: "Ich passe auf das Kind auf.", ru: "Я присматриваю за ребёнком." }, { de: "Passt du auf mich auf?", ru: "Ты присматриваешь за мной?" }],
  },
  // ── With a preposition + Dativ ──
  {
    id: "sprechen_mit", label: "sprechen mit + Dat", infinitive: "sprechen", prep: "mit", case: "dat",
    meaning: "говорить с кем-то", level: "A1", topics: ["Dativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("spreche", "sprichst", "spricht", "sprechen", "sprecht", "sprechen"), ruPresent: f("говорю", "говоришь", "говорит", "говорим", "говорите", "говорят"), ruInf: "поговорить",
    ruGov: "s_ins",
    fillers: [
      { de: "Lehrer", gender: "m", det: "def", ru: "с учителем" },
      { de: "Lehrerin", gender: "f", det: "def", ru: "с учительницей" },
      { de: "Arzt", gender: "m", det: "def", ru: "с врачом" },
      { de: "Mutter", gender: "f", det: "def", ru: "с мамой" },
      { de: "Chef", gender: "m", det: "def", ru: "с начальником" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["über", "an", "zu"],
    note: "sprechen mit + Dativ — говорить с кем-то: собеседник. После mit всегда Dativ: mit mir, mit dir, mit ihm, mit ihr, mit uns, mit euch, mit ihnen.",
    contrast: "sprechen mit — с кем говорят; sprechen über — о чём говорят.",
    examples: [{ de: "Ich spreche mit dem Lehrer.", ru: "Я говорю с учителем." }, { de: "Sprichst du mit ihr?", ru: "Ты говоришь с ней?" }],
  },
  {
    id: "fragen_nach", label: "fragen nach + Dat", infinitive: "fragen", prep: "nach", case: "dat",
    meaning: "спрашивать о ком-то / о чём-то, узнавать", level: "A2", topics: ["Dativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("frage", "fragst", "fragt", "fragen", "fragt", "fragen"), ruPresent: f("спрашиваю", "спрашиваешь", "спрашивает", "спрашиваем", "спрашиваете", "спрашивают"), ruInf: "спросить",
    ruGov: "o_pre",
    fillers: [
      { de: "Weg", gender: "m", det: "def", ru: "дорогу", fixed: true },
      { de: "Preis", gender: "m", det: "def", ru: "о цене", fixed: true },
      { de: "Adresse", gender: "f", det: "def", ru: "адрес", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["über", "um", "von"],
    note: "fragen nach + Dativ — спрашивать о чём-то, что хочешь узнать: nach dem Weg — дорогу, nach dem Preis — цену. Кого спрашивают — Akkusativ без предлога: Ich frage dich.",
    contrast: "fragen (без предлога) — спрашивать кого-то; fragen nach — спрашивать о чём-то.",
    examples: [{ de: "Ich frage nach dem Weg.", ru: "Я спрашиваю дорогу." }, { de: "Er fragt nach dir.", ru: "Он спрашивает о тебе." }],
  },
  {
    id: "teilnehmen_an", label: "teilnehmen an + Dat", infinitive: "teilnehmen", prep: "an", case: "dat",
    meaning: "участвовать в чём-то", level: "A2", topics: ["Dativ", "глагол с предлогом", "отделяемые приставки"], reflexive: false, prefix: "teil",
    present: f("nehme", "nimmst", "nimmt", "nehmen", "nehmt", "nehmen"), ruPresent: f("участвую", "участвуешь", "участвует", "участвуем", "участвуете", "участвуют"), ruInf: "участвовать",
    ruGov: null,
    fillers: [
      { de: "Kurs", gender: "m", det: "def", ru: "в курсе", fixed: true },
      { de: "Treffen", gender: "n", det: "def", ru: "во встрече", fixed: true },
      { de: "Spiel", gender: "n", det: "def", ru: "в игре", fixed: true },
      { de: "Prüfung", gender: "f", det: "def", ru: "в экзамене", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["in", "bei", "für"],
    note: "an etwas teilnehmen: an + Dativ, an dem сливается в am. Приставка teil уходит в конец: Ich nehme am Kurs teil.",
    examples: [{ de: "Ich nehme am Kurs teil.", ru: "Я участвую в курсе." }, { de: "Nimmst du an der Prüfung teil?", ru: "Ты участвуешь в экзамене?" }],
  },
  // ── Reflexive verbs with a preposition ──
  {
    id: "sich_freuen_auf", label: "sich freuen auf + Akk", infinitive: "freuen", prep: "auf", case: "acc",
    meaning: "радоваться тому, что будет", level: "A2", topics: ["Akkusativ", "глагол с предлогом", "возвратные глаголы"], reflexive: true, prefix: null,
    present: f("freue", "freust", "freut", "freuen", "freut", "freuen"), ruPresent: f("радуюсь", "радуешься", "радуется", "радуемся", "радуетесь", "радуются"), ruInf: "радоваться",
    ruGov: null,
    fillers: [
      { de: "Urlaub", gender: "m", det: "def", ru: "предстоящему отпуску", fixed: true },
      { de: "Wochenende", gender: "n", det: "def", ru: "предстоящим выходным", fixed: true },
      { de: "Party", gender: "f", det: "def", ru: "предстоящей вечеринке", fixed: true },
      { de: "Reise", gender: "f", det: "def", ru: "предстоящей поездке", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["über", "für", "an"],
    note: "sich freuen auf + Akkusativ — радоваться тому, что ещё будет. О том, что уже есть или случилось, — sich freuen über.",
    contrast: "sich freuen auf — то, что впереди; sich freuen über — то, что уже есть.",
    examples: [{ de: "Ich freue mich auf den Urlaub.", ru: "Я радуюсь предстоящему отпуску." }],
  },
  {
    id: "sich_freuen_ueber", label: "sich freuen über + Akk", infinitive: "freuen", prep: "über", case: "acc",
    meaning: "радоваться тому, что уже есть", level: "A2", topics: ["Akkusativ", "глагол с предлогом", "возвратные глаголы"], reflexive: true, prefix: null,
    present: f("freue", "freust", "freut", "freuen", "freut", "freuen"), ruPresent: f("радуюсь", "радуешься", "радуется", "радуемся", "радуетесь", "радуются"), ruInf: "радоваться",
    ruGov: null,
    fillers: [
      { de: "Geschenk", gender: "n", det: "def", ru: "подарку" },
      { de: "Brief", gender: "m", det: "def", ru: "письму" },
      { de: "Nachricht", gender: "f", det: "def", ru: "новости", fixed: true },
      { de: "Einladung", gender: "f", det: "def", ru: "приглашению" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["auf", "für", "an"],
    note: "sich freuen über + Akkusativ — радоваться тому, что уже получил или что уже произошло.",
    contrast: "sich freuen auf — то, что впереди; sich freuen über — то, что уже есть.",
    examples: [{ de: "Sie freut sich über das Geschenk.", ru: "Она радуется подарку." }],
  },
  {
    id: "sich_interessieren_fuer", label: "sich interessieren für + Akk", infinitive: "interessieren", prep: "für", case: "acc",
    meaning: "интересоваться чем-то", level: "A2", topics: ["Akkusativ", "глагол с предлогом", "возвратные глаголы"], reflexive: true, prefix: null,
    present: f("interessiere", "interessierst", "interessiert", "interessieren", "interessiert", "interessieren"), ruPresent: f("интересуюсь", "интересуешься", "интересуется", "интересуемся", "интересуетесь", "интересуются"), ruInf: "интересоваться",
    ruGov: null,
    fillers: [
      { de: "Musik", gender: "f", det: "none", ru: "музыкой" },
      { de: "Sport", gender: "m", det: "none", ru: "спортом" },
      { de: "Kunst", gender: "f", det: "none", ru: "искусством" },
      { de: "Politik", gender: "f", det: "none", ru: "политикой" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["über", "an", "mit"],
    note: "sich interessieren für + Akkusativ. Русское «интересоваться чем» — без предлога, по-немецки обязательно für.",
    examples: [{ de: "Ich interessiere mich für Musik.", ru: "Я интересуюсь музыкой." }],
  },
  {
    id: "sich_erinnern_an", label: "sich erinnern an + Akk", infinitive: "erinnern", prep: "an", case: "acc",
    meaning: "помнить, вспоминать кого-то / что-то", level: "A2", topics: ["Akkusativ", "глагол с предлогом", "возвратные глаголы"], reflexive: true, prefix: null,
    present: f("erinnere", "erinnerst", "erinnert", "erinnern", "erinnert", "erinnern"), ruPresent: f("помню", "помнишь", "помнит", "помним", "помните", "помнят"), ruInf: "вспомнить",
    ruGov: "acc",
    fillers: [
      { de: "Urlaub", gender: "m", det: "def", ru: "отпуск", fixed: true },
      { de: "Reise", gender: "f", det: "def", ru: "поездку", fixed: true },
      { de: "Film", gender: "m", det: "def", ru: "фильм", fixed: true },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["über", "auf", "von"],
    note: "sich erinnern an + Akkusativ — помнить, вспоминать. Русское «помню тебя» без предлога, по-немецки: Ich erinnere mich an dich.",
    examples: [{ de: "Ich erinnere mich an dich.", ru: "Я помню тебя." }, { de: "Ich kann mich nicht an den Film erinnern.", ru: "Я не могу вспомнить фильм." }],
  },
  {
    id: "sich_kuemmern_um", label: "sich kümmern um + Akk", infinitive: "kümmern", prep: "um", case: "acc",
    meaning: "заботиться о ком-то / чём-то", level: "A2", topics: ["Akkusativ", "глагол с предлогом", "возвратные глаголы"], reflexive: true, prefix: null,
    present: f("kümmere", "kümmerst", "kümmert", "kümmern", "kümmert", "kümmern"), ruPresent: f("забочусь", "заботишься", "заботится", "заботимся", "заботитесь", "заботятся"), ruInf: "позаботиться",
    ruGov: "o_pre",
    fillers: [
      { de: "Kind", gender: "n", det: "def", ru: "о ребёнке" },
      { de: "Katze", gender: "f", det: "def", ru: "о кошке" },
      { de: "Oma", gender: "f", det: "def", ru: "о бабушке" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["über", "an", "für"],
    note: "sich kümmern um + Akkusativ — заботиться о ком-то. Русское «о» — не über и не an, а um.",
    examples: [{ de: "Ich kümmere mich um die Katze.", ru: "Я забочусь о кошке." }],
  },
  {
    id: "danken_fuer", label: "danken + Dat + für + Akk", infinitive: "danken", prep: "für", case: "acc",
    meaning: "благодарить кого-то за что-то", level: "A2", topics: ["Dativ", "Akkusativ", "глагол с предлогом"], reflexive: false, prefix: null,
    present: f("danke", "dankst", "dankt", "danken", "dankt", "danken"), ruPresent: f("благодарю", "благодаришь", "благодарит", "благодарим", "благодарите", "благодарят"), ruInf: "поблагодарить",
    ruGov: null,
    person: {
      case: "dat", ruGov: "acc",
      fillers: [
        { de: "Lehrerin", gender: "f", det: "def", ru: "учительницу" },
        { de: "Freund", gender: "m", det: "def", ru: "друга" },
        { de: "Arzt", gender: "m", det: "def", ru: "врача" },
      ],
    },
    fillers: [
      { de: "Hilfe", gender: "f", det: "def", ru: "за помощь", fixed: true },
      { de: "Geschenk", gender: "n", det: "def", ru: "за подарок", fixed: true },
      { de: "Einladung", gender: "f", det: "def", ru: "за приглашение", fixed: true },
      { de: "Tipp", gender: "m", det: "def", ru: "за совет", fixed: true },
    ],
    sentenceTypes: ["statement", "question"], modal: false, confusable: ["um", "über", "an"],
    note: "jemandem für etwas danken: кого благодарят — Dativ (по-русски «кого» — винительный!), за что — für + Akkusativ.",
    examples: [{ de: "Ich danke dir für die Hilfe.", ru: "Я благодарю тебя за помощь." }],
  },
  // ── No preposition ──
  {
    id: "sehen", label: "sehen + Akk", infinitive: "sehen", prep: null, case: "acc",
    meaning: "видеть", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("sehe", "siehst", "sieht", "sehen", "seht", "sehen"), ruPresent: f("вижу", "видишь", "видит", "видим", "видите", "видят"), ruInf: "увидеть",
    ruGov: "acc",
    fillers: [
      { de: "Bus", gender: "m", det: "def", ru: "автобус" },
      { de: "Auto", gender: "n", det: "def", ru: "машину" },
      { de: "Lehrer", gender: "m", det: "def", ru: "учителя" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["auf", "an"],
    note: "sehen — без предлога: прямое дополнение в Akkusativ. Ich sehe dich.",
    examples: [{ de: "Wir sehen euch.", ru: "Мы видим вас." }],
  },
  {
    id: "hoeren", label: "hören + Akk", infinitive: "hören", prep: null, case: "acc",
    meaning: "слышать", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("höre", "hörst", "hört", "hören", "hört", "hören"), ruPresent: f("слышу", "слышишь", "слышит", "слышим", "слышите", "слышат"), ruInf: "услышать",
    ruGov: "acc",
    fillers: [
      { de: "Musik", gender: "f", det: "none", ru: "музыку" },
      { de: "Zug", gender: "m", det: "def", ru: "поезд" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["auf", "zu"],
    note: "hören (слышать) — без предлога: Ich höre dich. (auf jemanden hören — «слушаться», другое значение.)",
    examples: [{ de: "Wir hören euch.", ru: "Мы слышим вас." }],
  },
  {
    id: "suchen", label: "suchen + Akk", infinitive: "suchen", prep: null, case: "acc",
    meaning: "искать", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("suche", "suchst", "sucht", "suchen", "sucht", "suchen"), ruPresent: f("ищу", "ищешь", "ищет", "ищем", "ищете", "ищут"), ruInf: "искать",
    ruGov: "acc",
    fillers: [
      { de: "Schlüssel", gender: "m", det: "def", ru: "ключ" },
      { de: "Brille", gender: "f", det: "def", ru: "очки" },
      { de: "Handy", gender: "n", det: "def", ru: "телефон" },
    ],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["nach", "für"],
    alternatives: [{ prep: "nach", case: "dat", note: "Тоже верно: suchen nach + Dativ. Но и без предлога — Ich suche dich — правильно и чаще." }],
    note: "suchen — обычно без предлога: Ich suche den Schlüssel. Вариант suchen nach + Dativ тоже существует.",
    examples: [{ de: "Ich suche dich.", ru: "Я ищу тебя." }],
  },
  {
    id: "brauchen", label: "brauchen + Akk", infinitive: "brauchen", prep: null, case: "acc",
    meaning: "нуждаться в ком-то, нужен", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("brauche", "brauchst", "braucht", "brauchen", "braucht", "brauchen"), ruPresent: f("нуждаюсь", "нуждаешься", "нуждается", "нуждаемся", "нуждаетесь", "нуждаются"), ruInf: "нуждаться",
    ruGov: "v_pre",
    fillers: [{ de: "Hilfe", gender: "f", det: "none", ru: "в помощи" }],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["in", "für"],
    note: "Нуждаться в ком-то → jemanden brauchen: по-немецки без предлога, Akkusativ. Русское «в» не переводится.",
    examples: [{ de: "Wir brauchen euch.", ru: "Мы нуждаемся в вас." }],
  },
  {
    id: "besuchen", label: "besuchen + Akk", infinitive: "besuchen", prep: null, case: "acc",
    meaning: "навещать, посещать", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("besuche", "besuchst", "besucht", "besuchen", "besucht", "besuchen"), ruPresent: f("навещаю", "навещаешь", "навещает", "навещаем", "навещаете", "навещают"), ruInf: "навестить",
    ruGov: "acc",
    fillers: [{ de: "Oma", gender: "f", det: "def", ru: "бабушку" }, { de: "Opa", gender: "m", det: "def", ru: "дедушку" }],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["zu", "bei"],
    note: "besuchen — без предлога: Ich besuche dich. (zu jemandem gehen — «идти к кому-то», другая конструкция.)",
    examples: [{ de: "Wir besuchen die Oma.", ru: "Мы навещаем бабушку." }],
  },
  {
    id: "fragen", label: "fragen + Akk", infinitive: "fragen", prep: null, case: "acc",
    meaning: "спрашивать кого-то", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("frage", "fragst", "fragt", "fragen", "fragt", "fragen"), ruPresent: f("спрашиваю", "спрашиваешь", "спрашивает", "спрашиваем", "спрашиваете", "спрашивают"), ruInf: "спросить",
    ruGov: "acc",
    fillers: [{ de: "Lehrer", gender: "m", det: "def", ru: "учителя" }, { de: "Lehrerin", gender: "f", det: "def", ru: "учительницу" }],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["nach", "an"],
    note: "fragen — кого спрашивают: Akkusativ без предлога, Ich frage dich. О чём — fragen nach + Dativ.",
    contrast: "fragen (без предлога) — спрашивать кого-то; fragen nach — спрашивать о чём-то.",
    examples: [{ de: "Ich frage dich.", ru: "Я спрашиваю тебя." }],
  },
  {
    id: "kennen", label: "kennen + Akk", infinitive: "kennen", prep: null, case: "acc",
    meaning: "знать (кого-то)", level: "A1", topics: ["Akkusativ"], reflexive: false, prefix: null,
    present: f("kenne", "kennst", "kennt", "kennen", "kennt", "kennen"), ruPresent: f("знаю", "знаешь", "знает", "знаем", "знаете", "знают"), ruInf: "знать",
    ruGov: "acc",
    fillers: [{ de: "Lehrerin", gender: "f", det: "def", ru: "учительницу" }],
    sentenceTypes: ["statement", "question", "negation"], modal: false, confusable: ["von", "über"],
    note: "kennen — без предлога: Ich kenne ihn.",
    examples: [{ de: "Kennst du mich?", ru: "Ты знаешь меня?" }],
  },
  {
    id: "anrufen", label: "anrufen + Akk", infinitive: "anrufen", prep: null, case: "acc",
    meaning: "звонить кому-то", level: "A1", topics: ["Akkusativ", "отделяемые приставки"], reflexive: false, prefix: "an",
    present: f("rufe", "rufst", "ruft", "rufen", "ruft", "rufen"), ruPresent: f("звоню", "звонишь", "звонит", "звоним", "звоните", "звонят"), ruInf: "позвонить",
    ruGov: "dat",
    fillers: [{ de: "Arzt", gender: "m", det: "def", ru: "врачу" }, { de: "Oma", gender: "f", det: "def", ru: "бабушке" }],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["zu", "mit"],
    note: "Позвонить кому-то → jemanden anrufen: по-русски «кому», по-немецки Akkusativ без предлога; an — приставка, она уходит в конец.",
    examples: [{ de: "Ich rufe dich an.", ru: "Я звоню тебе." }],
  },
  {
    id: "einladen", label: "einladen + Akk", infinitive: "einladen", prep: null, case: "acc",
    meaning: "приглашать", level: "A1", topics: ["Akkusativ", "отделяемые приставки"], reflexive: false, prefix: "ein",
    present: f("lade", "lädst", "lädt", "laden", "ladet", "laden"), ruPresent: f("приглашаю", "приглашаешь", "приглашает", "приглашаем", "приглашаете", "приглашают"), ruInf: "пригласить",
    ruGov: "acc",
    fillers: [{ de: "Freundin", gender: "f", det: "def", ru: "подругу" }, { de: "Lehrer", gender: "m", det: "def", ru: "учителя" }],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["zu", "für"],
    note: "einladen — без предлога: Ich lade dich ein. Приставка ein уходит в конец.",
    examples: [{ de: "Wir laden euch ein.", ru: "Мы приглашаем вас." }],
  },
  {
    id: "helfen", label: "helfen + Dat", infinitive: "helfen", prep: null, case: "dat",
    meaning: "помогать кому-то", level: "A1", topics: ["Dativ"], reflexive: false, prefix: null,
    present: f("helfe", "hilfst", "hilft", "helfen", "helft", "helfen"), ruPresent: f("помогаю", "помогаешь", "помогает", "помогаем", "помогаете", "помогают"), ruInf: "помочь",
    ruGov: "dat",
    fillers: [{ de: "Mutter", gender: "f", det: "def", ru: "маме" }, { de: "Freund", gender: "m", det: "def", ru: "другу" }, { de: "Kind", gender: "n", det: "def", ru: "ребёнку" }],
    sentenceTypes: ["statement", "question", "negation"], modal: true, confusable: ["mit", "für"],
    note: "helfen — без предлога, но с Dativ: Ich helfe dir, Ich helfe der Mutter.",
    examples: [{ de: "Ich helfe dir.", ru: "Я помогаю тебе." }],
  },
];

export const COMBO_BY_ID: Record<string, Combo> = Object.fromEntries(COMBOS.map((c) => [c.id, c]));

export const VP_PREPOSITIONS = [...new Set(COMBOS.map((c) => c.prep).filter((p): p is string => Boolean(p)))];

/** The quick keyboard: the same prepositions every time, and «без предлога». */
export const QUICK_PREPS = ["auf", "an", "über", "um", "für", "mit", "nach", "von"];

// ─── Settings ────────────────────────────────────────────────────────────────

export const SENTENCE_TYPES = ["statement", "question", "negation"] as const;
export type SentenceType = typeof SENTENCE_TYPES[number];
export const SENTENCE_LABEL: Record<SentenceType, string> = { statement: "Утверждения", question: "Вопросы", negation: "Отрицания" };

export type VPConfig = {
  version: 1;
  /** learned: the learner's «изученные сочетания»; manual: the hand-picked list. */
  selection: "learned" | "manual";
  learned: string[];
  manual: string[];
  /** Real combinations with these prepositions; [] = all. */
  prepositions: string[];
  cases: ("acc" | "dat")[];
  include_no_prep: boolean;
  reflexive: boolean;
  separable: boolean;
  modal: boolean;
  sentence_types: SentenceType[];
  objects: ("pronoun" | "noun")[];
  mode: Mode | "mixed";
  /** 0 = endless. */
  set_size: number;
};

/** The starting point: warten auf and the familiar verbs without a preposition. Nothing else is declared learned. */
export const VP_DEFAULT: VPConfig = {
  version: 1,
  selection: "learned",
  learned: ["warten_auf", "sehen", "hoeren", "suchen", "brauchen", "besuchen", "fragen", "kennen"],
  manual: [],
  prepositions: [],
  cases: ["acc", "dat"],
  include_no_prep: true,
  reflexive: false,
  separable: false,
  modal: false,
  sentence_types: ["statement", "question", "negation"],
  objects: ["pronoun", "noun"],
  mode: "build",
  set_size: 0,
};

/** The combinations a config draws from, and — when none are left — why. */
export function vpPool(config: VPConfig): { combos: Combo[]; reasons: string[] } {
  const ids = config.selection === "learned" ? config.learned : config.manual;
  let pool = COMBOS.filter((c) => ids.includes(c.id));
  const reasons: string[] = [];
  const step = (next: Combo[], why: string) => {
    if (pool.length && !next.length) reasons.push(why);
    pool = next;
  };
  if (pool.length === 0) reasons.push(config.selection === "learned" ? "Нет изученных сочетаний: отметьте хотя бы одно в каталоге." : "В ручном выборе нет ни одного сочетания.");
  step(pool.filter((c) => config.include_no_prep || c.prep !== null), "Выбраны только конструкции без предлога, а они выключены.");
  if (config.prepositions.length) {
    step(pool.filter((c) => c.prep === null || config.prepositions.includes(c.prep)),
      `Среди выбранных сочетаний нет глаголов с предлогом ${config.prepositions.map((p) => `«${p}»`).join(", ")}. Отметьте такие сочетания в каталоге — предлог не подставляется к другим глаголам.`);
  }
  step(pool.filter((c) => config.cases.includes(c.case)), "Нет сочетаний с выбранным падежом.");
  step(pool.filter((c) => config.reflexive || !c.reflexive), "Остались только возвратные глаголы, а они выключены.");
  step(pool.filter((c) => config.separable || !c.prefix), "Остались только отделяемые глаголы, а они выключены.");
  step(pool.filter((c) => vpSpecs(c, config).length > 0), "С выбранными типами предложений и видом дополнения из этих сочетаний не получается ни одного задания (например, отрицание с существительным без предлога не используется).");
  return { combos: pool, reasons };
}

// ─── Specs ───────────────────────────────────────────────────────────────────

export type VPSpec = {
  combo: string;
  sentenceType: SentenceType;
  modal: boolean;
  subject: PersonId;
  /** The main object: a person pronoun or a filler index. */
  object: PersonId | null;
  filler: number | null;
  /** bitten / danken: the person before the prepositional object. */
  personPron: PersonId | null;
  personFiller: number | null;
};

export function vpSpecs(combo: Combo, config: Pick<VPConfig, "sentence_types" | "objects" | "modal">): VPSpec[] {
  const specs: VPSpec[] = [];
  for (const sentenceType of combo.sentenceTypes.filter((t) => config.sentence_types.includes(t))) {
    for (const modal of combo.modal && config.modal ? [false, true] : [false]) {
      for (const subject of SUBJECTS) {
        const base = { combo: combo.id, sentenceType, modal, subject, object: null, filler: null, personPron: null, personFiller: null };
        if (combo.person) {
          // The prepositional object is always a noun; the setting decides the person.
          combo.fillers.forEach((_, fi) => {
            if (config.objects.includes("pronoun")) {
              for (const p of OBJECTS) if (naturalPair(subject, p)) specs.push({ ...base, filler: fi, personPron: p });
            }
            if (config.objects.includes("noun")) combo.person!.fillers.forEach((_, pi) => specs.push({ ...base, filler: fi, personFiller: pi }));
          });
          continue;
        }
        if (config.objects.includes("pronoun") && combo.ruGov) {
          for (const o of OBJECTS) if (naturalPair(subject, o)) specs.push({ ...base, object: o });
        }
        if (config.objects.includes("noun")) {
          // A noun object without a preposition with «nicht» could just as well be «kein…»: not asked.
          if (sentenceType === "negation" && !combo.prep) continue;
          combo.fillers.forEach((_, fi) => specs.push({ ...base, filler: fi }));
        }
      }
    }
  }
  return specs;
}

// ─── Building the sentence ───────────────────────────────────────────────────

function nounPhrase(filler: Filler, kase: Case, family: "der" | "ein" | null): Tok[] {
  if (filler.det === "none" || !family) return [{ text: filler.de, role: "NOUN" }];
  const d = determiner(family, filler.gender, kase)!;
  return [{ text: d, role: "DET", det: { family, gender: filler.gender, case: kase, noun: filler.de } }, { text: filler.de, role: "NOUN" }];
}

function familyOf(filler: Filler): "der" | "ein" | null {
  return filler.det === "def" ? "der" : filler.det === "indef" ? "ein" : null;
}

/** The prepositional phrase, with the dative fusions German writes (am, zum, beim). */
function prepPhrase(prep: string, kase: Case, object: Tok[]): Tok[] {
  const det = object[0]?.role === "DET" ? object[0] : null;
  const fused = det ? contract(prep, det.text) : null;
  if (fused && det) return [{ text: fused, role: "PREP", det: det.det }, ...object.slice(1)];
  return [{ text: prep, role: "PREP" }, ...object];
}

type Built = { tokens: Tok[] };

function build(combo: Combo, spec: VPSpec, prep: string | null, kase: Case, family: "der" | "ein" | null): Built {
  const subj = PEOPLE[spec.subject];
  const finite = spec.modal ? MODAL.de[subj.de] : combo.present[subj.de];
  const S: Tok = { text: subj.nom, role: "S" };
  const V: Tok = { text: finite, role: "V" };
  const head = spec.sentenceType === "question" ? [V, S] : [S, V];
  const refl: Tok[] = combo.reflexive ? [{ text: subj.refl, role: "REFL" }] : [];

  // The person before the prepositional object (bitten, danken).
  let personPart: Tok[] = [];
  if (combo.person) {
    const pc = combo.person.case;
    if (spec.personPron) personPart = [{ text: pc === "acc" ? PEOPLE[spec.personPron].acc : PEOPLE[spec.personPron].dat, role: "OBJ", pron: { person: spec.personPron, case: pc } }];
    else if (spec.personFiller !== null) {
      const pf = combo.person.fillers[spec.personFiller];
      personPart = nounPhrase(pf, pc, familyOf(pf));
    }
  }

  // The main object.
  let objectPart: Tok[];
  if (spec.object) {
    const p = PEOPLE[spec.object];
    objectPart = [{ text: kase === "dat" ? p.dat : p.acc, role: "OBJ", pron: { person: spec.object, case: kase } }];
  } else {
    const filler = combo.fillers[spec.filler!];
    objectPart = nounPhrase(filler, kase, filler.det === "none" ? null : family);
  }
  const main = prep ? prepPhrase(prep, kase, objectPart) : objectPart;

  const nicht: Tok[] = spec.sentenceType === "negation" ? [{ text: "nicht", role: "NICHT" }] : [];
  // nicht: after a pronoun object without a preposition, before a prepositional phrase.
  const middle = prep ? [...personPart, ...nicht, ...main] : [...personPart, ...main, ...nicht];
  const tail: Tok[] = spec.modal ? [{ text: combo.infinitive, role: "INF" }] : combo.prefix ? [{ text: combo.prefix, role: "PREFIX" }] : [];
  return { tokens: [...head, ...refl, ...middle, ...tail] };
}

function variantsFor(combo: Combo, spec: VPSpec): Variant[] {
  const filler = spec.filler !== null ? combo.fillers[spec.filler] : null;
  const family = filler ? familyOf(filler) : null;
  const out: Variant[] = [{ tokens: build(combo, spec, combo.prep, combo.case, family).tokens, note: null }];
  // Russian has no articles: «автобус» is den Bus or einen Bus alike, unless the phrase is fixed.
  if (filler && family && !filler.fixed) {
    out.push({ tokens: build(combo, spec, combo.prep, combo.case, family === "der" ? "ein" : "der").tokens, note: null });
  }
  for (const alt of combo.alternatives ?? []) {
    out.push({ tokens: build(combo, spec, alt.prep, alt.case, family).tokens, note: alt.note });
  }
  return out;
}

function russian(combo: Combo, spec: VPSpec): { text: string; notes: string[] } {
  const subj = PEOPLE[spec.subject];
  const ne = spec.sentenceType === "negation" ? "не " : "";
  const verb = spec.modal ? `${ne}${MODAL.ru[subj.ru]} ${combo.ruInf}` : `${ne}${combo.ruPresent[subj.ru]}`;
  let person = "";
  if (combo.person) {
    person = spec.personPron ? PEOPLE[spec.personPron].ruObj[combo.person.ruGov] : combo.person.fillers[spec.personFiller!].ru;
  }
  const object = spec.object ? PEOPLE[spec.object].ruObj[combo.ruGov!] : combo.fillers[spec.filler!].ru;
  const body = [subj.ruNom, verb, person, object].filter(Boolean).join(" ");
  const text = `${cap(body)}${spec.sentenceType === "question" ? "?" : "."}`;
  const objectRu = spec.object ? PEOPLE[spec.object].ruObj[combo.ruGov!] : spec.personPron ? PEOPLE[spec.personPron].ruObj[combo.person!.ruGov] : null;
  const objectId = spec.object ?? spec.personPron;
  return { text, notes: personNotes(spec.subject, objectId, objectRu) };
}

function lexicon(combo: Combo, variants: Variant[]) {
  const verbs = new Set<string>();
  for (const form of [...Object.values(combo.present), ...Object.values(MODAL.de), combo.infinitive, combo.prefix ? `${combo.prefix}${combo.present["1p"]}` : ""]) if (form) verbs.add(fold(form));
  // Other verbs of the catalogue: «Ich warte» for «Ich sehe» is a wrong verb, not an unknown word.
  for (const c of COMBOS) for (const form of Object.values(c.present)) verbs.add(fold(form));
  const nouns = new Set<string>();
  for (const fl of [...combo.fillers, ...(combo.person?.fillers ?? [])]) nouns.add(fold(fl.de));
  const words = new Set<string>(["nicht"]);
  for (const v of variants) for (const t of v.tokens) words.add(fold(t.text));
  if (combo.prefix) words.add(fold(combo.prefix));
  return { verbs: [...verbs], nouns: [...nouns], words: [...words] };
}

function caseLine(kase: Case): string {
  return kase === "dat" ? "Dativ: mir · dir · ihm · ihr · uns · euch · ihnen; dem / der / dem" : "Akkusativ: mich · dich · ihn · sie · uns · euch · sie; den / die / das";
}

function explainFor(combo: Combo, spec: VPSpec, expected: string): GrammarTask["explain_for"] {
  const subj = PEOPLE[spec.subject];
  const government = combo.prep ? `${combo.label}: ${combo.note}` : combo.note;
  return {
    wrong_preposition: government,
    missing_preposition: government,
    extra_preposition: government,
    case: combo.prep ? `После ${combo.prep} в сочетании «${combo.label}» — ${combo.case === "dat" ? "Dativ" : "Akkusativ"}. ${caseLine(combo.case)}.` : `${combo.infinitive} — ${combo.case === "dat" ? "Dativ" : "Akkusativ"}. ${caseLine(combo.case)}.`,
    conjugation: spec.modal ? `${subj.nom} → ${MODAL.de[subj.de]} … ${combo.infinitive}` : `${subj.nom} → ${combo.present[subj.de]}${combo.prefix ? ` … ${combo.prefix}` : ""}`,
    reflexive: `${combo.infinitive} — возвратный глагол: ${subj.nom} … ${subj.refl}.`,
    separable_prefix: combo.prefix ? `${combo.prefix}${combo.present["1p"]}: приставка ${combo.prefix} отделяется и уходит в конец${spec.modal ? "; после модального глагола инфинитив пишется слитно" : ""}.` : undefined,
    word_order: `Правильный порядок: ${expected}`,
    negation: combo.prep ? "nicht стоит перед предлогом: … nicht auf dich." : "nicht стоит после местоимения-дополнения: … dich nicht.",
  };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function quickSpec(variant: Variant, combo: Combo, spec: VPSpec): QuickSpec {
  const tokens = variant.tokens.flatMap((t): Tok[] => {
    if (t.role === "PREP" && t.det) {
      // am → an + dem: the gap is the preposition alone.
      const article = determiner(t.det.family, t.det.gender, t.det.case)!;
      return [{ text: combo.prep!, role: "PREP" }, { text: article, role: "DET", det: t.det }];
    }
    return [t];
  });
  const frame: QuickSpec["frame"] = [];
  let gapToken: Tok;
  const prepIndex = tokens.findIndex((t) => t.role === "PREP");
  // Where a preposition would stand: before the main object (the last object phrase).
  let at = prepIndex;
  if (at < 0) {
    const lastObj = tokens.map((t, i) => ((t.role === "OBJ" || t.role === "DET" || t.role === "NOUN") ? i : -1)).filter((i) => i >= 0);
    // The main object is the last object phrase; its first word starts at a DET or OBJ.
    let start = lastObj[lastObj.length - 1];
    while (start > 0 && (tokens[start - 1].role === "DET") && tokens[start].role === "NOUN") start--;
    at = start;
    gapToken = { text: "—", role: "PREP" };
  } else gapToken = tokens[prepIndex];
  tokens.forEach((t, i) => {
    if (i === at) frame.push({ gap: 0 });
    if (i === prepIndex) return;
    frame.push({ text: i === 0 ? cap(t.text) : t.text });
  });
  endWith(frame, spec.sentenceType === "question" ? "?" : ".");
  return {
    frame,
    gaps: [{ accepted: [prepIndex >= 0 ? combo.prep! : "—"], token: gapToken }],
    keys: [QUICK_PREPS, ["—"]],
    instruction: ["Нужен ли предлог — и какой?"],
  };
}

/** The final mark joins the last word, «Vater.», never a word of its own. */
export function endWith(frame: QuickSpec["frame"], mark: string) {
  const last = frame[frame.length - 1];
  if (last && "text" in last) last.text += mark;
  else frame.push({ text: mark });
}

function bank(variant: Variant, combo: Combo, random: () => number): string[] {
  // Fused forms are offered as their two words: the choice of preposition stays visible.
  const words = variant.tokens.flatMap((t) => {
    if (t.role === "PREP" && t.det) return [combo.prep!, determiner(t.det.family, t.det.gender, t.det.case)!];
    return [t.text];
  });
  // Always two prepositions on the buttons, needed or not, so their presence gives nothing away.
  const wrongPreps = shuffle(combo.confusable.filter((p) => !words.includes(p)), random).slice(0, combo.prep ? 1 : 2);
  const extra: string[] = [...wrongPreps];
  // The object in the other case: dich / dir, den / dem.
  const obj = variant.tokens.find((t) => t.role === "OBJ" && t.pron);
  if (obj?.pron) {
    const p = PEOPLE[obj.pron.person as PersonId];
    const other = obj.pron.case === "dat" ? p.acc : p.dat;
    if (other !== obj.text && !words.includes(other)) extra.push(other);
  }
  const det = variant.tokens.find((t) => t.det);
  if (det?.det) {
    const other = determiner(det.det.family, det.det.gender, det.det.case === "dat" ? "acc" : "dat");
    const shown = det.role === "PREP" ? determiner(det.det.family, det.det.gender, det.det.case) : det.text;
    if (other && other !== shown && !words.includes(other)) extra.push(other);
  }
  return shuffle([...words, ...extra], random);
}

export function vpTask(spec: VPSpec, mode: Mode, opts: { id: string; random: () => number; repeatOf?: string | null; delayed?: boolean }): GrammarTask {
  const combo = COMBO_BY_ID[spec.combo];
  const variants = variantsFor(combo, spec);
  const question = spec.sentenceType === "question";
  const expected = sentenceText(variants[0], question);
  const ru = russian(combo, spec);
  const filler = spec.filler !== null ? combo.fillers[spec.filler] : null;
  const personFiller = combo.person && spec.personFiller !== null ? combo.person.fillers[spec.personFiller] : null;
  const hintWords = [personFiller, filler].filter((x): x is Filler => Boolean(x))
    .map((fl) => (fl.det === "none" ? fl.de : `${fl.gender === "m" ? "der" : fl.gender === "f" ? "die" : fl.gender === "n" ? "das" : "die"} ${fl.de}`));
  const explain = [
    `${combo.label} — ${combo.meaning}.`,
    combo.note,
    ...(combo.contrast ? [combo.contrast] : []),
    ...combo.examples.map((e) => `${e.de} — ${e.ru}`),
  ];
  return {
    id: opts.id,
    trainer: "verb_prepositions",
    template_version: VP_TEMPLATE,
    mode,
    key: `vp:${combo.id}`,
    key_label: combo.label,
    prompt_ru: ru.text,
    notes_ru: ru.notes,
    word_hint: hintWords.length ? `Слова: ${hintWords.join(", ")}` : null,
    expected,
    variants,
    quick: mode === "quick" ? quickSpec(variants[0], combo, spec) : null,
    bank: mode === "build" ? bank(variants[0], combo, opts.random) : null,
    lexicon: lexicon(combo, variants),
    explain_for: explainFor(combo, spec, expected),
    explain,
    meta: {
      combo: combo.id,
      combo_label: combo.label,
      preposition: combo.prep,
      case: combo.case,
      level: combo.level,
      sentence_type: spec.sentenceType,
      modal: spec.modal,
      reflexive: combo.reflexive,
      separable: Boolean(combo.prefix),
      subject: spec.subject,
      object: spec.object ?? spec.personPron,
      object_kind: spec.object || spec.personPron ? "pronoun" : "noun",
      noun: filler?.de ?? null,
      with_preposition: combo.prep !== null,
    },
    repeat_of: opts.repeatOf ?? null,
    delayed_review: opts.delayed ?? false,
  };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/** forceDue: the first task is the first due key (planTasks spaces them out itself). */
export type PlanInput = { config: VPConfig; mode: Mode; count: number; seed: number; newId: () => string; due?: string[]; forceDue?: boolean; avoidCombo?: string | null };

/** The next tasks: no combination twice in a row, prepositions and no-preposition verbs mixed, earlier difficulties brought back. */
export function vpPlan(input: PlanInput): GrammarTask[] {
  const random = rng(input.seed);
  const { combos } = vpPool(input.config);
  if (!combos.length) return [];
  const specsBy = new Map(combos.map((c) => [c.id, vpSpecs(c, input.config)]));
  const withPrep = combos.filter((c) => c.prep);
  const noPrep = combos.filter((c) => !c.prep);
  const due = (input.due ?? []).map((k) => k.replace(/^vp:/, "")).filter((id) => specsBy.has(id));
  const tasks: GrammarTask[] = [];
  let last = input.avoidCombo ?? null;
  for (let i = 0; i < input.count; i++) {
    const dueId = (input.forceDue ? i === 0 : i % 3 === 1) ? due.shift() : undefined;
    let combo: Combo;
    if (dueId) combo = COMBO_BY_ID[dueId];
    else {
      // About a third without a preposition when both kinds are on.
      const side = withPrep.length && noPrep.length ? (random() < 0.35 ? noPrep : withPrep) : withPrep.length ? withPrep : noPrep;
      let options = side.filter((c) => c.id !== last);
      // Only one combination on this side and it was just asked: take the other side rather than repeat it.
      if (!options.length) options = (side === withPrep ? noPrep : withPrep).filter((c) => c.id !== last);
      if (!options.length) options = side;
      combo = pickWeighted(options, options.map(() => 1), random);
    }
    const spec = pickOne(specsBy.get(combo.id)!, random);
    tasks.push(vpTask(spec, input.mode, { id: input.newId(), random, delayed: Boolean(dueId) }));
    last = combo.id;
  }
  return tasks;
}

/** After an error: the same combination with other words, a few tasks later. */
export function vpRepeat(task: GrammarTask, config: VPConfig, seed: number, newId: () => string): GrammarTask | null {
  const combo = COMBO_BY_ID[String(task.meta.combo)];
  if (!combo) return null;
  const random = rng(seed);
  const specs = vpSpecs(combo, { ...config, sentence_types: combo.sentenceTypes, objects: config.objects.length ? config.objects : ["pronoun", "noun"] })
    .filter((s) => s.subject !== task.meta.subject || (s.object ?? s.personPron) !== task.meta.object);
  if (!specs.length) return null;
  return vpTask(pickOne(specs, random), task.mode, { id: newId(), random, repeatOf: task.id });
}

export function vpCatalogue() {
  return COMBOS.map((c) => ({
    id: c.id, label: c.label, verb: c.infinitive, preposition: c.prep, case: c.case === "dat" ? "Dativ" : "Akkusativ",
    meaning: c.meaning, level: c.level, topics: c.topics, reflexive: c.reflexive, separable_prefix: c.prefix,
    with_modal: c.modal, sentence_types: c.sentenceTypes, person_objects: Boolean(c.ruGov || c.person),
    noun_objects: c.fillers.map((fl) => fl.de), also_correct: (c.alternatives ?? []).map((a) => `${a.prep} + ${a.case === "dat" ? "Dativ" : "Akkusativ"}`),
    note: c.note, contrast: c.contrast ?? null, examples: c.examples,
  }));
}
