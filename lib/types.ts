export type AppSection = "home" | "discover" | "books" | "reader" | "cards" | "settings" | "auth";

export type SelectionType = "word" | "phrase" | "sentence";
export type TtsProvider = "local" | "gemini" | "deepgram";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type ContentSource = "upload" | "gutenberg" | "standard_ebooks" | "wikibooks" | "oersi" | "universal_cefr";

export type LessonContext = {
  courseId: string;
  courseTitle: string;
  sharedBookId: string;
  lessonOrder: number;
  totalLessons: number;
  prevLesson?: { sharedBookId: string; title: string };
  nextLesson?: { sharedBookId: string; title: string };
};

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
  cefrLevel?: CefrLevel | null;
  sourceType?: ContentSource;
  sharedBookId?: string;    // set when opened from shared_books
  lessonContext?: LessonContext; // navigation context for shared lessons
};

/** Persisted flashcard filter/sort selections from CardsView, kept in sync via UserProfile so they survive reloads and follow the user across devices. */
export type CardFilters = {
  filterStatus?: "all" | "new" | "learning" | "review" | "relearning";
  filterType?: "all" | "word" | "phrase" | "sentence";
  filterBook?: string;
  sortOrder?: "added" | "due" | "ease";
  trainFilter?: "all" | "word" | "phrase" | "sentence";
  trainStatus?: "all" | "new" | "learning" | "review" | "relearning" | "hard";
  trainDirection?: "forward" | "reverse" | "mixed";
  trainMode?: "recognize" | "active";
};

export type UserProfile = {
  nativeLanguage: string;   // ISO 639-1 code e.g. 'ru'
  targetLanguage: string;   // ISO 639-1 code e.g. 'de'
  uiLanguage: string;
  readingMinutes: number;
  booksStarted: number;
  booksFinished: number;
  savedItems: number;
  ttsProvider?: TtsProvider;
  cardFilters?: CardFilters;
};

// Normalized, language-agnostic part of speech used to decide which grammar
// table (conjugation / declension / …) to offer. `partOfSpeech` stays as the
// human-readable label in the user's native language.
export type PosTag =
  | "verb"
  | "noun"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "numeral"
  | "other";

export type WordAnalysis = {
  text: string;
  lemma: string;
  partOfSpeech: string;
  posTag?: PosTag;
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

// ─── Grammar tables (conjugation / declension / comparison) ─────────────────
export type GrammarKind = "conjugation" | "declension" | "comparison" | "forms";

export type GrammarCell = {
  label: string;     // label in the native language, e.g. "я", "он/она"
  pronoun?: string;  // target-language marker shown with the form, e.g. "ich", "der/die/das"
  form: string;      // inflected form in the target language — this is what gets spoken
  note?: string;     // optional short note in the native language
};

export type GrammarSection = {
  title: string;     // section heading in the native language, e.g. "Настоящее время"
  caption?: string;  // optional helper text in the native language
  cells: GrammarCell[];
};

export type GrammarGender = "m" | "f" | "n" | "pl" | "";

// Petrov-style verb matrix: 3 tenses (rows) × 3 polarities (columns), each cell
// holding the conjugation for the person set. Used for the full verb view.
export type GrammarMatrixRow = { form: string; native: string };
export type GrammarMatrix = {
  rowLabels: string[];            // tenses, top → bottom (future, present, past)
  colLabels: string[];           // polarities, left → right (negation, affirmation, question)
  cells: GrammarMatrixRow[][][]; // [rowIndex][colIndex] → person rows
};

export type GrammarTable = {
  word: string;
  lemma: string;
  language: string;          // resolved target language code the forms are in
  partOfSpeech: PosTag;
  kind: GrammarKind;
  detail: "brief" | "full";
  gender?: GrammarGender;    // for nouns — drives the colored gender badge
  sections: GrammarSection[];
  matrix?: GrammarMatrix;    // for verbs on the full view — Petrov-style grid
  languageWarning?: string;  // set when the word looks like it belongs to another language
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

export type ReaderProgressSnapshot = {
  bookId: string;
  paragraphIndex: number;
  charOffset: number;
  percentage: number;
  lastReadAt: string;
  selectionState: ReaderSelectionSnapshot | null;
};

export type CardStatus = "new" | "learning" | "review" | "relearning";

export type Flashcard = {
  id: string;
  type: SelectionType;
  front: string;
  back: string;
  source: string;
  addedAt: string;
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string; // ISO 8601 string
  lastReviewedAt?: string | null;
  sourceBookId?: string | null;
  sourceBookTitle?: string | null;
};

// ─── Productive recall ──────────────────────────────────────────────────────
// The base Flashcard SRS tracks *recognition* (foreign → meaning). Productive
// practice needs its own per-skill schedule so "узнаю / вспоминаю / произношу"
// progress independently. Stored locally, keyed by card id.
export type ProductiveSkill = "recall" | "listen" | "produce";

export type SkillProgress = {
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
  lastReviewedAt: string | null;
};

export type CardSkillState = Partial<Record<ProductiveSkill, SkillProgress>>;
