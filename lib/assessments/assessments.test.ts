// Interactive tests: input validation, grading, and — the one that matters
// most — that a diagnostic test's answers and transcripts never reach the
// learner's browser before the teacher's chosen moment.

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessmentInput, shuffledWords, ValidationErrors, type AssessmentDraft } from "./model.ts";
import { autoGrade, compareText, gradeAll, summarizeSkills, totals, type AnswerRecord } from "./grading.ts";
import { buildPublicView, type AttemptRow } from "./publicView.ts";
import { pcmToWav, stitchPcm, audioSpecHash } from "./speech.ts";
import { dictionaryKey } from "../mcp/assessmentTools.ts";
import { cleanValue, readableAnswer } from "./store.ts";

const INPUT = {
  title: "Проверка A2",
  mode: "diagnostic",
  sections: [
    {
      id: "read",
      stimulus: { type: "text", paragraphs: ["Der Zug fährt von Gleis 7."], translation: ["Поезд отходит с пути 7."] },
      items: [
        { id: "r1", type: "single_choice", prompt: "Gleis?", options: ["5", "7"], correct: "7", hint: "секрет" },
        { id: "r2", type: "gap_text", text: "Ich {{1}} nach {{2}}.", gaps: [{ id: "1", answer: "fahre" }, { id: "2", answer: "Köln" }] },
      ],
    },
    {
      id: "listen",
      stimulus: {
        type: "audio",
        audio: { kind: "dialogue", lines: [{ speaker: "Anna", text: "Hallo Ben!" }, { speaker: "Ben", text: "Hallo Anna, wie geht's?" }] },
      },
      items: [{ id: "l1", type: "multiple_choice", prompt: "Wer?", options: ["Anna", "Ben", "Carl"], correct: ["Anna", "Ben"] }],
    },
    {
      id: "write",
      skill: "writing",
      items: [
        { id: "w1", type: "writing", prompt: "Schreiben Sie.", criteria: "Perfekt", min_words: 3 },
        { id: "w2", type: "word_order", prompt: "Satz", words: ["Ich", "bin", "müde"] },
      ],
    },
  ],
};

function draft(input: Record<string, unknown> = INPUT): AssessmentDraft {
  return normalizeAssessmentInput(input, "de");
}

function answer(value: AnswerRecord["value"], status: AnswerRecord["status"] = "answered", tries = 1): AnswerRecord {
  return { value, status, first_value: value, first_status: status, first_at: "t", history: [{ value, status, at: "t" }], tries, updated_at: "t" };
}

function attemptOf(d: AssessmentDraft, patch: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    assessment_id: "a",
    user_id: "u",
    status: "in_progress",
    snapshot: { title: d.title, description: d.description, language: d.language, mode: d.mode, settings: d.settings, content: d.content, version: 1 },
    answers: {},
    sections: {},
    listens: {},
    review: null,
    started_at: "t",
    submitted_at: null,
    reviewed_at: null,
    ...patch,
  };
}

test("normalization fills defaults: voices, play limit, diagnostic release, no hints", () => {
  const d = draft();
  const listen = d.content.sections[1];
  assert.equal(listen.skill, "listening");
  assert.equal(listen.stimulus?.type, "audio");
  if (listen.stimulus?.type !== "audio" || listen.stimulus.audio.kind !== "dialogue") throw new Error("dialogue expected");
  assert.equal(listen.stimulus.max_plays, 2, "a diagnostic listening is limited by default");
  assert.deepEqual(listen.stimulus.audio.speakers.map((s) => s.voice), ["Kore", "Puck"]);
  assert.equal(d.settings.results_release, "after_submit");
  assert.equal(d.settings.section_order, "sequential");
  const r1 = d.content.sections[0].items[0];
  assert.equal(r1.hint, "", "diagnostic mode stores no hints");
  if (r1.type !== "single_choice") throw new Error();
  assert.equal(r1.correct, "b", "a correct option may be named by its text");
});

test("normalization lists every problem at once", () => {
  try {
    normalizeAssessmentInput({
      sections: [{ items: [
        { type: "single_choice", prompt: "x", options: ["a"] },
        { type: "gap_text", text: "no gaps here", gaps: [] },
        { type: "writing", prompt: "w" },
        { type: "nonsense" },
      ] }],
    }, "de");
    assert.fail("should throw");
  } catch (error) {
    assert.ok(error instanceof ValidationErrors);
    const text = error.problems.join("\n");
    assert.match(text, /title: required/);
    assert.match(text, /at least two options/);
    assert.match(text, /mark each gap/);
    assert.match(text, /criteria/);
    assert.match(text, /type: one of/);
  }
});

test("diagnostic mode cannot release answers immediately", () => {
  const d = draft({ ...INPUT, settings: { results_release: "immediate" } });
  assert.equal(d.settings.results_release, "after_section");
});

