// Nouns the grammar trainers build noun phrases from.
//
// German: gender, plural and the dative plural (with its -n, or without one
// for -s and -n plurals). Russian: every case form a prompt may need, because
// a Russian prompt has to read naturally — «с другом», «у бабушки», «к врачу».
// No weak nouns (der Junge, der Kollege, der Herr): their -n is a topic of its
// own and is kept out until it is switched on as a block.

import type { Gender } from "./common";

export type RuCase = "nom" | "acc" | "gen" | "dat" | "ins" | "pre";
export type RuNoun = { g: Gender; anim: boolean; f: Record<RuCase, string> };

export type Noun = {
  id: string;
  de: string;
  gender: Gender;
  plural: string | null;
  /** Dative plural: Kindern, but Autos and Eltern unchanged. */
  datPl: string | null;
  kind: "thing" | "person" | "animal" | "vehicle" | "place";
  ru: RuNoun;
  ruPl?: RuNoun;
  /** Places: where «zu» takes you, as Russian says it — «в школу», «на почту». */
  ruTo?: string;
  /** «mein Bus» reads oddly: public transport and places take no possessive. */
  noOwner?: boolean;
};

function r(g: Gender, anim: boolean, nom: string, acc: string, gen: string, dat: string, ins: string, pre: string): RuNoun {
  return { g, anim, f: { nom, acc, gen, dat, ins, pre } };
}

