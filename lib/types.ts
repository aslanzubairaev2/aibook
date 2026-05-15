export type AppSection = "home" | "books" | "reader" | "cards" | "settings";

export type SelectionType = "word" | "phrase" | "sentence";

export type Book = {
  id: string;
  title: string;
  author: string;
  language: string;
  format: "txt" | "epub";
  progress: number;         // 0-100
  paragraphIndex: number;   // last read paragraph
  chapterTitle: string;
  lastReadAt: string;
  coverColor: string;       // CSS color for cover gradient
  paragraphs: string[];
};

export type UserProfile = {
  nativeLanguage: string;   // ISO 639-1 code e.g. 'ru'
  targetLanguage: string;   // ISO 639-1 code e.g. 'de'
  uiLanguage: string;
  readingMinutes: number;
  booksStarted: number;
  booksFinished: number;
  savedItems: number;
  ttsProvider?: "local" | "gemini";
};

export type AiAnalysis = {
  word: {
    text: string;
    lemma: string;
    partOfSpeech: string;
    gender?: string;
    translation: string;
    explanation: string;
  };
  phrase: {
    text: string;
    translation: string;
    type: string;
    explanation: string;
  };
  sentence: {
    text: string;
    translation: string;
    grammarNote: string;
    structure: string;
  };
  examples: string[];
};

export type Flashcard = {
  id: string;
  type: SelectionType;
  front: string;
  back: string;
  source: string;
  addedAt: string;
  status: "new" | "due" | "learning";
};