test("text comparison: exact, typo, umlaut spelling, and grammar strictness", () => {
  assert.equal(compareText(" Köln. ", ["Köln"]), "exact");
  assert.equal(compareText("Koeln", ["Köln"]), "exact", "ae/oe/ue/ss for umlauts is not an error");
  assert.equal(compareText("Strasse", ["Straße"]), "exact");
  assert.equal(compareText("Koeln", ["Köln"], true, true), "near", "unless the item is a spelling task");
  assert.equal(compareText("Koln", ["Köln"]), "near", "a missing umlaut is still a typo");
  assert.equal(compareText("Haltestele", ["Haltestelle"]), "near");
  assert.equal(compareText("Bahnhof", ["Haltestelle"]), "none");
  assert.equal(compareText("dem", ["den"]), "none", "short words get no typo slack");
  assert.equal(compareText("einen", ["einem"], false), "none", "no slack when the ending is the point");
  assert.equal(compareText("köln", ["Köln"], false), "near", "case alone is a spelling slip");
});

test("a typo keeps half the points, marks spelling, and asks the teacher", () => {
  const d = draft();
  const section = d.content.sections[0];
  const r = autoGrade(section, section.items[1], answer({ "1": "fahre", "2": "Koln" }));
  assert.equal(r.status, "partial");
  assert.equal(r.score, 1.5);
  assert.equal(r.dimensions.spelling, "error");
  assert.equal(r.dimensions.meaning, "ok");
  assert.equal(r.needs_teacher_check, true);
});

test("multiple choice gives partial credit; «не знаю» is its own status; writing waits for the teacher", () => {
  const d = draft();
  const [s1, s2, s3] = d.content.sections;
  const partial = autoGrade(s2, s2.items[0], answer(["a"]));
  assert.equal(partial.status, "partial");
  assert.equal(partial.score, 0.5);
  assert.equal(autoGrade(s1, s1.items[0], answer(null, "dont_know")).status, "dont_know");
  const essay = autoGrade(s3, s3.items[0], answer("Ich bin."));
  assert.equal(essay.status, "pending_review");
  assert.equal(essay.score, null);
  assert.match(essay.notes[0], /минимуме 3/);
  assert.equal(autoGrade(s3, s3.items[1], answer(["Ich", "bin", "müde"])).status, "correct");
});

test("skills leave pending and skipped items out of the percentage, and say so", () => {
  const d = draft();
  const results = gradeAll(d.content, { r1: answer("b"), w1: answer("Ich bin heute müde."), w2: answer(["Ich", "bin", "müde"]) }, null);
  const writing = summarizeSkills(d.content, results).find((s) => s.skill === "writing")!;
  assert.equal(writing.pending_review, 1);
  assert.equal(writing.max, 1, "only the word-order item counts until the essay is graded");
  assert.equal(totals(results).pending_review, 1);

  const skipped = gradeAll(d.content, { r1: answer("b") }, null);
  const w = summarizeSkills(d.content, skipped).find((s) => s.skill === "writing")!;
  assert.equal(w.state, "not_done", "a skipped essay is «not done», not weak writing");
  assert.equal(w.percent, null);
  const t = totals(skipped);
  assert.ok(t.skipped_points > 0);
  assert.equal(t.percent_of_attempted, 100);
});

test("diagnostic view leaks no answers, hints, translations or transcripts while in progress", () => {
  const d = draft();
  const attempt = attemptOf(d, { answers: { r1: answer("a") } });
  const view = buildPublicView(attempt, { listen: { status: "ready", duration_ms: 3000 } }, { assessmentId: "a" });
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /fahre/, "gap answers stay on the server");
  assert.doesNotMatch(json, /Hallo Ben/, "transcript stays on the server");
  assert.doesNotMatch(json, /Поезд/, "no translation in diagnostic mode");
  assert.doesNotMatch(json, /секрет/);
  assert.doesNotMatch(json, /"correct"/);
  assert.equal(view.sections[0].items[0].feedback, null);
  assert.equal(view.results, null);
  assert.equal(view.sections[2].available, false, "sequential: later blocks wait");
});

test("after the section is finished its feedback is released only when settings say so", () => {
  const d = draft({ ...INPUT, settings: { results_release: "after_section" } });
  const attempt = attemptOf(d, { answers: { r1: answer("a") }, sections: { read: { completed_at: "t" } } });
  const view = buildPublicView(attempt, {}, { assessmentId: "a" });
  assert.equal(view.sections[0].items[0].feedback?.status, "incorrect");
  assert.equal(view.sections[0].items[0].feedback?.expected, "7");
  assert.equal(view.sections[0].items[0].locked, true);
  assert.equal(view.sections[1].items[0].feedback, null, "the open section stays closed");
});