export const NOUNS: Noun[] = [
  // Things
  { id: "tisch", de: "Tisch", gender: "m", plural: "Tische", datPl: "Tischen", kind: "thing", ru: r("m", false, "стол", "стол", "стола", "столу", "столом", "столе"), ruPl: r("pl", false, "столы", "столы", "столов", "столам", "столами", "столах") },
  { id: "drucker", de: "Drucker", gender: "m", plural: "Drucker", datPl: "Druckern", kind: "thing", ru: r("m", false, "принтер", "принтер", "принтера", "принтеру", "принтером", "принтере") },
  { id: "schluessel", de: "Schlüssel", gender: "m", plural: "Schlüssel", datPl: "Schlüsseln", kind: "thing", ru: r("m", false, "ключ", "ключ", "ключа", "ключу", "ключом", "ключе"), ruPl: r("pl", false, "ключи", "ключи", "ключей", "ключам", "ключами", "ключах") },
  { id: "laptop", de: "Laptop", gender: "m", plural: "Laptops", datPl: "Laptops", kind: "thing", ru: r("m", false, "ноутбук", "ноутбук", "ноутбука", "ноутбуку", "ноутбуком", "ноутбуке") },
  { id: "koffer", de: "Koffer", gender: "m", plural: "Koffer", datPl: "Koffern", kind: "thing", ru: r("m", false, "чемодан", "чемодан", "чемодана", "чемодану", "чемоданом", "чемодане") },
  { id: "stuhl", de: "Stuhl", gender: "m", plural: "Stühle", datPl: "Stühlen", kind: "thing", ru: r("m", false, "стул", "стул", "стула", "стулу", "стулом", "стуле"), ruPl: r("pl", false, "стулья", "стулья", "стульев", "стульям", "стульями", "стульях") },
  { id: "kuehlschrank", de: "Kühlschrank", gender: "m", plural: "Kühlschränke", datPl: "Kühlschränken", kind: "thing", ru: r("m", false, "холодильник", "холодильник", "холодильника", "холодильнику", "холодильником", "холодильнике") },
  { id: "lampe", de: "Lampe", gender: "f", plural: "Lampen", datPl: "Lampen", kind: "thing", ru: r("f", false, "лампа", "лампу", "лампы", "лампе", "лампой", "лампе") },
  { id: "tasche", de: "Tasche", gender: "f", plural: "Taschen", datPl: "Taschen", kind: "thing", ru: r("f", false, "сумка", "сумку", "сумки", "сумке", "сумкой", "сумке"), ruPl: r("pl", false, "сумки", "сумки", "сумок", "сумкам", "сумками", "сумках") },
  { id: "jacke", de: "Jacke", gender: "f", plural: "Jacken", datPl: "Jacken", kind: "thing", ru: r("f", false, "куртка", "куртку", "куртки", "куртке", "курткой", "куртке") },
  { id: "wohnung", de: "Wohnung", gender: "f", plural: "Wohnungen", datPl: "Wohnungen", kind: "thing", ru: r("f", false, "квартира", "квартиру", "квартиры", "квартире", "квартирой", "квартире") },
  { id: "brille", de: "Brille", gender: "f", plural: "Brillen", datPl: "Brillen", kind: "thing", ru: r("pl", false, "очки", "очки", "очков", "очкам", "очками", "очках") },
  { id: "buch", de: "Buch", gender: "n", plural: "Bücher", datPl: "Büchern", kind: "thing", ru: r("f", false, "книга", "книгу", "книги", "книге", "книгой", "книге"), ruPl: r("pl", false, "книги", "книги", "книг", "книгам", "книгами", "книгах") },
  { id: "handy", de: "Handy", gender: "n", plural: "Handys", datPl: "Handys", kind: "thing", ru: r("m", false, "телефон", "телефон", "телефона", "телефону", "телефоном", "телефоне") },
  { id: "fenster", de: "Fenster", gender: "n", plural: "Fenster", datPl: "Fenstern", kind: "thing", ru: r("n", false, "окно", "окно", "окна", "окну", "окном", "окне") },
  { id: "zimmer", de: "Zimmer", gender: "n", plural: "Zimmer", datPl: "Zimmern", kind: "thing", ru: r("f", false, "комната", "комнату", "комнаты", "комнате", "комнатой", "комнате") },
  { id: "bild", de: "Bild", gender: "n", plural: "Bilder", datPl: "Bildern", kind: "thing", ru: r("f", false, "картина", "картину", "картины", "картине", "картиной", "картине") },
  { id: "geschenk", de: "Geschenk", gender: "n", plural: "Geschenke", datPl: "Geschenken", kind: "thing", ru: r("m", false, "подарок", "подарок", "подарка", "подарку", "подарком", "подарке") },
  { id: "ball", de: "Ball", gender: "m", plural: "Bälle", datPl: "Bällen", kind: "thing", ru: r("m", false, "мяч", "мяч", "мяча", "мячу", "мячом", "мяче") },
  // People and animals
  { id: "bruder", de: "Bruder", gender: "m", plural: "Brüder", datPl: "Brüdern", kind: "person", ru: r("m", true, "брат", "брата", "брата", "брату", "братом", "брате"), ruPl: r("pl", true, "братья", "братьев", "братьев", "братьям", "братьями", "братьях") },
  { id: "schwester", de: "Schwester", gender: "f", plural: "Schwestern", datPl: "Schwestern", kind: "person", ru: r("f", true, "сестра", "сестру", "сестры", "сестре", "сестрой", "сестре") },
  { id: "vater", de: "Vater", gender: "m", plural: "Väter", datPl: "Vätern", kind: "person", ru: r("m", true, "отец", "отца", "отца", "отцу", "отцом", "отце") },
  { id: "mutter", de: "Mutter", gender: "f", plural: "Mütter", datPl: "Müttern", kind: "person", ru: r("f", true, "мама", "маму", "мамы", "маме", "мамой", "маме") },
  { id: "kind", de: "Kind", gender: "n", plural: "Kinder", datPl: "Kindern", kind: "person", ru: r("m", true, "ребёнок", "ребёнка", "ребёнка", "ребёнку", "ребёнком", "ребёнке"), ruPl: r("pl", true, "дети", "детей", "детей", "детям", "детьми", "детях") },
  { id: "freund", de: "Freund", gender: "m", plural: "Freunde", datPl: "Freunden", kind: "person", ru: r("m", true, "друг", "друга", "друга", "другу", "другом", "друге"), ruPl: r("pl", true, "друзья", "друзей", "друзей", "друзьям", "друзьями", "друзьях") },
  { id: "freundin", de: "Freundin", gender: "f", plural: "Freundinnen", datPl: "Freundinnen", kind: "person", ru: r("f", true, "подруга", "подругу", "подруги", "подруге", "подругой", "подруге") },
  { id: "lehrer", de: "Lehrer", gender: "m", plural: "Lehrer", datPl: "Lehrern", kind: "person", ru: r("m", true, "учитель", "учителя", "учителя", "учителю", "учителем", "учителе") },
  { id: "lehrerin", de: "Lehrerin", gender: "f", plural: "Lehrerinnen", datPl: "Lehrerinnen", kind: "person", ru: r("f", true, "учительница", "учительницу", "учительницы", "учительнице", "учительницей", "учительнице") },
  { id: "arzt", de: "Arzt", gender: "m", plural: "Ärzte", datPl: "Ärzten", kind: "person", ru: r("m", true, "врач", "врача", "врача", "врачу", "врачом", "враче") },
  { id: "oma", de: "Oma", gender: "f", plural: "Omas", datPl: "Omas", kind: "person", ru: r("f", true, "бабушка", "бабушку", "бабушки", "бабушке", "бабушкой", "бабушке") },
  { id: "opa", de: "Opa", gender: "m", plural: "Opas", datPl: "Opas", kind: "person", ru: r("m", true, "дедушка", "дедушку", "дедушки", "дедушке", "дедушкой", "дедушке") },
  { id: "eltern", de: "Eltern", gender: "pl", plural: "Eltern", datPl: "Eltern", kind: "person", ru: r("pl", true, "родители", "родителей", "родителей", "родителям", "родителями", "родителях") },
  { id: "hund", de: "Hund", gender: "m", plural: "Hunde", datPl: "Hunden", kind: "animal", ru: r("f", true, "собака", "собаку", "собаки", "собаке", "собакой", "собаке") },
  { id: "katze", de: "Katze", gender: "f", plural: "Katzen", datPl: "Katzen", kind: "animal", ru: r("f", true, "кошка", "кошку", "кошки", "кошке", "кошкой", "кошке") },
  // Vehicles (mit) and places (zu)
  { id: "bus", noOwner: true, de: "Bus", gender: "m", plural: "Busse", datPl: "Bussen", kind: "vehicle", ru: r("m", false, "автобус", "автобус", "автобуса", "автобусу", "автобусом", "автобусе") },
  { id: "zug", noOwner: true, de: "Zug", gender: "m", plural: "Züge", datPl: "Zügen", kind: "vehicle", ru: r("m", false, "поезд", "поезд", "поезда", "поезду", "поездом", "поезде") },
  { id: "auto", de: "Auto", gender: "n", plural: "Autos", datPl: "Autos", kind: "vehicle", ru: r("f", false, "машина", "машину", "машины", "машине", "машиной", "машине") },
  { id: "fahrrad", de: "Fahrrad", gender: "n", plural: "Fahrräder", datPl: "Fahrrädern", kind: "vehicle", ru: r("m", false, "велосипед", "велосипед", "велосипеда", "велосипеду", "велосипедом", "велосипеде") },
  { id: "strassenbahn", noOwner: true, de: "Straßenbahn", gender: "f", plural: "Straßenbahnen", datPl: "Straßenbahnen", kind: "vehicle", ru: r("m", false, "трамвай", "трамвай", "трамвая", "трамваю", "трамваем", "трамвае") },
  { id: "bahnhof", de: "Bahnhof", gender: "m", plural: "Bahnhöfe", datPl: "Bahnhöfen", kind: "place", ru: r("m", false, "вокзал", "вокзал", "вокзала", "вокзалу", "вокзалом", "вокзале"), ruTo: "на вокзал" },
  { id: "bank", de: "Bank", gender: "f", plural: "Banken", datPl: "Banken", kind: "place", ru: r("m", false, "банк", "банк", "банка", "банку", "банком", "банке"), ruTo: "в банк" },
  { id: "post", de: "Post", gender: "f", plural: null, datPl: null, kind: "place", ru: r("f", false, "почта", "почту", "почты", "почте", "почтой", "почте"), ruTo: "на почту" },
  { id: "schule", de: "Schule", gender: "f", plural: "Schulen", datPl: "Schulen", kind: "place", ru: r("f", false, "школа", "школу", "школы", "школе", "школой", "школе"), ruTo: "в школу" },
  { id: "supermarkt", de: "Supermarkt", gender: "m", plural: "Supermärkte", datPl: "Supermärkten", kind: "place", ru: r("m", false, "супермаркет", "супермаркет", "супермаркета", "супермаркету", "супермаркетом", "супермаркете"), ruTo: "в супермаркет" },
  { id: "apotheke", de: "Apotheke", gender: "f", plural: "Apotheken", datPl: "Apotheken", kind: "place", ru: r("f", false, "аптека", "аптеку", "аптеки", "аптеке", "аптекой", "аптеке"), ruTo: "в аптеку" },
];

export const NOUN_BY_ID: Record<string, Noun> = Object.fromEntries(NOUNS.map((n) => [n.id, n]));

/** The German noun as it stands in this case and number: the dative plural takes its -n. */
export function nounForm(noun: Noun, plural: boolean, kase: "nom" | "acc" | "dat"): string {
  if (!plural && noun.gender !== "pl") return noun.de;
  if (kase === "dat") return noun.datPl ?? noun.plural ?? noun.de;
  return noun.plural ?? noun.de;
}

/** Every form the noun can take — a learner's «Kinder» for «Kindern» is a noun-form error, not an unknown word. */
export function nounForms(noun: Noun): string[] {
  return [...new Set([noun.de, noun.plural, noun.datPl].filter((x): x is string => Boolean(x)))];
}
