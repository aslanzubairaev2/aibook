// Interactive tests («тесты от преподавателя»): what a test is, and how the
// agent's loosely-typed MCP input becomes one.
//
// A test is a list of sections («блоки»). A section is the unit the learner
// sees on one screen — a reading text with its questions, a recording with its
// questions, or a short run of grammar items — and the unit the diagnostic mode
// releases results by. Items carry their own answers; those never leave the
// server until the test's settings say they may (see publicView.ts).
//
// Separate from homework (components/homework), which turns photographed sheets
// from a real teacher into exercises. Nothing here is shared with it.

export const ASSESSMENT_MODES = ["learning", "diagnostic"] as const;
export type AssessmentMode = typeof ASSESSMENT_MODES[number];

// translation is its own kind of work: rendering a given Russian text is not the
// same skill as writing one's own. speaking is measured only by speaking items.
export const SKILLS = ["reading", "listening", "writing", "translation", "speaking", "grammar", "vocabulary"] as const;
export type Skill = typeof SKILLS[number];

/** What an error is an error *of*. Results are broken down by these. */
export const DIMENSIONS = ["meaning", "grammar", "vocabulary", "spelling", "instruction", "pronunciation"] as const;
export type Dimension = typeof DIMENSIONS[number];

export const ITEM_TYPES = [
  "single_choice",
  "multiple_choice",
  "gap_select",
  "gap_text",
  "word_order",
  "short_answer",
  "writing",
  "translation",
  "read_aloud",
  "repeat",
  "spoken_response",
] as const;

/** Items answered by recording the learner's voice. */
export const SPEAKING_TYPES = ["read_aloud", "repeat", "spoken_response"] as const;
export type SpeakingType = typeof SPEAKING_TYPES[number];
export function isSpeakingType(type: string): type is SpeakingType {
  return (SPEAKING_TYPES as readonly string[]).includes(type);
}
export type ItemType = typeof ITEM_TYPES[number];

export const RESULTS_RELEASE = ["immediate", "after_section", "after_submit", "after_review"] as const;
export type ResultsRelease = typeof RESULTS_RELEASE[number];

export const PACES = ["slow", "normal", "fast"] as const;
export type Pace = typeof PACES[number];

/**
 * Gemini's prebuilt voices, with the impression each gives. The agent picks
 * from these; anything else would be refused by the speech API mid-generation.
 */
export const ASSESSMENT_VOICES: { id: string; gender: "female" | "male"; hint: string }[] = [
  { id: "Kore", gender: "female", hint: "firm" },
  { id: "Aoede", gender: "female", hint: "breezy" },
  { id: "Leda", gender: "female", hint: "youthful" },
  { id: "Zephyr", gender: "female", hint: "bright" },
  { id: "Callirrhoe", gender: "female", hint: "easy-going" },
  { id: "Autonoe", gender: "female", hint: "bright" },
  { id: "Despina", gender: "female", hint: "smooth" },
  { id: "Erinome", gender: "female", hint: "clear" },
  { id: "Laomedeia", gender: "female", hint: "upbeat" },
  { id: "Achernar", gender: "female", hint: "soft" },
  { id: "Gacrux", gender: "female", hint: "mature" },
  { id: "Pulcherrima", gender: "female", hint: "forward" },
  { id: "Vindemiatrix", gender: "female", hint: "gentle" },
  { id: "Sulafat", gender: "female", hint: "warm" },
  { id: "Puck", gender: "male", hint: "upbeat" },
  { id: "Charon", gender: "male", hint: "informative" },
  { id: "Fenrir", gender: "male", hint: "excitable" },
  { id: "Orus", gender: "male", hint: "firm" },
  { id: "Enceladus", gender: "male", hint: "breathy" },
  { id: "Iapetus", gender: "male", hint: "clear" },
  { id: "Umbriel", gender: "male", hint: "easy-going" },
  { id: "Algieba", gender: "male", hint: "smooth" },
  { id: "Algenib", gender: "male", hint: "gravelly" },
  { id: "Rasalgethi", gender: "male", hint: "informative" },
  { id: "Alnilam", gender: "male", hint: "firm" },
  { id: "Schedar", gender: "male", hint: "even" },
  { id: "Achird", gender: "male", hint: "friendly" },
  { id: "Zubenelgenubi", gender: "male", hint: "casual" },
  { id: "Sadachbia", gender: "male", hint: "lively" },
  { id: "Sadaltager", gender: "male", hint: "knowledgeable" },
];
const VOICE_IDS = new Map(ASSESSMENT_VOICES.map((v) => [v.id.toLowerCase(), v.id]));

