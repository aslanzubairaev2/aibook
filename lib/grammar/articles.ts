// «Артикли и падежи»: the form of an article or possessive in a sentence.
//
// Each frame is a short, natural sentence with one or two noun slots; a slot
// says its case, which nouns fit it, and which determiner families make sense
// there («Wo ist ein Tisch?» does not, so «ein» is not offered for it). The
// Russian prompt is built from the same choice — «Мне нужен твой ноутбук»,
// «Я еду на своей машине» — so it always says one thing. Where Russian cannot
// tell der from ein («Я покупаю стол»), both are accepted; where the task needs
// one family, it says so in words («Используй ein»).
//
// Dativ comes in blocks: mit, bei and zu first; verbs with Dativ and «geben /
// schenken» only when switched on — never just because Dativ is on.

import {
  CASE_LABEL,
  CONTRACTIONS,
  GENDER_ARTICLE,
  GENDER_LABEL,
  PEOPLE,
  POSSESSIVES,
  cap,
  contract,
  determiner,
  familyForms,
  fold,
  pickOne,
  rng,
  ruPossessive,
  shuffle,
  type Case,
  type Family,
  type Gender,
  type PersonId,
} from "./common";
import { NOUNS, NOUN_BY_ID, nounForm, nounForms, type Noun, type RuCase } from "./nouns";
import type { PersonKey } from "@/lib/pronouns/catalog";
import { endWith } from "./verbPrepositions";
import { sentenceText, type GrammarTask, type Mode, type QuickSpec, type Tok, type Variant } from "./task";

export const ART_TEMPLATE = "art-v1";

export const BLOCKS = ["nom", "acc", "dat_mit", "dat_bei", "dat_zu", "dat_verbs", "dat_give"] as const;
export type Block = typeof BLOCKS[number];
export const BLOCK_LABEL: Record<Block, string> = {
  nom: "Nominativ: Das ist… / Wo ist…",
  acc: "Akkusativ: brauchen, kaufen, suchen, haben, sehen",
  dat_mit: "Dativ с mit",
  dat_bei: "Dativ с bei",
  dat_zu: "Dativ с zu",
  dat_verbs: "Глаголы с Dativ: helfen, danken",
  dat_give: "Dativ + Akkusativ: geben, schenken",
};
export const DATIVE_BLOCKS: Block[] = ["dat_mit", "dat_bei", "dat_zu", "dat_verbs", "dat_give"];

type Forms = Record<PersonKey, string>;
function f(a: string, b: string, c: string, d: string, e: string, g: string): Forms {
  return { "1s": a, "2s": b, "3s": c, "1p": d, "2p": e, "3p": g };
}

const VERBS = {
  brauchen: f("brauche", "brauchst", "braucht", "brauchen", "braucht", "brauchen"),
  kaufen: f("kaufe", "kaufst", "kauft", "kaufen", "kauft", "kaufen"),
  suchen: f("suche", "suchst", "sucht", "suchen", "sucht", "suchen"),
  haben: f("habe", "hast", "hat", "haben", "habt", "haben"),
  sehen: f("sehe", "siehst", "sieht", "sehen", "seht", "sehen"),
  fahren: f("fahre", "fährst", "fährt", "fahren", "fahrt", "fahren"),
  sprechen: f("spreche", "sprichst", "spricht", "sprechen", "sprecht", "sprechen"),
  sein: f("bin", "bist", "ist", "sind", "seid", "sind"),
  wohnen: f("wohne", "wohnst", "wohnt", "wohnen", "wohnt", "wohnen"),
  gehen: f("gehe", "gehst", "geht", "gehen", "geht", "gehen"),
  helfen: f("helfe", "hilfst", "hilft", "helfen", "helft", "helfen"),
  danken: f("danke", "dankst", "dankt", "danken", "dankt", "danken"),
  geben: f("gebe", "gibst", "gibt", "geben", "gebt", "geben"),
  schenken: f("schenke", "schenkst", "schenkt", "schenken", "schenkt", "schenken"),
};
const RU = {
  kaufen: f("покупаю", "покупаешь", "покупает", "покупаем", "покупаете", "покупают"),
  suchen: f("ищу", "ищешь", "ищет", "ищем", "ищете", "ищут"),
  sehen: f("вижу", "видишь", "видит", "видим", "видите", "видят"),
  fahren: f("еду", "едешь", "едет", "едем", "едете", "едут"),
  sprechen: f("говорю", "говоришь", "говорит", "говорим", "говорите", "говорят"),
  wohnen: f("живу", "живёшь", "живёт", "живём", "живёте", "живут"),
  gehen: f("иду", "идёшь", "идёт", "идём", "идёте", "идут"),
  helfen: f("помогаю", "помогаешь", "помогает", "помогаем", "помогаете", "помогают"),
  danken: f("благодарю", "благодаришь", "благодарит", "благодарим", "благодарите", "благодарят"),
  geben: f("даю", "даёшь", "даёт", "даём", "даёте", "дают"),
  schenken: f("дарю", "даришь", "дарит", "дарим", "дарите", "дарят"),
};

const SUBJECTS: PersonId[] = ["ich", "du", "er", "sie_sg", "wir"];

type SlotDef = {
  case: Case;
  kinds: Noun["kind"][];
  families: Family[];
  plural: boolean;
  /** The preposition before the slot, fused with der-forms where German fuses (zum, zur, beim). */
  prep?: "mit" | "bei" | "zu";
  /** How Russian says this noun here. «to»: the place phrase («в школу»). */
  ru: RuCase | "to";
  /** «Я ищу свой ключ»: may the owner be the subject itself? */
  selfOwner: boolean;
  /** Nouns this slot never takes, though their kind fits. */
  except?: string[];
  /** Or: the only nouns that make sense here (what one gives as a present). */
  only?: string[];
  /** Determiners allowed in the plural, where Russian could also mean a plural without any («Это дети» — Kinder or die Kinder). */
  pluralFamilies?: Family[];
};

