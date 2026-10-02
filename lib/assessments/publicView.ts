// What the learner's browser is allowed to see of a test, at this moment.
//
// The stored test holds every right answer, every listening transcript and
// every recording's analysis; this is the one function that decides which of
// them may leave the server, so a diagnostic test cannot be "solved" by reading
// the network tab. Everything the client renders comes out of here.

import {
  answerRecording,
  countedRecordings,
  gradeAll,
  isAnswered,
  pendingTeacherItems,
  summarizeDimensions,
  summarizeSkills,
  totals,
  type AnswerRecord,
  type ItemResult,
  type SpeechState,
  type TeacherReview,
} from "./grading";
import {
  isSpeakingType,
  shuffledWords,
  type AssessmentContent,
  type AssessmentMode,
  type AssessmentSettings,
  type Item,
  type Section,
} from "./model";
import { speechRemarks, TECHNICAL_REASON_RU } from "./azureSpeech";

export type AttemptSnapshot = {
  title: string;
  description: string;
  language: string;
  mode: AssessmentMode;
  settings: AssessmentSettings;
  content: AssessmentContent;
  version: number;
};

/** A word the learner tapped inside a task. */
export type WordMark = {
  word: string;
  /** Where it was tapped: a section id, and the item if it was inside one. */
  section_id: string;
  item_id: string | null;
  context: string;
  unknown: boolean;
  /** Set when «показать перевод» was used — the teacher is told either way. */
  translation: string | null;
  looked_up_at: string | null;
  marked_at: string | null;
};

export type AttemptRow = {
  id: string;
  assessment_id: string;
  user_id: string;
  status: "in_progress" | "submitted" | "reviewed";
  snapshot: AttemptSnapshot;
  answers: Record<string, AnswerRecord>;
  sections: Record<string, { completed_at: string }>;
  listens: Record<string, { used: number; plays: string[] }>;
  speech?: SpeechState;
  word_marks?: Record<string, WordMark>;
  review: TeacherReview | null;
  started_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};

export type AudioState = { status: "pending" | "generating" | "ready" | "error"; duration_ms: number | null };

/** Tries before a learning-mode item gives its answer away on its own. */
export const REVEAL_AFTER_TRIES = 3;

export function wordMarkKey(sectionId: string, itemId: string | null, word: string): string {
  return `${sectionId}|${itemId ?? ""}|${word.toLocaleLowerCase()}`;
}

export function isClosed(attempt: AttemptRow): boolean {
  return attempt.status !== "in_progress";
}

export function isSectionDone(attempt: AttemptRow, sectionId: string): boolean {
  return isClosed(attempt) || Boolean(attempt.sections?.[sectionId]?.completed_at);
}

/**
 * Overall results (scores by skill) may be shown.
 *
 * after_review waits only for what the teacher actually has to grade: an
 * essay the learner never wrote leaves nothing to review, and must not keep
 * the results locked forever.
 */
export function resultsReleased(attempt: AttemptRow): boolean {
  if (!isClosed(attempt)) return false;
  if (attempt.snapshot.settings.results_release !== "after_review") return true;
  if (attempt.status === "reviewed") return true;
  return pendingTeacherItems(attempt.snapshot.content, attempt.answers ?? {}, attempt.review, attempt.speech ?? {}).length === 0;
}

/** This section's right answers and explanations may be shown. */
export function sectionFeedbackReleased(attempt: AttemptRow, sectionId: string): boolean {
  const release = attempt.snapshot.settings.results_release;
  if (release === "immediate" || release === "after_section") return isSectionDone(attempt, sectionId);
  return resultsReleased(attempt);
}

/**
 * Learning mode: has this one item been settled, so its answer and
 * explanation can be shown right now?
 */
export function itemRevealed(attempt: AttemptRow, item: Item, result: ItemResult): boolean {
  const { mode, settings } = attempt.snapshot;
  if (mode !== "learning" || settings.results_release !== "immediate") return false;
  if (isSpeakingType(item.type)) return Boolean(answerRecording(attempt.speech?.[item.id]));
  const record = attempt.answers?.[item.id];
  if (!record || !isAnswered(record)) return false;
  if (record.status === "dont_know" || result.status === "correct") return true;
  if (result.status === "pending_review") return false;
  const limit = settings.max_tries ?? REVEAL_AFTER_TRIES;
  return record.tries >= limit;
}

export function itemLocked(attempt: AttemptRow, section: Section, item: Item, result: ItemResult): boolean {
  if (isSectionDone(attempt, section.id)) return true;
  if (isSpeakingType(item.type)) {
    // A recording can be redone until its allowance is used up.
    const max = (item as { max_recordings: number }).max_recordings;
    return countedRecordings(attempt.speech?.[item.id]) >= max;
  }
  return itemRevealed(attempt, item, result);
}