export const LIMITS = {
  sections: 12,
  itemsPerSection: 20,
  options: 8,
  gaps: 12,
  words: 30,
  textChars: 6000,
  audioChars: 4000,
  dialogueLines: 40,
  speakers: 4,
  maxPlays: 10,
  /** Azure's short-audio endpoint takes 60 s; a margin keeps uploads inside it. */
  maxSeconds: 55,
  maxRecordings: 10,
} as const;

export type MonologueSpec = {
  kind: "monologue";
  text: string;
  voice: string;
  pace: Pace;
  language: string;
  /** Extra direction for the speaker («усталый голос, вокзальное объявление»). */
  style: string;
};

export type DialogueSpec = {
  kind: "dialogue";
  speakers: { name: string; voice: string }[];
  lines: { speaker: string; text: string }[];
  pace: Pace;
  language: string;
  style: string;
};

export type AudioSpec = MonologueSpec | DialogueSpec;

export type TextStimulus = {
  type: "text";
  title: string;
  paragraphs: string[];
  /** Native-language translation; only ever shown in learning mode. */
  translation: string[];
};

export type AudioStimulus = {
  type: "audio";
  audio: AudioSpec;
  /** null = unlimited (learning mode only). */
  max_plays: number | null;
  /** Whether the questions can be answered before the first listening. */
  unlock_questions: "immediately" | "after_first_play";
  /** When the transcript may be shown to the learner. */
  show_transcript: "never" | "after_section" | "after_results";
};

export type Stimulus = TextStimulus | AudioStimulus;

export type ChoiceOption = { id: string; text: string };
export type Gap = { id: string; options: string[]; answer: string; accepted: string[] };

type ItemCommon = {
  id: string;
  prompt: string;
  points: number;
  skill: Skill | null;
  focus: Dimension | null;
  hint: string;
  explanation: string;
  /** Rubric for the teacher; never shown to the learner. */
  criteria: string;
};

export type SingleChoiceItem = ItemCommon & { type: "single_choice"; options: ChoiceOption[]; correct: string };
export type MultipleChoiceItem = ItemCommon & { type: "multiple_choice"; options: ChoiceOption[]; correct: string[] };
export type GapSelectItem = ItemCommon & { type: "gap_select"; text: string; gaps: Gap[] };
export type GapTextItem = ItemCommon & { type: "gap_text"; text: string; gaps: Gap[]; typo_tolerance: boolean };
/** meaning: the Russian sense of the sentence, when a specific thought must be built. */
export type WordOrderItem = ItemCommon & { type: "word_order"; words: string[]; accepted: string[]; meaning: string };
export type ShortAnswerItem = ItemCommon & { type: "short_answer"; accepted: string[]; typo_tolerance: boolean };
export type WritingItem = ItemCommon & { type: "writing"; min_words: number | null; max_words: number | null };
/** A ready native-language text to render in the target language; stays visible beside the answer. */
export type TranslationItem = ItemCommon & { type: "translation"; source: string; accepted: string[] };

type SpeakingCommon = {
  /** Longest recording accepted, in seconds. */
  max_seconds: number;
  /** Recordings that may be sent (technical failures do not count). */
  max_recordings: number;
};
/** Read a given target-language text aloud. */
export type ReadAloudItem = ItemCommon & SpeakingCommon & { type: "read_aloud"; text: string };
/** Hear a phrase (recorded by the app) and say it back. */
export type RepeatItem = ItemCommon & SpeakingCommon & {
  type: "repeat";
  text: string;
  audio: MonologueSpec;
  /** Plays of the sample: a separate limit from max_recordings. */
  sample_max_plays: number | null;
};
/** Answer a question or a situation freely, by voice. */
export type SpokenResponseItem = ItemCommon & SpeakingCommon & { type: "spoken_response"; min_seconds: number | null };
export type SpeakingItem = ReadAloudItem | RepeatItem | SpokenResponseItem;