export type FrameDef = {
  id: string;
  block: Block;
  label: string;
  example: { de: string; ru: string };
  subjects: PersonId[] | null;
  slots: SlotDef[];
  /** The German words around the noun phrases: S/V and fixed words, NP0/NP1 where the slots go. */
  de: (subject: PersonId | null, plural0: boolean) => (string | Tok)[];
  ru: (subject: PersonId | null, np: RuNP[], negative: boolean) => string;
  /** Which explanation of the case belongs to this frame. */
  why: string;
};

type RuNP = { text: (kase: RuCase) => string; gender: Gender; noun: Noun; plural: boolean };

const SV = (verb: keyof typeof VERBS) => (s: PersonId | null): (string | Tok)[] => [
  { text: PEOPLE[s!].nom, role: "S" }, { text: VERBS[verb][PEOPLE[s!].de], role: "V" },
];

function ruSV(verb: keyof typeof RU, s: PersonId): string {
  return `${PEOPLE[s].ruNom} ${RU[verb][PEOPLE[s].ru]}`;
}

const NEED: Record<Gender, string> = { m: "нужен", f: "нужна", n: "нужно", pl: "нужны" };
const BROKEN: Record<Gender, string> = { m: "сломан", f: "сломана", n: "сломано", pl: "сломаны" };

const THINGS: Noun["kind"][] = ["thing"];
const PEOPLE_KINDS: Noun["kind"][] = ["person"];
const ALL_POSS = POSSESSIVES;