test("listening counter and transcript follow the attempt, not the page", () => {
  const d = draft();
  const attempt = attemptOf(d, { listens: { listen: { used: 2, plays: ["t1", "t2"] } }, sections: { read: { completed_at: "t" } } });
  const view = buildPublicView(attempt, { listen: { status: "ready", duration_ms: 3000 } }, { assessmentId: "a" });
  const stim = view.sections[1].stimulus as { remaining: number; transcript: unknown };
  assert.equal(stim.remaining, 0);
  assert.equal(stim.transcript, null);

  const reviewed = attemptOf(d, { status: "reviewed", listens: attempt.listens });
  const after = buildPublicView(reviewed, {}, { assessmentId: "a" });
  assert.ok((after.sections[1].stimulus as { transcript: unknown }).transcript, "transcript after results");
  assert.ok(after.results);
});

test("learning mode: feedback after a correct answer, «try again» before, answer after three misses", () => {
  const d = draft({ ...INPUT, mode: "learning" });
  const s = (a: Record<string, AnswerRecord>) => buildPublicView(attemptOf(d, { answers: a }), {}, { assessmentId: "a" }).sections[0].items[0];
  assert.equal(s({ r1: answer("a", "answered", 1) }).try_again, true);
  assert.equal(s({ r1: answer("a", "answered", 1) }).feedback, null);
  assert.equal(s({ r1: answer("a", "answered", 3) }).feedback?.expected, "7");
  assert.equal(s({ r1: answer("b") }).feedback?.status, "correct");
  assert.equal(s({ r1: answer("b") }).hint, "секрет");
});

test("after_review holds results until the teacher has graded, unless nothing needs grading", () => {
  const d = draft({ ...INPUT, settings: { results_release: "after_review" } });
  const withEssay = buildPublicView(attemptOf(d, { status: "submitted", answers: { w1: answer("Ich bin müde.") } }), {}, { assessmentId: "a" });
  assert.equal(withEssay.results, null);
  assert.equal(withEssay.awaiting_review, true);
  assert.equal(withEssay.sections[0].items[0].feedback, null);

  // The bug that left an attempt locked forever: the essay was never written,
  // so nothing waits for the teacher, and results must be released.
  const draftOnly: AnswerRecord = { ...answer(null), draft: "", tries: 0, first_at: "", history: [] };
  const emptyEssay = buildPublicView(attemptOf(d, { status: "submitted", answers: { w1: draftOnly } }), {}, { assessmentId: "a" });
  assert.ok(emptyEssay.results);
  assert.equal(emptyEssay.awaiting_review, false);
});

test("a draft is not an answer", () => {
  const d = draft();
  const draftOnly: AnswerRecord = { ...answer(null), draft: "a", tries: 0, first_at: "" };
  const view = buildPublicView(attemptOf(d, { answers: { r1: draftOnly } }), {}, { assessmentId: "a" });
  assert.equal(view.sections[0].answered, 0);
  assert.equal(view.sections[0].items[0].answer.draft, "a");
});

test("word order is shuffled, stable per attempt, never already solved", () => {
  const words = ["Ich", "bin", "müde"];
  for (let i = 0; i < 50; i++) {
    const once = shuffledWords(words, `seed${i}`);
    assert.deepEqual(once, shuffledWords(words, `seed${i}`));
    assert.notDeepEqual(once, words);
    assert.deepEqual([...once].sort(), [...words].sort());
  }
});

test("answers are held to their item's shape and read back as text", () => {
  const d = draft();
  const [s1, s2] = d.content.sections;
  assert.equal(cleanValue(s1.items[0], "zzz"), null);
  assert.deepEqual(cleanValue(s2.items[0], ["a", "evil"]), ["a"]);
  assert.equal(readableAnswer(s2.items[0], ["a", "b"]), "Anna; Ben");
  assert.equal(readableAnswer(s1.items[1], { "1": "fahre" }), "Ich [fahre] nach [—].");
});

test("stitched audio and its WAV header agree", () => {
  const a = { pcm: Buffer.alloc(4800), sampleRate: 24000 };
  const joined = stitchPcm([a, a], 100);
  assert.equal(joined.pcm.length, 4800 * 2 + 2400 * 2);
  const wav = pcmToWav(joined.pcm, 24000);
  assert.equal(wav.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), joined.pcm.length);
  assert.throws(() => stitchPcm([a, { pcm: Buffer.alloc(2), sampleRate: 16000 }]));
});

test("the audio cache key changes with anything that changes the sound", () => {
  const d = draft();
  const s = d.content.sections[1].stimulus;
  if (s?.type !== "audio") throw new Error();
  const base = audioSpecHash(s.audio, "m");
  assert.equal(base, audioSpecHash(structuredClone(s.audio), "m"));
  assert.notEqual(base, audioSpecHash({ ...s.audio, pace: "slow" }, "m"));
  assert.notEqual(base, audioSpecHash(s.audio, "other-model"));
});

test("dictionary matching ignores articles and case", () => {
  assert.equal(dictionaryKey("der Bahnhof"), dictionaryKey("Bahnhof"));
  assert.equal(dictionaryKey("Die Haltestelle"), "haltestelle");
  assert.notEqual(dictionaryKey("Bahnhof"), dictionaryKey("Bahnhöfe"));
});