export type Item =
  | SingleChoiceItem
  | MultipleChoiceItem
  | GapSelectItem
  | GapTextItem
  | WordOrderItem
  | ShortAnswerItem
  | WritingItem
  | TranslationItem
  | ReadAloudItem
  | RepeatItem
  | SpokenResponseItem;

export type Section = {
  id: string;
  title: string;
  instructions: string;
  skill: Skill;
  stimulus: Stimulus | null;
  items: Item[];
};

export type AssessmentSettings = {
  results_release: ResultsRelease;
  /** sequential: a block opens only once the one before it is finished. */
  section_order: "sequential" | "free";
  /** Learning mode: how many times «Ответить» may be pressed per item (null = no limit). */
  max_tries: number | null;
  allow_retake: boolean;
  /** The learner may tap a word for «перевод» / «не знаю это слово»; every use is reported. */
  allow_word_lookup: boolean;
};

export type AssessmentContent = { sections: Section[] };

export type AssessmentDraft = {
  title: string;
  description: string;
  language: string;
  mode: AssessmentMode;
  settings: AssessmentSettings;
  content: AssessmentContent;
};

// ─── Input normalization ─────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

/** Collected while normalizing, so the agent gets every problem in one reply. */
export class ValidationErrors extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`The test is not valid:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "";
}

function strList(value: unknown, maxItems: number, maxLen = 300): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v, maxLen)).filter(Boolean).slice(0, maxItems);
}

function obj(value: unknown): Raw | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function safeId(value: unknown, fallback: string): string {
  const id = str(value, 40).replace(/[^A-Za-z0-9_.-]/g, "");
  return id || fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

export function resolveVoice(value: unknown, fallback: string): string {
  const id = VOICE_IDS.get(str(value, 40).toLowerCase());
  return id ?? fallback;
}

const DEFAULT_VOICES = ["Kore", "Puck", "Leda", "Charon"];

function normalizeAudio(raw: Raw, language: string, path: string, problems: string[]): AudioSpec | null {
  const kind = raw.kind === "dialogue" || Array.isArray(raw.lines) ? "dialogue" : "monologue";
  const pace = oneOf(raw.pace, PACES, "normal");
  const lang = str(raw.language, 10) || language;
  const style = str(raw.style, 300);

  if (kind === "monologue") {
    const text = str(raw.text, LIMITS.audioChars);
    if (!text) problems.push(`${path}.text: a monologue needs the text to be spoken`);
    if (raw.voice && !VOICE_IDS.has(str(raw.voice, 40).toLowerCase())) {
      problems.push(`${path}.voice: unknown voice «${str(raw.voice, 40)}» — see get_assessment_capabilities`);
    }
    return { kind, text, voice: resolveVoice(raw.voice, "Kore"), pace, language: lang, style };
  }

  const rawSpeakers = Array.isArray(raw.speakers) ? raw.speakers.map(obj).filter((s): s is Raw => !!s) : [];
  const rawLines = Array.isArray(raw.lines) ? raw.lines.map(obj).filter((l): l is Raw => !!l) : [];
  const lines = rawLines
    .map((l) => ({ speaker: str(l.speaker, 40), text: str(l.text, 600) }))
    .filter((l) => l.speaker && l.text)
    .slice(0, LIMITS.dialogueLines);
  if (lines.length < 2) problems.push(`${path}.lines: a dialogue needs at least two lines with 'speaker' and 'text'`);

  // Speakers named only in the lines still get a voice, in order of appearance.
  const names = [...rawSpeakers.map((s) => str(s.name, 40)).filter(Boolean)];
  for (const line of lines) if (!names.includes(line.speaker)) names.push(line.speaker);
  if (names.length > LIMITS.speakers) problems.push(`${path}.speakers: at most ${LIMITS.speakers} speakers`);

  const used = new Set<string>();
  const speakers = names.slice(0, LIMITS.speakers).map((name, index) => {
    const declared = rawSpeakers.find((s) => str(s.name, 40) === name);
    if (declared?.voice && !VOICE_IDS.has(str(declared.voice, 40).toLowerCase())) {
      problems.push(`${path}.speakers: unknown voice «${str(declared.voice, 40)}» for ${name}`);
    }
    const fallback = DEFAULT_VOICES.find((v) => !used.has(v)) ?? DEFAULT_VOICES[index % DEFAULT_VOICES.length];
    const voice = resolveVoice(declared?.voice, fallback);
    used.add(voice);
    return { name, voice };
  });
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  if (chars > LIMITS.audioChars) problems.push(`${path}: dialogue is ${chars} characters; the limit is ${LIMITS.audioChars}`);

  return { kind, speakers, lines, pace, language: lang, style };
}

function normalizeStimulus(
  raw: Raw,
  mode: AssessmentMode,
  language: string,
  path: string,
  problems: string[],
): Stimulus | null {
  const type = raw.type === "audio" || obj(raw.audio) ? "audio" : "text";
  if (type === "text") {
    const paragraphs = Array.isArray(raw.paragraphs)
      ? strList(raw.paragraphs, 40, LIMITS.textChars)
      : str(raw.text, LIMITS.textChars).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) problems.push(`${path}.paragraphs: a reading text needs at least one paragraph`);
    return {
      type,
      title: str(raw.title, 200),
      paragraphs,
      translation: strList(raw.translation, 40, LIMITS.textChars),
    };
  }

  const audio = normalizeAudio(obj(raw.audio) ?? {}, language, `${path}.audio`, problems);
  if (!audio) return null;
  const rawMax = raw.max_plays;
  let maxPlays: number | null = typeof rawMax === "number" && Number.isFinite(rawMax)
    ? Math.max(1, Math.min(LIMITS.maxPlays, Math.round(rawMax)))
    : null;
  // A diagnostic listening with no limit is not a diagnostic listening.
  if (mode === "diagnostic" && maxPlays === null) maxPlays = 2;
  return {
    type,
    audio,
    max_plays: maxPlays,
    unlock_questions: oneOf(raw.unlock_questions, ["immediately", "after_first_play"] as const, "immediately"),
    show_transcript: oneOf(
      raw.show_transcript,
      ["never", "after_section", "after_results"] as const,
      mode === "learning" ? "after_section" : "after_results",
    ),
  };
}

function normalizeOptions(raw: unknown, path: string, problems: string[]): ChoiceOption[] {
  const list = Array.isArray(raw) ? raw.slice(0, LIMITS.options) : [];
  const options = list.map((o, i) => {
    const asObj = obj(o);
    const text = asObj ? str(asObj.text, 300) : str(o, 300);
    return { id: asObj ? safeId(asObj.id, String.fromCharCode(97 + i)) : String.fromCharCode(97 + i), text };
  }).filter((o) => o.text);
  if (options.length < 2) problems.push(`${path}.options: at least two options`);
  if (new Set(options.map((o) => o.id)).size !== options.length) problems.push(`${path}.options: option ids must be unique`);
  return options;
}

/** A correct option may be named by id or by its exact text. */
function optionRef(value: unknown, options: ChoiceOption[]): string | null {
  const v = str(value, 300);
  return options.find((o) => o.id === v)?.id ?? options.find((o) => o.text === v)?.id ?? null;
}

const GAP_MARK = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export function gapIdsInText(text: string): string[] {
  return [...text.matchAll(GAP_MARK)].map((m) => m[1]);
}

function normalizeGaps(raw: Raw, withOptions: boolean, path: string, problems: string[]) {
  const text = str(raw.text, 3000);
  const ids = gapIdsInText(text);
  if (ids.length === 0) problems.push(`${path}.text: mark each gap as {{1}}, {{2}}… in the text`);
  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps.map(obj).filter((g): g is Raw => !!g).slice(0, LIMITS.gaps) : [];
  const gaps: Gap[] = rawGaps.map((g, i) => {
    const id = safeId(g.id, ids[i] ?? String(i + 1));
    const answer = str(g.answer ?? g.correct, 200);
    const options = withOptions ? strList(g.options, LIMITS.options, 200) : [];
    if (!answer) problems.push(`${path}.gaps[${id}]: needs 'answer'`);
    if (withOptions && options.length < 2) problems.push(`${path}.gaps[${id}]: needs at least two 'options'`);
    if (withOptions && answer && !options.includes(answer)) problems.push(`${path}.gaps[${id}]: 'answer' must be one of its options`);
    return { id, options, answer, accepted: strList(g.accepted, 10, 200) };
  });
  for (const id of ids) {
    if (!gaps.some((g) => g.id === id)) problems.push(`${path}: gap {{${id}}} has no entry in 'gaps'`);
  }
  for (const gap of gaps) {
    if (!ids.includes(gap.id)) problems.push(`${path}.gaps[${gap.id}]: not marked as {{${gap.id}}} in the text`);
  }
  return { text, gaps };
}

function normalizeItem(
  raw: Raw,
  mode: AssessmentMode,
  fallbackId: string,
  path: string,
  problems: string[],
  language = "de",
): Item | null {
  const type = raw.type as ItemType;
  if (!(ITEM_TYPES as readonly string[]).includes(String(raw.type))) {
    problems.push(`${path}.type: one of ${ITEM_TYPES.join(", ")}`);
    return null;
  }
  const rawPoints = typeof raw.points === "number" ? raw.points : typeof raw.max_score === "number" ? raw.max_score : NaN;
  const common: ItemCommon = {
    id: safeId(raw.id, fallbackId),
    prompt: str(raw.prompt ?? raw.question ?? raw.instruction, 1500),
    points: Number.isFinite(rawPoints) && rawPoints > 0 ? Math.min(100, rawPoints) : defaultPoints(type),
    skill: raw.skill ? oneOf(raw.skill, SKILLS, "grammar") : null,
    focus: raw.focus ? oneOf(raw.focus, DIMENSIONS, "grammar") : null,
    // Diagnostic mode shows no hints at all; storing them would only invite a leak.
    hint: mode === "learning" ? str(raw.hint, 500) : "",
    explanation: str(raw.explanation, 1500),
    criteria: str(raw.criteria, 2000),
  };
  if (!common.prompt && !["gap_select", "gap_text", "read_aloud", "repeat", "translation"].includes(type)) {
    problems.push(`${path}.prompt: every item needs a prompt (the question or the task)`);
  }

  switch (type) {
    case "single_choice": {
      const options = normalizeOptions(raw.options, path, problems);
      const correct = optionRef(raw.correct ?? raw.answer, options);
      if (!correct) problems.push(`${path}.correct: the id (or exact text) of the right option`);
      return { ...common, type, options, correct: correct ?? "" };
    }
    case "multiple_choice": {
      const options = normalizeOptions(raw.options, path, problems);
      const refs = Array.isArray(raw.correct) ? raw.correct : [];
      const correct = [...new Set(refs.map((r) => optionRef(r, options)).filter((r): r is string => !!r))];
      if (correct.length === 0) problems.push(`${path}.correct: an array of the right option ids`);
      return { ...common, type, options, correct };
    }
    case "gap_select":
      return { ...common, type, ...normalizeGaps(raw, true, path, problems) };
    case "gap_text":
      return { ...common, type, ...normalizeGaps(raw, false, path, problems), typo_tolerance: raw.typo_tolerance !== false };
    case "word_order": {
      const words = strList(raw.words, LIMITS.words, 60);
      if (words.length < 2) problems.push(`${path}.words: the sentence's words in the correct order (at least two)`);
      return { ...common, type, words, accepted: strList(raw.accepted, 10, 500), meaning: str(raw.meaning, 500) };
    }
    case "translation": {
      const source = str(raw.source ?? raw.source_text, LIMITS.textChars);
      if (!source) problems.push(`${path}.source: the ready text to translate, in the learner's native language`);
      const accepted = strList(raw.accepted, 20, 2000);
      if (!common.criteria && accepted.length === 0) {
        problems.push(`${path}: a translation needs 'criteria' (what must be conveyed, which grammar) or 'accepted' translations`);
      }
      return { ...common, type, source, accepted };
    }
    case "read_aloud":
    case "repeat":
    case "spoken_response": {
      const speaking = {
        max_seconds: clampInt(raw.max_seconds, 3, LIMITS.maxSeconds, type === "spoken_response" ? 45 : 30),
        max_recordings: clampInt(raw.max_recordings, 1, LIMITS.maxRecordings, mode === "diagnostic" ? 2 : 5),
      };
      if (type === "spoken_response") {
        if (!common.prompt) problems.push(`${path}.prompt: the question or situation to answer`);
        if (!common.criteria) problems.push(`${path}.criteria: what a good answer must contain (you grade it from the transcript)`);
        const min = typeof raw.min_seconds === "number" && raw.min_seconds > 0 ? Math.round(raw.min_seconds) : null;
        return { ...common, ...speaking, type, min_seconds: min };
      }
      const text = str(raw.text, 1000);
      if (!text) problems.push(`${path}.text: the target-language text to ${type === "repeat" ? "say and have repeated" : "read aloud"}`);
      if (type === "read_aloud") return { ...common, ...speaking, type, text };
      const voiceRaw = obj(raw.audio) ?? raw;
      if (voiceRaw.voice && !VOICE_IDS.has(str(voiceRaw.voice, 40).toLowerCase())) {
        problems.push(`${path}.voice: unknown voice «${str(voiceRaw.voice, 40)}»`);
      }
      const rawMax = raw.sample_max_plays;
      let samplePlays: number | null = typeof rawMax === "number" && Number.isFinite(rawMax)
        ? Math.max(1, Math.min(LIMITS.maxPlays, Math.round(rawMax)))
        : null;
      if (mode === "diagnostic" && samplePlays === null) samplePlays = 2;
      return {
        ...common,
        ...speaking,
        type,
        text,
        audio: {
          kind: "monologue",
          text,
          voice: resolveVoice(voiceRaw.voice, "Kore"),
          pace: oneOf(voiceRaw.pace, PACES, "normal"),
          language: str(voiceRaw.language, 10) || language,
          style: str(voiceRaw.style, 300),
        },
        sample_max_plays: samplePlays,
      };
    }
    case "short_answer":
      return { ...common, type, accepted: strList(raw.accepted, 20, 500), typo_tolerance: raw.typo_tolerance !== false };
    case "writing": {
      const min = typeof raw.min_words === "number" && raw.min_words > 0 ? Math.round(raw.min_words) : null;
      const max = typeof raw.max_words === "number" && raw.max_words > 0 ? Math.round(raw.max_words) : null;
      if (!common.criteria) problems.push(`${path}.criteria: a writing task needs grading criteria for the teacher`);
      return { ...common, type, min_words: min, max_words: max };
    }
  }
}