export const FRAMES: FrameDef[] = [
  // ── Nominativ ──
  {
    id: "das_ist", block: "nom", label: "Das ist / Das sind …", example: { de: "Das ist mein Tisch.", ru: "Это мой стол." },
    subjects: null,
    slots: [{ case: "nom", kinds: ["thing", "person", "animal"], families: ["der", "ein", "kein", ...ALL_POSS], plural: true, ru: "nom", selfOwner: false, except: ["eltern"], pluralFamilies: ["kein", ...ALL_POSS] }],
    de: (_s, pl) => [{ text: "das", role: "FIX" }, { text: pl ? "sind" : "ist", role: "V" }, "NP0"],
    ru: (_s, np, neg) => `Это ${neg ? "не " : ""}${np[0].text("nom")}.`,
    why: "Das ist … — кто или что это: Nominativ.",
  },
  {
    id: "wo_ist", block: "nom", label: "Wo ist / Wo sind …?", example: { de: "Wo ist der Schlüssel?", ru: "Где ключ?" },
    subjects: null,
    slots: [{ case: "nom", kinds: ["thing", "person", "animal"], families: ["der", ...ALL_POSS], plural: true, ru: "nom", selfOwner: false }],
    de: (_s, pl) => [{ text: "wo", role: "FIX" }, { text: pl ? "sind" : "ist", role: "V" }, "NP0"],
    ru: (_s, np) => `Где ${np[0].text("nom")}?`,
    why: "Wo ist …? — о ком или о чём спрашивают, это подлежащее: Nominativ.",
  },
  {
    id: "kaputt", block: "nom", label: "… ist kaputt", example: { de: "Der Drucker ist kaputt.", ru: "Принтер сломан." },
    subjects: null,
    slots: [{ case: "nom", kinds: THINGS, families: ["der", ...ALL_POSS], plural: true, ru: "nom", selfOwner: false, except: ["wohnung", "zimmer", "fenster", "geschenk"] }],
    de: (_s, pl) => ["NP0", { text: pl ? "sind" : "ist", role: "V" }, { text: "kaputt", role: "FIX" }],
    ru: (_s, np) => `${cap(np[0].text("nom"))} ${BROKEN[np[0].gender]}.`,
    why: "Что сломано — подлежащее: Nominativ.",
  },
  // ── Akkusativ ──
  {
    id: "brauchen", block: "acc", label: "brauchen + Akk", example: { de: "Ich brauche einen Drucker.", ru: "Мне нужен принтер." },
    subjects: SUBJECTS,
    slots: [{ case: "acc", kinds: THINGS, families: ["der", "ein", "kein", ...ALL_POSS], plural: false, ru: "nom", selfOwner: false, except: ["wohnung", "zimmer", "fenster"] }],
    de: SV("brauchen"),
    ru: (s, np, neg) => `${cap(PEOPLE[s!].ruObj.dat)} ${neg ? "не " : ""}${NEED[np[0].gender]} ${np[0].text("nom")}.`,
    why: "brauchen + Akkusativ: что нужно — прямое дополнение. По-русски «мне нужен принтер», по-немецки «я нуждаюсь в»: Ich brauche einen Drucker.",
  },
  {
    id: "kaufen", block: "acc", label: "kaufen + Akk", example: { de: "Ich kaufe einen Tisch.", ru: "Я покупаю стол." },
    subjects: SUBJECTS,
    slots: [{ case: "acc", kinds: THINGS, families: ["der", "ein"], plural: false, ru: "acc", selfOwner: false, except: ["geschenk", "fenster", "zimmer"] }],
    de: SV("kaufen"),
    ru: (s, np) => `${cap(ruSV("kaufen", s!))} ${np[0].text("acc")}.`,
    why: "kaufen + Akkusativ: что покупают — прямое дополнение.",
  },
  {
    id: "suchen", block: "acc", label: "suchen + Akk", example: { de: "Ich suche meinen Schlüssel.", ru: "Я ищу свой ключ." },
    subjects: SUBJECTS,
    slots: [{ case: "acc", kinds: ["thing", "animal", "person"], families: ["der", "ein", ...ALL_POSS], plural: true, ru: "acc", selfOwner: true, pluralFamilies: ALL_POSS }],
    de: SV("suchen"),
    ru: (s, np) => `${cap(ruSV("suchen", s!))} ${np[0].text("acc")}.`,
    why: "suchen + Akkusativ: кого или что ищут — прямое дополнение.",
  },
  {
    id: "haben", block: "acc", label: "haben + Akk", example: { de: "Ich habe keinen Hund.", ru: "У меня нет собаки." },
    subjects: SUBJECTS,
    slots: [{ case: "acc", kinds: ["thing", "animal", "person"], families: ["ein", "kein"], plural: true, ru: "nom", selfOwner: false, except: ["fenster", "geschenk", "lehrer", "lehrerin", "arzt", "eltern", "oma", "opa", "mutter", "vater", "freundin", "freund"] }],
    de: SV("haben"),
    ru: (s, np, neg) => (neg ? `${cap(PEOPLE[s!].ruObj.u_gen)} нет ${np[0].text("gen")}.` : `${cap(PEOPLE[s!].ruObj.u_gen)} есть ${np[0].text("nom")}.`),
    why: "haben + Akkusativ: что есть у кого-то — прямое дополнение (по-русски «у меня есть»).",
  },
  {
    id: "sehen", block: "acc", label: "sehen + Akk", example: { de: "Ich sehe den Bus.", ru: "Я вижу автобус." },
    subjects: SUBJECTS,
    slots: [{ case: "acc", kinds: ["person", "animal", "vehicle", "thing"], families: ["der", "ein", ...ALL_POSS], plural: true, ru: "acc", selfOwner: true, pluralFamilies: ALL_POSS }],
    de: SV("sehen"),
    ru: (s, np) => `${cap(ruSV("sehen", s!))} ${np[0].text("acc")}.`,
    why: "sehen + Akkusativ: кого или что видят — прямое дополнение.",
  },
  {
    id: "sucht2", block: "acc", label: "… sucht … (Nominativ + Akkusativ)", example: { de: "Mein Bruder sucht den Schlüssel.", ru: "Мой брат ищет ключ." },
    subjects: null,
    slots: [
      { case: "nom", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: true, ru: "nom", selfOwner: false, except: ["eltern"] },
      { case: "acc", kinds: THINGS, families: ["der", "ein"], plural: false, ru: "acc", selfOwner: false },
    ],
    de: (_s, pl) => ["NP0", { text: pl ? "suchen" : "sucht", role: "V" }, "NP1"],
    ru: (_s, np) => `${cap(np[0].text("nom"))} ${np[0].plural ? "ищут" : "ищет"} ${np[1].text("acc")}.`,
    why: "Кто ищет — подлежащее, Nominativ; что ищут — дополнение, Akkusativ. Падеж решает роль слова, а не его место.",
  },
  // ── Dativ: mit ──
  {
    id: "mit_fahren", block: "dat_mit", label: "fahren mit + Dat", example: { de: "Ich fahre mit dem Bus.", ru: "Я еду на автобусе." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: ["vehicle"], families: ["der", ...ALL_POSS], plural: false, prep: "mit", ru: "pre", selfOwner: true }],
    de: SV("fahren"),
    ru: (s, np) => `${cap(ruSV("fahren", s!))} на ${np[0].text("pre")}.`,
    why: "mit + Dativ: mit dem Bus, mit der Straßenbahn. Русское «на автобусе» не меняет немецкий падеж.",
  },
  {
    id: "mit_sprechen", block: "dat_mit", label: "sprechen mit + Dat", example: { de: "Ich spreche mit meiner Schwester.", ru: "Я говорю со своей сестрой." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: PEOPLE_KINDS, families: ["der", "ein", ...ALL_POSS], plural: true, prep: "mit", ru: "ins", selfOwner: true }],
    de: SV("sprechen"),
    ru: (s, np) => { const w = np[0].text("ins"); return `${cap(ruSV("sprechen", s!))} ${/^(св|мн)/.test(w) ? "со" : "с"} ${w}.`; },
    why: "mit + Dativ: mit dem Lehrer, mit der Mutter, mit den Kindern.",
  },
  // ── Dativ: bei ──
  {
    id: "bei_sein", block: "dat_bei", label: "sein bei + Dat", example: { de: "Ich bin beim Arzt.", ru: "Я у врача." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: true, prep: "bei", ru: "gen", selfOwner: true, except: ["kind"] }],
    de: SV("sein"),
    ru: (s, np) => `${cap(PEOPLE[s!].ruNom)} у ${np[0].text("gen")}.`,
    why: "bei + Dativ — у кого-то: bei dem → beim Arzt, bei der Oma, bei meinen Eltern.",
  },
  {
    id: "bei_wohnen", block: "dat_bei", label: "wohnen bei + Dat", example: { de: "Ich wohne bei meiner Oma.", ru: "Я живу у своей бабушки." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: PEOPLE_KINDS, families: ALL_POSS, plural: true, prep: "bei", ru: "gen", selfOwner: true, except: ["lehrer", "lehrerin", "arzt", "kind"] }],
    de: SV("wohnen"),
    ru: (s, np) => `${cap(ruSV("wohnen", s!))} у ${np[0].text("gen")}.`,
    why: "bei + Dativ — у кого-то: bei meiner Oma, bei meinen Eltern.",
  },
  // ── Dativ: zu ──
  {
    id: "zu_person", block: "dat_zu", label: "gehen zu + Dat (к кому)", example: { de: "Ich gehe zum Arzt.", ru: "Я иду к врачу." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: true, prep: "zu", ru: "dat", selfOwner: true, except: ["kind"] }],
    de: SV("gehen"),
    ru: (s, np) => `${cap(ruSV("gehen", s!))} к ${np[0].text("dat")}.`,
    why: "zu + Dativ — к кому-то: zu dem → zum Arzt, zu der → zur Oma, zu meinen Eltern.",
  },
  {
    id: "zu_place", block: "dat_zu", label: "gehen zu + Dat (куда)", example: { de: "Ich gehe zur Post.", ru: "Я иду на почту." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: ["place"], families: ["der"], plural: false, prep: "zu", ru: "to", selfOwner: false }],
    de: SV("gehen"),
    ru: (s, np) => `${cap(ruSV("gehen", s!))} ${np[0].text("nom")}.`,
    why: "zu + Dativ: zum Bahnhof, zur Schule. Это не правило «куда? → Akkusativ»: после zu всегда Dativ.",
  },
  {
    id: "mit_zu", block: "dat_zu", label: "fahren mit … zu … (два Dativ)", example: { de: "Ich fahre mit dem Bus zur Schule.", ru: "Я еду на автобусе в школу." },
    subjects: SUBJECTS,
    slots: [
      { case: "dat", kinds: ["vehicle"], families: ["der", ...ALL_POSS], plural: false, prep: "mit", ru: "pre", selfOwner: true },
      { case: "dat", kinds: ["place"], families: ["der"], plural: false, prep: "zu", ru: "to", selfOwner: false },
    ],
    de: SV("fahren"),
    ru: (s, np) => `${cap(ruSV("fahren", s!))} на ${np[0].text("pre")} ${np[1].text("nom")}.`,
    why: "mit + Dativ и zu + Dativ: оба предлога всегда требуют Dativ.",
  },
  // ── Dativ verbs (separate block) ──
  {
    id: "helfen", block: "dat_verbs", label: "helfen + Dat", example: { de: "Ich helfe meiner Mutter.", ru: "Я помогаю своей маме." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: true, ru: "dat", selfOwner: true }],
    de: SV("helfen"),
    ru: (s, np) => `${cap(ruSV("helfen", s!))} ${np[0].text("dat")}.`,
    why: "helfen + Dativ: кому помогают — Dativ, как и по-русски «кому».",
  },
  {
    id: "danken", block: "dat_verbs", label: "danken + Dat", example: { de: "Ich danke dem Lehrer.", ru: "Я благодарю учителя." },
    subjects: SUBJECTS,
    slots: [{ case: "dat", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: true, ru: "acc", selfOwner: true }],
    de: SV("danken"),
    ru: (s, np) => `${cap(ruSV("danken", s!))} ${np[0].text("acc")}.`,
    why: "danken + Dativ: по-русски «благодарить кого» (винительный), по-немецки — Dativ.",
  },
  // ── Dativ + Akkusativ (separate block) ──
  {
    id: "geben", block: "dat_give", label: "geben + Dat + Akk", example: { de: "Ich gebe dem Kind einen Ball.", ru: "Я даю ребёнку мяч." },
    subjects: SUBJECTS,
    slots: [
      { case: "dat", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: false, ru: "dat", selfOwner: true },
      { case: "acc", kinds: THINGS, families: ["der", "ein"], plural: false, ru: "acc", selfOwner: false, only: ["buch", "ball", "schluessel", "tasche", "handy", "laptop", "jacke"] },
    ],
    de: SV("geben"),
    ru: (s, np) => `${cap(ruSV("geben", s!))} ${np[0].text("dat")} ${np[1].text("acc")}.`,
    why: "geben: кому — Dativ, что — Akkusativ.",
  },
  {
    id: "schenken", block: "dat_give", label: "schenken + Dat + Akk", example: { de: "Ich schenke meiner Mutter ein Buch.", ru: "Я дарю своей маме книгу." },
    subjects: SUBJECTS,
    slots: [
      { case: "dat", kinds: PEOPLE_KINDS, families: ["der", ...ALL_POSS], plural: false, ru: "dat", selfOwner: true },
      { case: "acc", kinds: THINGS, families: ["ein"], plural: false, ru: "acc", selfOwner: false, only: ["buch", "ball", "tasche", "jacke", "bild", "lampe", "handy"] },
    ],
    de: SV("schenken"),
    ru: (s, np) => `${cap(ruSV("schenken", s!))} ${np[0].text("dat")} ${np[1].text("acc")}.`,
    why: "schenken: кому — Dativ, что — Akkusativ.",
  },
];

