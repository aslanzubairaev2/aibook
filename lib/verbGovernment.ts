// What a German verb governs: the preposition it needs and the case after it
// («warten auf + Akk»), or the bare case of its object («helfen + Dat»).
//
// Stored on the dictionary row as `forms.rektion`, one plain line the learner
// could read as is: «mit + Dat (с кем); über + Akk (о чём)». Living in `forms`
// it travels with the verb's other forms everywhere they already go — the
// smart-add pipeline, the local caches, the «Präteritum: …» line on a card's
// back. Rows and cards that predate the field fall back to the curated list
// below, so every common verb shows its government without an AI call.

export type GovernedCase = "Akk" | "Dat" | "Gen";

export type Government = {
  /** «auf», «sich mit»; null for a bare object («helfen + Dat»). */
  prep: string | null;
  case: GovernedCase;
  /** The Russian question it answers: «кого/что», «о чём». */
  hint: string;
};

const ITEM = /^(.*?)\s*\+\s*(Akk|Dat|Gen)\w*\.?\s*(?:\((.*)\))?$/iu;
const CASE_NAME: Record<string, GovernedCase> = { akk: "Akk", dat: "Dat", gen: "Gen" };

/** «auf + Akk (кого/что); Dat (кому)» → structured items; anything unreadable is dropped. */
export function parseGovernment(line: string | undefined | null): Government[] {
  if (!line) return [];
  const items: Government[] = [];
  for (const part of line.split(";")) {
    const text = part.trim();
    if (!text) continue;
    // A bare case is written without the plus: «Dat (кому)».
    const m = ITEM.exec(text.includes("+") ? text : `+ ${text}`);
    if (!m) continue;
    const kase = CASE_NAME[m[2].toLowerCase().slice(0, 3)];
    if (!kase) continue;
    items.push({ prep: m[1].trim() || null, case: kase, hint: (m[3] ?? "").trim() });
  }
  return items;
}

export function formatGovernment(items: Government[]): string {
  return items
    .map((g) => `${g.prep ? `${g.prep} + ` : ""}${g.case}${g.hint ? ` (${g.hint})` : ""}`)
    .join("; ");
}