function defaultPoints(type: ItemType): number {
  if (type === "writing" || type === "translation") return 10;
  if (type === "spoken_response") return 5;
  if (type === "read_aloud" || type === "repeat") return 3;
  if (type === "gap_select" || type === "gap_text") return 2;
  return 1;
}

const DEFAULT_SKILL_FOR_STIMULUS = { text: "reading", audio: "listening" } as const;

export function normalizeSettings(raw: unknown, mode: AssessmentMode): AssessmentSettings {
  const s = obj(raw) ?? {};
  let release = oneOf(s.results_release, RESULTS_RELEASE, mode === "learning" ? "immediate" : "after_submit");
  // The defining rule of a diagnostic test: nothing is revealed while answering.
  if (mode === "diagnostic" && release === "immediate") release = "after_section";
  const tries = typeof s.max_tries === "number" && s.max_tries >= 1 ? Math.min(10, Math.round(s.max_tries)) : null;
  return {
    results_release: release,
    section_order: oneOf(s.section_order, ["sequential", "free"] as const, mode === "diagnostic" ? "sequential" : "free"),
    max_tries: mode === "learning" ? tries : 1,
    allow_retake: s.allow_retake === true,
    allow_word_lookup: s.allow_word_lookup !== false,
  };
}

/**
 * The agent's create/update arguments → a test, or every problem at once.
 *
 * Lenient about shape (an option may be a bare string, a correct answer may be
 * named by its text), strict about meaning (a gap without an answer, a choice
 * without a right option): the first is the agent's convenience, the second
 * would be a broken test in front of the learner.
 */