export const FRAME_BY_ID: Record<string, FrameDef> = Object.fromEntries(FRAMES.map((fr) => [fr.id, fr]));

// ─── Settings ────────────────────────────────────────────────────────────────

export type ArtConfig = {
  version: 1;
  cases: Case[];
  /** Dativ blocks the learner has covered; used only while Dativ is on. */
  dative_blocks: Block[];
  genders: Gender[];
  families: Family[];
  show_gender: boolean;
  gaps: "one" | "two" | "mixed";
  selection: "learned" | "manual";
  /** Frames marked learned («изученные конструкции»). */
  learned: string[];
  manual: string[];
  mode: Mode | "mixed";
  set_size: number;
};

/** Start: Nominativ + Akkusativ, singular; Dativ (mit, bei, zu) ready but off until the learner turns it on. */
export const ART_DEFAULT: ArtConfig = {
  version: 1,
  cases: ["nom", "acc"],
  dative_blocks: ["dat_mit", "dat_bei", "dat_zu"],
  genders: ["m", "f", "n"],
  families: ["der", "ein", "kein", "mein", "dein"],
  show_gender: true,
  gaps: "one",
  selection: "learned",
  learned: FRAMES.filter((fr) => fr.block !== "dat_verbs" && fr.block !== "dat_give").map((fr) => fr.id),
  manual: [],
  mode: "quick",
  set_size: 0,
};