/** The first section not yet finished — where a sequential test stands. */
export function currentSectionId(attempt: AttemptRow): string | null {
  const open = attempt.snapshot.content.sections.find((s) => !isSectionDone(attempt, s.id));
  return open?.id ?? null;
}

export function sectionAvailable(attempt: AttemptRow, sectionId: string): boolean {
  if (attempt.snapshot.settings.section_order === "free") return true;
  if (isSectionDone(attempt, sectionId)) return true;
  return currentSectionId(attempt) === sectionId;
}

export function listensUsed(attempt: AttemptRow, key: string): number {
  return attempt.listens?.[key]?.used ?? 0;
}

function transcriptVisible(attempt: AttemptRow, section: Section): boolean {
  if (section.stimulus?.type !== "audio") return false;
  const rule = section.stimulus.show_transcript;
  if (rule === "never") return false;
  if (rule === "after_section") return isSectionDone(attempt, section.id);
  return resultsReleased(attempt) || sectionFeedbackReleased(attempt, section.id) && isSectionDone(attempt, section.id);
}

function publicItem(attempt: AttemptRow, item: Item, revealed: boolean, audio: Record<string, AudioState>) {
  const learning = attempt.snapshot.mode === "learning";
  const base = { id: item.id, type: item.type, prompt: item.prompt, points: item.points, hint: learning ? item.hint : "" };
  switch (item.type) {
    case "single_choice":
    case "multiple_choice":
      return { ...base, options: item.options };
    case "gap_select":
      return { ...base, text: item.text, gaps: item.gaps.map((g) => ({ id: g.id, options: g.options })) };
    case "gap_text":
      return { ...base, text: item.text, gaps: item.gaps.map((g) => ({ id: g.id })) };
    case "word_order":
      return {
        ...base,
        words: shuffledWords(item.words, `${attempt.id}:${item.id}`),
        meaning: item.meaning,
        order_instruction: item.meaning ? "" : "Соберите грамматически правильное предложение из всех слов.",
      };
    case "short_answer":
      return base;
    case "writing":
      return { ...base, min_words: item.min_words, max_words: item.max_words };
    case "translation":
      return { ...base, source: item.source };
    case "read_aloud":
    case "repeat":
    case "spoken_response": {
      const speech = attempt.speech?.[item.id];
      const key = `item:${item.id}`;
      const sampleUsed = listensUsed(attempt, key);
      const last = speech?.recordings.at(-1) ?? null;
      return {
        ...base,
        // Read-aloud text is the task itself; a repeat phrase is heard, not
        // read, until its feedback is out.
        text: item.type === "read_aloud" || (item.type === "repeat" && revealed) ? item.text : "",
        max_seconds: item.max_seconds,
        max_recordings: item.max_recordings,
        min_seconds: item.type === "spoken_response" ? item.min_seconds : null,
        recordings_used: countedRecordings(speech),
        last_recording: last
          ? {
              id: last.id,
              status: last.status,
              technical_reason: last.technical_reason,
              technical_message: last.technical_reason ? TECHNICAL_REASON_RU[last.technical_reason] : null,
              duration_ms: last.duration_ms,
              created_at: last.created_at,
            }
          : null,
        sample: item.type === "repeat"
          ? {
              key,
              max_plays: item.sample_max_plays,
              used: sampleUsed,
              remaining: item.sample_max_plays === null ? null : Math.max(0, item.sample_max_plays - sampleUsed),
              audio_status: (audio[key]?.status === "generating" ? "pending" : audio[key]?.status) ?? "pending",
              duration_ms: audio[key]?.duration_ms ?? null,
            }
          : null,
      };
    }
  }
}

export type PublicItem = ReturnType<typeof publicItem> & {
  answer: {
    value: AnswerRecord["value"];
    draft: AnswerRecord["value"];
    status: AnswerRecord["status"] | null;
    tries: number;
  };
  locked: boolean;
  feedback: {
    status: ItemResult["status"];
    score: number | null;
    max: number;
    expected: string;
    explanation: string;
    notes: string[];
    teacher_comment: string;
    corrected: string;
    speech: (NonNullable<ItemResult["speech"]> & { remarks: string[]; recording_id: string | null }) | null;
  } | null;
  /** Learning mode: «неверно, попробуй ещё раз», without the answer. */
  try_again: boolean;
};