export function normalizeAssessmentInput(args: Raw, fallbackLanguage: string): AssessmentDraft {
  const problems: string[] = [];
  const mode = oneOf(args.mode, ASSESSMENT_MODES, "diagnostic");
  const language = str(args.language, 10) || fallbackLanguage;
  const title = str(args.title, 200);
  if (!title) problems.push("title: required");

  const rawSections = Array.isArray(args.sections) ? args.sections.map(obj).filter((s): s is Raw => !!s) : [];
  if (rawSections.length === 0) problems.push("sections: at least one section with items");
  if (rawSections.length > LIMITS.sections) problems.push(`sections: at most ${LIMITS.sections}`);

  const seenItemIds = new Set<string>();
  const seenSectionIds = new Set<string>();
  const sections: Section[] = rawSections.slice(0, LIMITS.sections).map((raw, si) => {
    const path = `sections[${si}]`;
    let id = safeId(raw.id, `s${si + 1}`);
    if (seenSectionIds.has(id)) { problems.push(`${path}.id: «${id}» is used twice`); id = `${id}_${si + 1}`; }
    seenSectionIds.add(id);

    const stimulusRaw = obj(raw.stimulus);
    const stimulus = stimulusRaw ? normalizeStimulus(stimulusRaw, mode, language, `${path}.stimulus`, problems) : null;
    const explicitSkill = raw.skill ? oneOf(raw.skill, SKILLS, "grammar") : null;

    const rawItems = Array.isArray(raw.items) ? raw.items.map(obj).filter((i): i is Raw => !!i) : [];
    if (rawItems.length === 0) problems.push(`${path}.items: at least one item`);
    if (rawItems.length > LIMITS.itemsPerSection) problems.push(`${path}.items: at most ${LIMITS.itemsPerSection} per section`);
    const items = rawItems.slice(0, LIMITS.itemsPerSection).map((rawItem, ii) => {
      const item = normalizeItem(rawItem, mode, `${id}.${ii + 1}`, `${path}.items[${ii}]`, problems, language);
      if (item) {
        if (seenItemIds.has(item.id)) problems.push(`${path}.items[${ii}].id: «${item.id}» is used twice in the test`);
        seenItemIds.add(item.id);
      }
      return item;
    }).filter((i): i is Item => !!i);

    // No skill given and no stimulus: a block of speaking, translation or
    // writing items is that skill, not «grammar».
    const implied = new Set(items.map((i) => (isSpeakingType(i.type) ? "speaking" : i.type === "translation" ? "translation" : i.type === "writing" ? "writing" : "other")));
    const skill: Skill = explicitSkill
      ?? (stimulus ? DEFAULT_SKILL_FOR_STIMULUS[stimulus.type]
        : implied.size === 1 && !implied.has("other") ? [...implied][0] as Skill : "grammar");

    return {
      id,
      title: str(raw.title, 200) || `Блок ${si + 1}`,
      instructions: str(raw.instructions ?? raw.instruction, 1500),
      skill,
      stimulus,
      items,
    };
  });

  if (problems.length > 0) throw new ValidationErrors(problems);

  return {
    title,
    description: str(args.description, 1000),
    language,
    mode,
    settings: normalizeSettings(args.settings, mode),
    content: { sections },
  };
}