type SlotOption = { noun: Noun; plural: boolean; family: Family };

function slotOptions(slot: SlotDef, config: Pick<ArtConfig, "genders" | "families">): SlotOption[] {
  const out: SlotOption[] = [];
  for (const noun of NOUNS) {
    if (!slot.kinds.includes(noun.kind) || slot.except?.includes(noun.id)) continue;
    if (slot.only && !slot.only.includes(noun.id)) continue;
    if (slot.ru === "to" && !noun.ruTo) continue;
    for (const plural of slot.plural ? [false, true] : [false]) {
      const g: Gender = plural || noun.gender === "pl" ? "pl" : noun.gender;
      if (!config.genders.includes(g)) continue;
      if (plural && (!noun.plural || !noun.ruPl || noun.gender === "pl")) continue;
      if (!plural && noun.gender === "pl" && !slot.plural) continue;
      for (const family of slot.families) {
        if (!config.families.includes(family)) continue;
        if ((plural || noun.gender === "pl") && slot.pluralFamilies && !slot.pluralFamilies.includes(family)) continue;
        if (noun.noOwner && POSSESSIVES.includes(family)) continue;
        if (!determiner(family, g, slot.case)) continue; // ein has no plural
        out.push({ noun, plural: plural || noun.gender === "pl", family });
      }
    }
  }
  return out;
}

function frameBlocksOn(config: ArtConfig): Set<Block> {
  const on = new Set<Block>();
  if (config.cases.includes("nom")) on.add("nom");
  if (config.cases.includes("acc")) on.add("acc");
  if (config.cases.includes("dat")) for (const b of config.dative_blocks) on.add(b);
  return on;
}

function frameUsable(frame: FrameDef, config: ArtConfig): boolean {
  if (!frame.slots.every((s) => config.cases.includes(s.case))) return false;
  if (config.gaps === "one" && frame.slots.length !== 1) return false;
  if (config.gaps === "two" && frame.slots.length !== 2) return false;
  return frame.slots.every((s) => slotOptions(s, config).length > 0);
}

/** The frames a config draws from, and — when none are left — why. */
export function artPool(config: ArtConfig): { frames: FrameDef[]; reasons: string[] } {
  const ids = config.selection === "learned" ? config.learned : config.manual;
  const reasons: string[] = [];
  const blocks = frameBlocksOn(config);
  let pool = FRAMES.filter((fr) => ids.includes(fr.id));
  const step = (next: FrameDef[], why: string) => { if (pool.length && !next.length) reasons.push(why); pool = next; };
  if (!pool.length) reasons.push(config.selection === "learned" ? "Нет изученных конструкций: отметьте хотя бы одну." : "В ручном выборе нет ни одной конструкции.");
  if (!config.cases.length) reasons.push("Не выбран ни один падеж.");
  if (config.cases.includes("dat") && !config.dative_blocks.length) reasons.push("Для Dativ включите хотя бы один блок: mit, bei или zu.");
  step(pool.filter((fr) => blocks.has(fr.block)), "Выбранные конструкции относятся к выключенным падежам или блокам Dativ.");
  step(pool.filter((fr) => fr.slots.every((s) => config.cases.includes(s.case))), "Нет конструкций только с выбранными падежами.");
  step(pool.filter((fr) => config.gaps === "mixed" || (config.gaps === "one" ? fr.slots.length === 1 : fr.slots.length === 2)),
    config.gaps === "two" ? "Два пропуска есть только в «… sucht …» (Nominativ + Akkusativ), «geben / schenken» (Dativ + Akkusativ) и «mit … zu …» (два Dativ) — включите нужные падежи и блоки." : "Нет конструкций с одним пропуском.");
  const famOnlyEin = config.families.length > 0 && config.families.every((fm) => fm === "ein");
  if (pool.length && famOnlyEin && config.genders.every((g) => g === "pl")) reasons.push("У ein нет формы множественного числа: выберите другой определитель или единственное число.");
  step(pool.filter((fr) => frameUsable(fr, config)), reasons.length ? "" : "С выбранными родами и определителями в этих конструкциях нет ни одного существительного (например, в Wo ist… не бывает ein, а у ein нет множественного числа).");
  return { frames: pool, reasons: reasons.filter(Boolean) };
}

// ─── Specs and tasks ─────────────────────────────────────────────────────────

export type ArtSlotSpec = { noun: string; plural: boolean; family: Family; owner: PersonId | null };
export type ArtSpec = { frame: string; subject: PersonId | null; slots: ArtSlotSpec[] };

const OWNERS: Record<Family, PersonId[]> = {
  der: [], ein: [], kein: [],
  mein: ["ich"], dein: ["du"], sein: ["er"], ihr: ["sie_sg", "sie_pl"], unser: ["wir"], euer: ["ihr"], Ihr: ["Sie"],
};

