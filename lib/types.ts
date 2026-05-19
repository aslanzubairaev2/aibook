export type AppSection = "home" | "discover" | "books" | "reader" | "cards" | "settings";

export type SelectionType = "word" | "phrase" | "sentence";

export type Book = {
  id: string;
  title: string;
  author: string;
  language: string;
  format: "txt" | "epub" | "fb2";
  progress: number;         // 0-100
  paragraphIndex: number;   // last read paragraph
  chapterTitle: string;
  lastReadAt: string;
  coverColor: string;       // CSS color for cover gradient
  coverUrl?: string | null; // Optional external cover URL
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

export type WordAnalysis = {
  text: string;
  lemma: string;
  partOfSpeech: string;
  gender?: string;
  translation: string;
  explanation?: string;
  nounDetails?: {
    article?: string;
    plural?: string;
  };
  verbDetails?: {
    infinitive?: string;
    tense?: string;
    person?: string;
  };
};

export type PhraseAnalysis = {
  text: string;
  translation: string;
  type?: string;
  explanation?: string;
};

export type SentenceAnalysis = {
  text: string;
  translation: string;
  grammarNote?: string;
  structure?: string;
};

export type AiAnalysis = {
  word?: WordAnalysis;
  phrase?: PhraseAnalysis;
  sentence?: SentenceAnalysis;
  examples?: {
    text: string;
    translation: string;
  }[];
};

export type AiMode = SelectionType;

export type DiscussContentPart = {
  type: "text" | "learning";
  text: string;
  translation?: string;
};

export type DiscussMessage = {
  role: "user" | "model";
  text?: string;
  contentParts?: DiscussContentPart[];
};

export type ReaderSelectionSnapshot = {
  mode: AiMode;
  token: string;
  isCustomSentence?: boolean;
  paraIndex: number;
  tokIdxInPara: number;
  sentStart: number;
  sentEnd: number;
  phraseStart: number;
  phraseEnd: number;
  sentence: string;
  phraseText: string;
  sentenceBefore: string;
  sentenceAfter: string;
  updatedAt: string;
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