// ─── Small shared helpers ────────────────────────────────────────────────────

export function allItems(content: AssessmentContent): { section: Section; item: Item }[] {
  return content.sections.flatMap((section) => section.items.map((item) => ({ section, item })));
}

export function itemSkill(section: Section, item: Item): Skill {
  if (item.skill) return item.skill;
  if (item.type === "translation") return "translation";
  if (isSpeakingType(item.type)) return "speaking";
  return section.skill;
}

/** Items no auto-check can settle: the teacher agent grades these. */
export function needsTeacher(item: Item): boolean {
  return item.type === "writing"
    || item.type === "spoken_response"
    || ((item.type === "short_answer" || item.type === "translation") && item.accepted.length === 0);
}

/** Every recording the app makes for a test: section stimuli and repeat samples. */
export function audioTargets(content: AssessmentContent): { key: string; spec: AudioSpec; maxPlays: number | null }[] {
  return content.sections.flatMap((section) => [
    ...(section.stimulus?.type === "audio"
      ? [{ key: section.id, spec: section.stimulus.audio, maxPlays: section.stimulus.max_plays }]
      : []),
    ...section.items.flatMap((item) =>
      item.type === "repeat" ? [{ key: `item:${item.id}`, spec: item.audio as AudioSpec, maxPlays: item.sample_max_plays }] : [],
    ),
  ]);
}

/** The words of a word_order item, shuffled the same way every time for one attempt. */
export function shuffledWords(words: string[], seed: string): string[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = words.map((w, i) => ({ w, i }));
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  // A shuffle that lands on the answer is no exercise.
  if (out.length > 1 && out.every((o, i) => o.i === i)) out.push(out.shift()!);
  return out.map((o) => o.w);
}