// Common A1–B1 verbs, keyed by infinitive without «sich». Plain Akk objects
// are listed too: «besuchen + Akk» is the answer to «какой падеж?» as much as
// «warten auf + Akk». Verbs with no object (schlafen, regnen) are absent.
const GOVERNMENT: Record<string, string> = {
  abfahren: "von + Dat (откуда); nach + Dat (куда: город, страна)",
  abhängen: "von + Dat (от кого/чего)",
  abholen: "Akk (кого/что); von + Dat (откуда)",
  achten: "auf + Akk (на что)",
  anfangen: "mit + Dat (с чего)",
  ankommen: "in + Dat (где)",
  anrufen: "Akk (кому — но Akk)",
  antworten: "Dat (кому); auf + Akk (на что)",
  arbeiten: "bei + Dat (в фирме); an + Dat (над чем)",
  ärgern: "sich über + Akk (на что)",
  aufhören: "mit + Dat (что прекратить)",
  aufpassen: "auf + Akk (за кем/чем)",
  aufräumen: "Akk (что)",
  ausfüllen: "Akk (что)",
  ausgehen: "mit + Dat (с кем)",
  aussteigen: "aus + Dat (из чего)",
  backen: "Akk (что)",
  bedanken: "sich bei + Dat (кого); für + Akk (за что)",
  bedienen: "Akk (кого)",
  begegnen: "Dat (кого — но Dat)",
  beginnen: "mit + Dat (с чего)",
  bekommen: "Akk (что); von + Dat (от кого)",
  benutzen: "Akk (что)",
  beschäftigen: "sich mit + Dat (чем)",
  beschweren: "sich über + Akk (на что); bei + Dat (кому)",
  besichtigen: "Akk (что)",
  bestehen: "aus + Dat (из чего)",
  bestellen: "Akk (что); bei + Dat (у кого)",
  besuchen: "Akk (кого/что)",
  bewegen: "Akk (что)",
  bewerben: "sich um + Akk (на что); bei + Dat (куда)",
  bezahlen: "Akk (что); für + Akk (за что)",
  bitten: "Akk (кого); um + Akk (о чём)",
  braten: "Akk (что)",
  brauchen: "Akk (кого/что)",
  bringen: "Dat (кому); Akk (что)",
  buchstabieren: "Akk (что)",
  danken: "Dat (кого — но Dat); für + Akk (за что)",
  dekorieren: "Akk (что); mit + Dat (чем)",
  denken: "an + Akk (о ком/чём)",
  diskutieren: "über + Akk (о чём); mit + Dat (с кем)",
  einkaufen: "in + Dat (где)",
  einladen: "Akk (кого); zu + Dat (на что)",
  einsteigen: "in + Akk (во что)",
  empfehlen: "Dat (кому); Akk (что)",
  entschuldigen: "sich bei + Dat (перед кем); für + Akk (за что)",
  ergänzen: "Akk (что)",
  erinnern: "sich an + Akk (о ком/чём)",
  erklären: "Dat (кому); Akk (что)",
  erlauben: "Dat (кому); Akk (что)",
  erzählen: "Dat (кому); von + Dat (о чём)",
  essen: "Akk (что)",
  fahren: "mit + Dat (на чём); nach + Dat (куда: город, страна)",
  fehlen: "Dat (кому не хватает)",
  feiern: "Akk (что)",
  finden: "Akk (кого/что)",
  fliegen: "nach + Dat (куда); mit + Dat (чем)",
  folgen: "Dat (за кем)",
  fotografieren: "Akk (кого/что)",
  fragen: "Akk (кого); nach + Dat (о чём)",
  freuen: "sich auf + Akk (чему-то впереди); sich über + Akk (чему-то уже)",
  geben: "Dat (кому); Akk (что)",
  gefallen: "Dat (кому)",
  gehen: "zu + Dat (к кому); in + Akk (куда)",
  gehören: "Dat (кому)",
  gewöhnen: "sich an + Akk (к чему)",
  glauben: "Dat (кому); an + Akk (в кого/что)",
  gratulieren: "Dat (кого — но Dat); zu + Dat (с чем)",
  grillen: "Akk (что)",
  grüßen: "Akk (кого)",
  haben: "Akk (что)",
  halten: "von + Dat (мнение о ком/чём)",
  helfen: "Dat (кому); bei + Dat (с чем)",
  hoffen: "auf + Akk (на что)",
  holen: "Akk (что)",
  hören: "Akk (кого/что)",
  informieren: "über + Akk (о чём)",
  interessieren: "sich für + Akk (чем)",
  kaufen: "Akk (что); Dat (кому)",
  kennen: "Akk (кого/что)",
  kennenlernen: "Akk (кого)",
  kochen: "Akk (что)",
  kommen: "aus + Dat (откуда); zu + Dat (к кому)",
  korrigieren: "Akk (что)",
  kriegen: "Akk (что)",
  kümmern: "sich um + Akk (о ком/чём)",
  lachen: "über + Akk (над чем)",
  leben: "in + Dat (где)",
  leiden: "an + Dat (чем болеть); unter + Dat (от чего)",
  lernen: "Akk (что); für + Akk (к чему)",
  lesen: "Akk (что); über + Akk (о чём)",
  liegen: "auf / in + Dat (где)",
  machen: "Akk (что)",
  malen: "Akk (что)",
  markieren: "Akk (что)",
  mieten: "Akk (что)",
  mitbringen: "Dat (кому); Akk (что)",
  mitmachen: "bei + Dat (в чём)",
  mögen: "Akk (кого/что)",
  nachdenken: "über + Akk (о чём)",
  nehmen: "Akk (что)",
  öffnen: "Akk (что)",
  ordnen: "Akk (что)",
  organisieren: "Akk (что)",
  passen: "Dat (кому); zu + Dat (к чему)",
  passieren: "Dat (с кем)",
  probieren: "Akk (что)",
  prüfen: "Akk (что)",
  raten: "Dat (кому)",
  rechnen: "mit + Dat (с чем, на что)",
  reden: "mit + Dat (с кем); über + Akk (о чём)",
  renovieren: "Akk (что)",
  reparieren: "Akk (что)",
  riechen: "nach + Dat (чем)",
  sagen: "Dat (кому); Akk (что)",
  schenken: "Dat (кому); Akk (что)",
  schicken: "Dat (кому); Akk (что)",
  schließen: "Akk (что)",
  schmecken: "Dat (кому)",
  schneiden: "Akk (что)",
  schreiben: "Dat (кому); an + Akk (кому); über + Akk (о чём)",
  sehen: "Akk (кого/что)",
  singen: "Akk (что)",
  sitzen: "auf / in + Dat (где)",
  sorgen: "für + Akk (о ком/чём)",
  sprechen: "mit + Dat (с кем); über + Akk (о чём)",
  stehen: "Dat (кому идёт)",
  sterben: "an + Dat (от чего)",
  studieren: "Akk (что); an + Dat (где)",
  suchen: "Akk (кого/что)",
  teilnehmen: "an + Dat (в чём)",
  telefonieren: "mit + Dat (с кем)",
  träumen: "von + Dat (о ком/чём)",
  treffen: "Akk (кого); sich mit + Dat (с кем)",
  trinken: "Akk (что)",
  übersetzen: "Akk (что); aus + Dat (с языка); in + Akk (на язык)",
  unterhalten: "sich mit + Dat (с кем); über + Akk (о чём)",
  unterschreiben: "Akk (что)",
  verabreden: "sich mit + Dat (с кем)",
  verdienen: "Akk (что)",
  verkaufen: "Dat (кому); Akk (что)",
  verlieben: "sich in + Akk (в кого)",
  vertrauen: "Dat (кому)",
  verzichten: "auf + Akk (от чего)",
  vorbereiten: "sich auf + Akk (к чему)",
  warten: "auf + Akk (кого/что)",
  waschen: "Akk (что)",
  wehtun: "Dat (кому)",
  widersprechen: "Dat (кому)",
  wiederholen: "Akk (что)",
  wissen: "von + Dat (о чём)",
  wohnen: "in + Dat (где); bei + Dat (у кого)",
  zahlen: "für + Akk (за что)",
  zeigen: "Dat (кому); Akk (что)",
  zuhören: "Dat (кого — но Dat)",
  zurückfahren: "nach + Dat (куда)",
  zustimmen: "Dat (кому)",
  zweifeln: "an + Dat (в чём)",
};

function keyOf(infinitive: string): string {
  return infinitive.trim().toLocaleLowerCase("de-DE").replace(/^sich\s+/u, "").replace(/\s+/g, " ");
}

/** The curated line for a verb, or "" when the list does not know it. */
export function knownGermanGovernment(infinitive: string): string {
  const key = keyOf(infinitive);
  return Object.hasOwn(GOVERNMENT, key) ? GOVERNMENT[key] : "";
}

/** Every curated verb with its line — the source of the dictionary backfill. */
export function allKnownGermanGovernment(): Record<string, string> {
  return { ...GOVERNMENT };
}

/**
 * The government to show for a verb: what its own row stores, else the
 * curated line. An explicit empty value is not a reason to hide a known one —
 * older rows simply never had the field.
 */
export function germanVerbGovernment(infinitive: string, stored?: string | null): Government[] {
  const own = parseGovernment(stored);
  return own.length > 0 ? own : parseGovernment(knownGermanGovernment(infinitive));
}
