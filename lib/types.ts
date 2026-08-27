export type AppSection = "home" | "discover" | "books" | "reader" | "homework" | "cards" | "verbs" | "settings" | "auth";

export type SelectionType = "word" | "phrase" | "sentence";
export type TtsProvider =
  | "local" | "gemini" | "deepgram" | "speechify" | "inworld" | "openai" | "cartesia" | "elevenlabs";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type ContentSource = "upload" | "gutenberg" | "standard_ebooks" | "klexikon" | "oersi" | "universal_cefr" | "generated";

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

// A "variant" of the recognize/flashcard trainer: which language is shown as
// the prompt (forward/reverse), or whether the prompt is audio-only. Each
// variant schedules independently — see CardVariantState below — so grading
// a card well in one variant does not affect when it resurfaces in another.
export type TrainVariant = "forward" | "reverse" | "audio";

/** Persisted flashcard filter/sort selections from CardsView, kept in sync via UserProfile so they survive reloads and follow the user across devices. */
export type CardFilters = {
  filterStatus?: "all" | "new" | "learning" | "review" | "relearning";
  filterType?: "all" | "word" | "phrase" | "sentence";
  filterBook?: string;
  /** CEFR level of the word on the card ("all" or A1…C2). */
  filterLevel?: string;
  sortOrder?: "added" | "due" | "ease";
  trainFilter?: "all" | "word" | "phrase" | "sentence";
  trainStatus?: "all" | "new" | "learning" | "review" | "relearning" | "hard";
  /** Narrow training to one source — a book title or a dictionary batch title. */
  trainBook?: string;
  /** Exact dictionary batch id; avoids mixing batches that share a title. */
  trainSourceId?: string | null;
  /**
   * Sources a session skips: pack ids, or titles for cards older than packs.
   *
   * The other half of «книга / пачка». That one asks for one source and nothing
   * else; this one asks for everything *except* the ones named — the book
   * already finished, the pack being saved for next week. Saying it as a
   * positive selection would mean listing every source the learner does want,
   * and adding to that list every time a new pack arrives.
   */
  trainExcluded?: string[];
  trainVariants?: TrainVariant[];
  trainMode?: "recognize" | "active";
  /** Full-immersion training: nothing on screen but the card and the grades. */
  zenMode?: boolean;
};

/**
 * A pack's own training preferences, set by the learner's assistant over MCP.
 *
 * A pack of phrases meant to be produced from Russian is not trained the same
 * way as a page of nouns meant to be recognised, and until now the trainer had
 * one global setting for both. These are the pack's answer to "how should this
 * one be drilled"; the learner's own filters stay what they are and are used
 * whenever a pack says nothing.
 */
export type PackTraining = {
  /** Which prompt directions this pack is drilled in. Empty/absent = every direction. */
  variants?: TrainVariant[];
  /** Narrow to one card type — a pack of sentences need not offer «слово». */
  type?: "all" | "word" | "phrase" | "sentence";
  status?: "all" | "new" | "learning" | "review" | "relearning" | "hard";
  mode?: "recognize" | "active";
  /** One line, in the learner's language, on why it is set up this way. */
  note?: string;
};

/** How the packs on the Словарь screen are ordered. */
export type PackSort = "new" | "unlearned" | "progress" | "title";

export type UserProfile = {
  nativeLanguage: string;   // ISO 639-1 code e.g. 'ru'
  targetLanguage: string;   // ISO 639-1 code e.g. 'de'
  uiLanguage: string;
  readingMinutes: number;
  booksStarted: number;
  booksFinished: number;
  savedItems: number;
  ttsProvider?: TtsProvider;
  /**
   * The chosen voice per engine, kept on this device.
   *
   * Each engine has its own cast, so switching engines must not carry a voice
   * that means nothing to the next one — hence one entry per provider rather
   * than a single field.
   */
  ttsVoices?: Partial<Record<TtsProvider, string>>;
  /** Likewise the model, for trying an engine's models against each other. */
  ttsModels?: Partial<Record<TtsProvider, string>>;
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
  /** How common the word is, as a CEFR level — tells the learner whether it is worth memorising now. */
  cefr?: string;
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

/**
 * One way of saying a native-language word in the language being learned.
 *
 * The mirror image of WordAnalysis: there the question is "what does this
 * German word mean", here it is "how do I say this Russian word in German",
 * which is a list rather than a single answer.
 */
export type ReverseWordOption = {
  text: string;
  article?: string;
  partOfSpeech?: string;
  posTag?: PosTag;
  plural?: string;
  /** Other forms that come with the word — a verb's principal parts, say. */
  forms?: string;
  /** When this option is the right one, in the native language. */
  note?: string;
};

export type ReverseWordAnalysis = {
  /** The native-language word that was asked about. */
  native: string;
  entries: ReverseWordOption[];
  examples?: { text: string; translation: string }[];
};

export type AiAnalysis = {
  word?: WordAnalysis;
  phrase?: PhraseAnalysis;
  sentence?: SentenceAnalysis;
  /** Filled instead of `word` when the lookup ran native → target. */
  reverse?: ReverseWordAnalysis;
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

/**
 * A button the tutor can put under its answer, wired to a screen the app
 * already has. The model only says *what* would help here ("the conjugation of
 * aufräumen"); the app decides how to show it.
 */
export type DiscussActionKind = "conjugation" | "declension" | "comparison" | "forms" | "word";

export type DiscussAction = {
  kind: DiscussActionKind;
  /** Button caption, in the learner's native language. */
  label: string;
  /** Dictionary form the modal should open on. */
  word: string;
};

export type DiscussMessage = {
  role: "user" | "model";
  text?: string;
  contentParts?: DiscussContentPart[];
  /**
   * Follow-up questions this particular learner is likely to ask next, written
   * by the model from the context. They replace the fixed chip list, which
   * offered "Отличия" whether or not there was anything to contrast.
   */
  suggestions?: string[];
  actions?: DiscussAction[];
};

/**
 * How well the learner already knows the thing being discussed, read off the
 * SRS state of their own card for it. The tutor uses this to decide whether to
 * explain the basics, hand over a memory hook, or skip straight to nuance.
 */
export type DiscussFamiliarity =
  /** No card for it — nothing known about this learner and this word. */
  | "unseen"
  /** Saved, never successfully recalled yet. */
  | "new"
  /** Keeps being forgotten: lapses, or a low ease factor. */
  | "struggling"
  /** On its way in, short intervals. */
  | "learning"
  /** Recalled reliably for a while. */
  | "familiar"
  /** Long intervals, no recent failures. */
  | "mastered";

export type DiscussWordProfile = {
  familiarity: DiscussFamiliarity;
  status?: CardStatus;
  repetitions?: number;
  lapses?: number;
  intervalDays?: number;
  easeFactor?: number;
  /** CEFR level of the word itself, when the dictionary knows it. */
  cefr?: string | null;
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
  /** CEFR level of the word, when known (cards made from the dictionary carry it). */
  cefr?: string | null;
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

// ─── Recognize-mode variants ────────────────────────────────────────────────
// The base Flashcard SM-2 fields track the "forward" variant (target language
// shown, recall the native meaning). "reverse" (native shown, recall the
// target form) and "audio" (hear it, recall both) get their own independent
// schedule here, stored locally and keyed by card id — same pattern as
// CardSkillState above.
export type CardVariantState = Partial<Record<Exclude<TrainVariant, "forward">, SkillProgress>>;