/** One random task spec from a frame, or null when its slots cannot be filled together. */
export function artSample(frame: FrameDef, config: ArtConfig, random: () => number, want?: { case: Case; gender: Gender; group: string }): ArtSpec | null {
  for (let tries = 0; tries < 30; tries++) {
    const subject = frame.subjects ? pickOne(frame.subjects, random) : null;
    const slots: ArtSlotSpec[] = [];
    let ok = true;
    frame.slots.forEach((slot, i) => {
      if (!ok) return;
      let options = slotOptions(slot, config);
      if (want && i === 0) options = options.filter((o) => slot.case === want.case && genderOf(o) === want.gender && familyGroup(o.family) === want.group);
      // Two slots never share a noun.
      options = options.filter((o) => !slots.some((s) => s.noun === o.noun.id));
      if (!options.length) { ok = false; return; }
      const o = pickOne(options, random);
      let owners = OWNERS[o.family];
      if (!slot.selfOwner && subject) owners = owners.filter((w) => w !== subject);
      // «sie» owning «ihr»: their Russian is «её» / «их»; the subject «sie» would make «свой» — keep it clear.
      if (owners.length === 0 && POSSESSIVES.includes(o.family)) { ok = false; return; }
      slots.push({ noun: o.noun.id, plural: o.plural, family: o.family, owner: owners.length ? pickOne(owners, random) : null });
    });
    if (ok) return { frame: frame.id, subject, slots };
  }
  return null;
}

function genderOf(o: { noun: Noun; plural: boolean }): Gender {
  return o.plural || o.noun.gender === "pl" ? "pl" : o.noun.gender;
}

export function familyGroup(family: Family): string {
  return family === "der" || family === "ein" || family === "kein" ? family : "poss";
}

function ruNP(s: ArtSlotSpec, slot: SlotDef, subject: PersonId | null): RuNP {
  const noun = NOUN_BY_ID[s.noun];
  const ru = s.plural && noun.gender !== "pl" ? noun.ruPl! : noun.ru;
  const possessive = POSSESSIVES.includes(s.family) && s.owner;
  const stem = possessive ? (s.owner === subject ? "свой" : PEOPLE[s.owner!].ruOwn) : null;
  return {
    noun, plural: s.plural, gender: ru.g,
    // A place after zu is said the Russian way as a whole: «в школу», «на почту».
    text: (kase) => (slot.ru === "to" && noun.ruTo ? noun.ruTo : [stem ? ruPossessive(stem, ru.g, kase, ru.anim) : null, ru.f[kase]].filter(Boolean).join(" ")),
  };
}

function npTokens(s: ArtSlotSpec, slot: SlotDef): Tok[] {
  const noun = NOUN_BY_ID[s.noun];
  const g: Gender = s.plural ? "pl" : noun.gender;
  const det = determiner(s.family, g, slot.case)!;
  const nounText = nounForm(noun, s.plural, slot.case);
  const detTok: Tok = { text: det, role: "DET", det: { family: s.family, gender: g, case: slot.case, noun: noun.de } };
  if (!slot.prep) return [detTok, { text: nounText, role: "NOUN" }];
  const fused = contract(slot.prep, det);
  if (fused) return [{ text: fused, role: "PREP", det: detTok.det }, { text: nounText, role: "NOUN" }];
  return [{ text: slot.prep, role: "PREP" }, detTok, { text: nounText, role: "NOUN" }];
}

function tokensFor(frame: FrameDef, spec: ArtSpec, families?: Family[]): Tok[] {
  const slots = spec.slots.map((s, i) => ({ ...s, family: families?.[i] ?? s.family }));
  const parts = frame.de(spec.subject, slots[0].plural);
  const out: Tok[] = [];
  for (const p of parts) {
    if (typeof p !== "string") out.push(p);
    else if (p === "NP0") out.push(...npTokens(slots[0], frame.slots[0]));
    else if (p === "NP1") out.push(...npTokens(slots[1], frame.slots[1]));
  }
  // Frames whose words end with the subject and verb: the noun phrases follow in slot order.
  if (!parts.includes("NP0")) {
    frame.slots.forEach((slot, i) => out.push(...npTokens(slots[i], slot)));
  }
  return out;
}

function nounHint(s: ArtSlotSpec, slot: SlotDef, showGender: boolean): string {
  const noun = NOUN_BY_ID[s.noun];
  const base = noun.gender === "pl" ? `${showGender ? "die " : ""}${noun.de} (мн. ч.)` : `${showGender ? `${GENDER_ARTICLE[noun.gender]} ` : ""}${noun.de}`;
  if (!s.plural || noun.gender === "pl") return base;
  const form = nounForm(noun, true, slot.case);
  return `${base}, мн. ч. ${form}`;
}

function familyInstruction(s: ArtSlotSpec): string {
  return s.family === "der" ? "der / die / das" : s.family;
}