export function buildPublicView(
  attempt: AttemptRow,
  audio: Record<string, AudioState>,
  meta: { assessmentId: string },
) {
  const { snapshot } = attempt;
  const speechState = attempt.speech ?? {};
  const results = gradeAll(snapshot.content, attempt.answers ?? {}, attempt.review, speechState);
  const byItem = new Map(results.map((r) => [r.item_id, r]));
  const released = resultsReleased(attempt);

  const sections = snapshot.content.sections.map((section) => {
    const done = isSectionDone(attempt, section.id);
    const feedbackReleased = sectionFeedbackReleased(attempt, section.id);
    const used = listensUsed(attempt, section.id);

    let stimulus: Record<string, unknown> | null = null;
    let questionsLocked = false;
    if (section.stimulus?.type === "text") {
      stimulus = {
        type: "text",
        title: section.stimulus.title,
        paragraphs: section.stimulus.paragraphs,
        // Translations belong to learning mode alone.
        translation: snapshot.mode === "learning" ? section.stimulus.translation : [],
      };
    } else if (section.stimulus?.type === "audio") {
      const s = section.stimulus;
      const state = audio[section.id] ?? { status: "pending", duration_ms: null };
      const showTranscript = transcriptVisible(attempt, section);
      questionsLocked = !done && s.unlock_questions === "after_first_play" && used === 0;
      stimulus = {
        type: "audio",
        kind: s.audio.kind,
        speakers: s.audio.kind === "dialogue" ? s.audio.speakers.map((sp) => sp.name) : [],
        max_plays: s.max_plays,
        used,
        remaining: s.max_plays === null ? null : Math.max(0, s.max_plays - used),
        unlock_questions: s.unlock_questions,
        audio_status: state.status === "generating" ? "pending" : state.status,
        duration_ms: state.duration_ms,
        transcript: showTranscript
          ? s.audio.kind === "monologue"
            ? [{ speaker: "", text: s.audio.text }]
            : s.audio.lines
          : null,
      };
    }

    const items: PublicItem[] = section.items.map((item) => {
      const result = byItem.get(item.id)!;
      const record = attempt.answers?.[item.id];
      const revealed = itemRevealed(attempt, item, result) || feedbackReleased;
      const speaking = isSpeakingType(item.type);
      const attempted = speaking ? Boolean(attempt.speech?.[item.id]?.recordings.length) : isAnswered(record);
      const learningCheck = snapshot.mode === "learning" && snapshot.settings.results_release === "immediate";
      const used = answerRecording(speechState[item.id]);
      return {
        ...publicItem(attempt, item, revealed, audio),
        answer: {
          value: record?.value ?? null,
          draft: record?.draft ?? null,
          status: record?.status ?? null,
          tries: record?.tries ?? 0,
        },
        locked: itemLocked(attempt, section, item, result),
        feedback: revealed && (attempted || done)
          ? {
              status: result.status,
              score: result.score,
              max: result.max,
              expected: result.expected,
              explanation: item.explanation,
              notes: result.notes,
              teacher_comment: result.teacher_comment,
              corrected: result.corrected,
              speech: result.speech
                ? { ...result.speech, remarks: speechRemarks(result.speech.words, item.type !== "spoken_response"), recording_id: used?.id ?? null }
                : null,
            }
          : null,
        try_again: !speaking && learningCheck && !revealed && isAnswered(record) && record?.status === "answered"
          && result.status !== "correct" && result.status !== "pending_review",
      };
    });

    return {
      id: section.id,
      title: section.title,
      instructions: section.instructions,
      skill: section.skill,
      stimulus,
      questions_locked: questionsLocked,
      items: questionsLocked ? [] : items,
      item_count: section.items.length,
      answered: section.items.filter((i) => isSpeakingType(i.type)
        ? Boolean(answerRecording(speechState[i.id]))
        : isAnswered(attempt.answers?.[i.id])).length,
      completed: done,
      available: sectionAvailable(attempt, section.id),
    };
  });

  return {
    assessment: {
      id: meta.assessmentId,
      title: snapshot.title,
      description: snapshot.description,
      mode: snapshot.mode,
      language: snapshot.language,
      results_release: snapshot.settings.results_release,
      section_order: snapshot.settings.section_order,
      allow_word_lookup: snapshot.settings.allow_word_lookup !== false,
    },
    attempt: {
      id: attempt.id,
      status: attempt.status,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      reviewed_at: attempt.reviewed_at,
    },
    current_section_id: currentSectionId(attempt),
    sections,
    word_marks: Object.entries(attempt.word_marks ?? {}).map(([key, m]) => ({
      key, word: m.word, section_id: m.section_id, item_id: m.item_id, unknown: m.unknown, translation: m.translation,
    })),
    results: released
      ? {
          totals: totals(results),
          skills: summarizeSkills(snapshot.content, results),
          dimensions: summarizeDimensions(results),
          summary: attempt.review?.summary ?? "",
          gaps: (attempt.review?.gaps ?? []).map((g) => ({ topic: g.topic, description: g.description })),
        }
      : null,
    awaiting_review: isClosed(attempt) && !released,
  };
}

export type PublicAssessmentView = ReturnType<typeof buildPublicView>;
