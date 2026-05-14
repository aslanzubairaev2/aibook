import type { AiAnalysis, Book, Flashcard, UserProfile } from "@/lib/types";

export const mockProfile: UserProfile = {
  nativeLanguage: "Русский",
  targetLanguage: "Немецкий",
  uiLanguage: "Русский",
  readingMinutes: 380,
  booksStarted: 3,
  booksFinished: 1,
  savedItems: 128,
};

export const mockBooks: Book[] = [
  {
    id: "monte-cristo-de",
    title: "Граф Монте-Кристо",
    author: "Александр Дюма",
    language: "DE",
    format: "epub",
    progress: 42,
    chapterTitle: "Глава 3. Заговор",
    lastReadAt: "Сегодня",
    coverTone: "#d4a847",
    paragraphs: [
      "Edmond bemerkte, dass Caderousse leise sprach, während Danglars den Blick nicht von ihm abwandte.",
      "In diesem Augenblick schmiedeten die Männer einen Plan, der das Schicksal des jungen Seemanns verändern sollte.",
      "Mercedes wartete am Fenster, ohne zu ahnen, dass eine verborgene Intrige bereits ihren Lauf nahm.",
    ],
  },
  {
    id: "kleine-prinz",
    title: "Der kleine Prinz",
    author: "Antoine de Saint-Exupéry",
    language: "DE",
    format: "epub",
    progress: 12,
    chapterTitle: "Kapitel 2",
    lastReadAt: "Вчера",
    coverTone: "#7a9f8d",
    paragraphs: [
      "Der kleine Prinz betrachtete die Sterne und stellte eine Frage, die niemand erwartet hatte.",
    ],
  },
  {
    id: "faust",
    title: "Faust",
    author: "Johann Wolfgang von Goethe",
    language: "DE",
    format: "txt",
    progress: 0,
    chapterTitle: "Начало",
    lastReadAt: "Не начато",
    coverTone: "#9b6c5a",
    paragraphs: ["Habe nun, ach! Philosophie, Juristerei und Medizin studiert."],
  },
];

export const mockAnalysis: AiAnalysis = {
  word: {
    text: "schmiedeten",
    lemma: "schmieden",
    partOfSpeech: "глагол",
    translation: "ковали; замышляли",
    explanation: "Здесь слово используется переносно: не буквально ковать металл, а тайно составлять план.",
  },
  phrase: {
    text: "einen Plan schmiedeten",
    translation: "замышляли план",
    explanation: "Устойчивая образная фраза. В русском ближе всего: “строили план” или “замышляли”.",
  },
  sentence: {
    text: "In diesem Augenblick schmiedeten die Männer einen Plan, der das Schicksal des jungen Seemanns verändern sollte.",
    translation: "В этот момент мужчины замышляли план, который должен был изменить судьбу молодого моряка.",
    grammarNote: "Относительное придаточное с der относится к слову Plan. Sollte добавляет оттенок будущей неизбежности.",
  },
  examples: [
    "Sie schmiedeten heimlich einen Plan.",
    "Der König schmiedete ein Bündnis.",
    "Man kann Eisen schmieden.",
    "Die Freunde schmiedeten Reisepläne.",
    "Danglars schmiedete eine Intrige.",
  ],
};

export const mockCards: Flashcard[] = [
  {
    id: "card-1",
    type: "word",
    front: "schmieden",
    back: "ковать; замышлять",
    source: "Граф Монте-Кристо",
    status: "due",
  },
  {
    id: "card-2",
    type: "phrase",
    front: "einen Plan schmieden",
    back: "замышлять / строить план",
    source: "Граф Монте-Кристо",
    status: "learning",
  },
  {
    id: "card-3",
    type: "sentence",
    front: "der das Schicksal verändern sollte",
    back: "который должен был изменить судьбу",
    source: "Граф Монте-Кристо",
    status: "new",
  },
];