export function artTask(spec: ArtSpec, mode: Mode, config: Pick<ArtConfig, "show_gender">, opts: { id: string; random: () => number; repeatOf?: string | null; delayed?: boolean }): GrammarTask {
  const frame = FRAME_BY_ID[spec.frame];
  const negative = spec.slots.some((s) => s.family === "kein");
  const main: Variant = { tokens: tokensFor(frame, spec), note: null };
  const variants: Variant[] = [main];
  // Russian cannot tell der from ein: where both fit the frame, both are right — unless the task names one (quick mode).
  const swappable = spec.slots.map((s, i) => (s.family === "der" || s.family === "ein") && !s.plural
    && frame.slots[i].families.includes(s.family === "der" ? "ein" : "der") && NOUN_BY_ID[s.noun].gender !== "pl");
  if (mode !== "quick" && swappable.some(Boolean)) {
    const fams = spec.slots.map((s, i) => (swappable[i] ? (s.family === "der" ? "ein" : "der") as Family : s.family));
    variants.push({ tokens: tokensFor(frame, spec, fams), note: null });
    if (spec.slots.length === 2 && swappable.every(Boolean)) {
      variants.push({ tokens: tokensFor(frame, spec, [fams[0], spec.slots[1].family]), note: null });
      variants.push({ tokens: tokensFor(frame, spec, [spec.slots[0].family, fams[1]]), note: null });
    }
  }
  const question = frame.id === "wo_ist";
  const expected = sentenceText(main, question);
  const nps = spec.slots.map((s, i) => ruNP(s, frame.slots[i], spec.subject));
  const prompt = frame.ru(spec.subject, nps, negative);
  const notes: string[] = [];
  for (const s of spec.slots) {
    if (s.family === "kein") notes.push("используй kein");
    if (s.owner === "ihr" && s.family === "euer") notes.push("ваш — несколько друзей");
    if (s.family === "Ihr") notes.push("Ваш — вежливо");
  }
  const hints = spec.slots.map((s, i) => nounHint(s, frame.slots[i], config.show_gender));

  // Quick: the determiners are the gaps; everything else is shown.
  let quick: QuickSpec | null = null;
  if (mode === "quick") {
    const frameParts: QuickSpec["frame"] = [];
    const gaps: QuickSpec["gaps"] = [];
    main.tokens.forEach((t, i) => {
      const shown = (w: string) => (i === 0 ? cap(w) : w);
      if (t.role === "DET" || (t.role === "PREP" && t.det)) {
        if (t.role === "PREP" && t.det) frameParts.push({ text: shown(CONTRACTIONS[fold(t.text)][0]) });
        const form = determiner(t.det!.family, t.det!.gender, t.det!.case)!;
        frameParts.push({ gap: gaps.length });
        gaps.push({ accepted: [form], token: { text: form, role: "DET", det: t.det } });
      } else frameParts.push({ text: shown(t.text) });
    });
    endWith(frameParts, question ? "?" : ".");
    const families = [...new Set(spec.slots.map((s) => s.family))];
    quick = {
      frame: frameParts,
      gaps,
      keys: families.map((fm) => familyForms(fm)),
      instruction: spec.slots.map((s, i) => `Слово: ${hints[i]}. Используй ${familyInstruction(s)}.`),
    };
  }

  // Build: the sentence's words and wrong forms of the same determiners.
  let bank: string[] | null = null;
  if (mode === "build") {
    const words = main.tokens.map((t) => t.text);
    const extra: string[] = [];
    main.tokens.forEach((t) => {
      const d = t.det;
      if (!d) return;
      const wrongCase = (["nom", "acc", "dat"] as Case[]).filter((c) => c !== d.case).map((c) => determiner(d.family, d.gender, c)).filter((x): x is string => Boolean(x));
      const wrongGender = (["m", "f", "n", "pl"] as Gender[]).filter((g) => g !== d.gender).map((g) => determiner(d.family, g, d.case)).filter((x): x is string => Boolean(x));
      const own = t.role === "PREP" ? determiner(d.family, d.gender, d.case) : t.text;
      const wrong = [...new Set(shuffle([...wrongCase, ...wrongGender], opts.random))].filter((w) => w !== own && !words.includes(w) && !extra.includes(w));
      extra.push(...wrong.slice(0, 2));
      // A fused zum / beim: the plain preposition is on the buttons too, so «zu der» stays possible.
      if (t.role === "PREP") { const plain = CONTRACTIONS[fold(t.text)][0]; if (!words.includes(plain) && !extra.includes(plain)) extra.push(plain); }
    });
    // Dativ plural: the form without -n as a trap.
    main.tokens.forEach((t, i) => {
      const prev = main.tokens[i - 1];
      if (t.role !== "NOUN" || !prev?.det || prev.det.case !== "dat" || prev.det.gender !== "pl") return;
      const noun = NOUNS.find((n) => nounForms(n).includes(t.text));
      if (noun?.plural && noun.plural !== t.text && !extra.includes(noun.plural)) extra.push(noun.plural);
    });
    bank = shuffle([...words, ...extra], opts.random);
  }

  const lexVerbs = new Set<string>(Object.values(VERBS).flatMap((v) => Object.values(v)).map(fold));
  const lexNouns = new Set<string>(NOUNS.flatMap(nounForms).map(fold));
  const words = new Set<string>(["nicht", "das", "wo", "kaputt", "mit", "bei", "zu"]);
  for (const v of variants) for (const t of v.tokens) words.add(fold(t.text));

  const slot0 = spec.slots[0];
  const g0: Gender = slot0.plural ? "pl" : NOUN_BY_ID[slot0.noun].gender;
  const datPlural = spec.slots.some((s, i) => s.plural && frame.slots[i].case === "dat");
  const explain = [
    frame.why,
    ...spec.slots.map((s, i) => {
      const noun = NOUN_BY_ID[s.noun];
      const g: Gender = s.plural ? "pl" : noun.gender;
      return `${noun.gender === "pl" ? noun.de : `${GENDER_ARTICLE[noun.gender]} ${noun.de}`} → ${CASE_LABEL[frame.slots[i].case]}, ${g === "pl" ? "множественное число" : `${GENDER_LABEL[g]} род`}: ${determiner(s.family, g, frame.slots[i].case)} ${nounForm(noun, s.plural, frame.slots[i].case)}.`;
    }),
    ...(datPlural ? ["Dativ множественного числа: к существительному добавляется -n (den Kindern, meinen Freunden), кроме форм на -s и -n (den Autos, den Eltern)."] : []),
    ...(spec.slots.some((s) => s.family === "ein") ? ["У ein нет формы множественного числа: ein Buch → Bücher (без артикля), kein Buch → keine Bücher."] : []),
    ...(main.tokens.some((t) => t.role === "PREP" && t.det) ? ["zu dem → zum, zu der → zur, bei dem → beim — так пишут обычно."] : []),
    `${frame.example.de} — ${frame.example.ru}`,
  ];
  return {
    id: opts.id,
    trainer: "articles_cases",
    template_version: ART_TEMPLATE,
    mode,
    key: `art:${frame.slots[0].case}:${g0}:${familyGroup(slot0.family)}`,
    key_label: `${CASE_LABEL[frame.slots[0].case]} · ${g0 === "pl" ? "мн. ч." : GENDER_LABEL[g0]} · ${slot0.family === "der" ? "der" : slot0.family === "ein" ? "ein" : slot0.family === "kein" ? "kein" : "притяжательные"}`,
    prompt_ru: prompt,
    notes_ru: notes,
    word_hint: mode === "quick" ? null : `Слова: ${hints.join(", ")}`,
    expected,
    variants,
    quick,
    bank,
    lexicon: { verbs: [...lexVerbs], nouns: [...lexNouns], words: [...words] },
    explain_for: {
      case: frame.why,
      gender: spec.slots.map((s) => { const n = NOUN_BY_ID[s.noun]; return n.gender === "pl" ? `${n.de} — только множественное число.` : `${n.de} — ${GENDER_ARTICLE[n.gender]}, ${GENDER_LABEL[n.gender]} род${s.plural ? "; здесь множественное число" : ""}.`; }).join(" "),
      noun_form: datPlural ? "Dativ множественного числа: + n — den Kindern, meinen Freunden (кроме форм на -s и -n)." : undefined,
      determiner_form: spec.slots.some((s) => s.family === "kein") ? "Отрицание существительного — kein: kein, keine, keinen, keinem." : undefined,
      word_order: `Правильный порядок: ${expected}`,
    },
    explain,
    meta: {
      frame: frame.id,
      frame_label: frame.label,
      block: frame.block,
      subject: spec.subject,
      slots: spec.slots.map((s, i) => {
        const noun = NOUN_BY_ID[s.noun];
        const g: Gender = s.plural ? "pl" : noun.gender;
        return { noun: noun.de, gender: g, case: frame.slots[i].case, family: s.family, owner: s.owner, form: determiner(s.family, g, frame.slots[i].case), preposition: frame.slots[i].prep ?? null };
      }),
      cases: [...new Set(frame.slots.map((s) => s.case))],
      gaps: frame.slots.length,
      keys: spec.slots.map((s, i) => `art:${frame.slots[i].case}:${s.plural ? "pl" : NOUN_BY_ID[s.noun].gender}:${familyGroup(s.family)}`),
      family_fixed: mode === "quick" || !swappable.some(Boolean),
      show_gender: config.show_gender,
    },
    repeat_of: opts.repeatOf ?? null,
    delayed_review: opts.delayed ?? false,
  };
}

export type ArtPlanInput = { config: ArtConfig; mode: Mode; count: number; seed: number; newId: () => string; due?: string[]; forceDue?: boolean; avoidFrame?: string | null };

function parseKey(key: string): { case: Case; gender: Gender; group: string } | null {
  const [p, c, g, group] = key.split(":");
  if (p !== "art" || !c || !g || !group) return null;
  return { case: c as Case, gender: g as Gender, group };
}

export function artPlan(input: ArtPlanInput): GrammarTask[] {
  const random = rng(input.seed);
  const { frames } = artPool(input.config);
  const usable = frames.filter((fr) => frameUsable(fr, input.config));
  if (!usable.length) return [];
  const due = [...(input.due ?? [])];
  const tasks: GrammarTask[] = [];
  let last = input.avoidFrame ?? null;
  for (let i = 0; tasks.length < input.count && i < input.count * 5; i++) {
    const dueKey = (input.forceDue ? tasks.length === 0 : tasks.length % 3 === 1) ? due.shift() : undefined;
    const want = dueKey ? parseKey(dueKey) : null;
    const options = usable.filter((fr) => fr.id !== last && (!want || fr.slots[0].case === want.case));
    const frame = pickOne(options.length ? options : usable, random);
    const spec = artSample(frame, input.config, random, want ?? undefined) ?? artSample(frame, input.config, random);
    if (!spec) continue;
    tasks.push(artTask(spec, input.mode, input.config, { id: input.newId(), random, delayed: Boolean(want) }));
    last = frame.id;
  }
  return tasks;
}

/** After an error: the same case, gender and determiner family, other words. */
export function artRepeat(task: GrammarTask, config: ArtConfig, seed: number, newId: () => string): GrammarTask | null {
  const random = rng(seed);
  const want = parseKey(task.key);
  if (!want) return null;
  const { frames } = artPool(config);
  const usable = frames.filter((fr) => frameUsable(fr, config) && fr.slots[0].case === want.case);
  for (const frame of shuffle(usable, random)) {
    const spec = artSample(frame, config, random, want);
    if (spec && !(spec.frame === task.meta.frame && JSON.stringify(spec.slots.map((s) => s.noun)) === JSON.stringify((task.meta.slots as { noun: string }[]).map((s) => NOUNS.find((n) => n.de === s.noun)?.id)))) {
      return artTask(spec, task.mode, config, { id: newId(), random, repeatOf: task.id });
    }
  }
  return null;
}

export function artCatalogue() {
  return {
    frames: FRAMES.map((fr) => ({
      id: fr.id, block: fr.block, block_label: BLOCK_LABEL[fr.block], label: fr.label, example: fr.example,
      slots: fr.slots.map((s) => ({ case: CASE_LABEL[s.case], preposition: s.prep ?? null, families: s.families, plural: s.plural, noun_kinds: s.kinds })),
      why: fr.why,
    })),
    nouns: NOUNS.map((n) => ({ noun: n.gender === "pl" ? `${n.de} (pl)` : `${GENDER_ARTICLE[n.gender]} ${n.de}`, plural: n.plural, dative_plural: n.datPl, kind: n.kind, translation: n.ru.f.nom })),
  };
}
