// Speaking tasks and translation: Azure's answer as the app reads it, grading
// that keeps pronunciation apart from content, technical failures that never
// become low scores, and a diagnostic view that keeps all of it hidden.

import assert from "node:assert/strict";
import test from "node:test";
import { inspectWav, normalizeAzureAnswer, speechRemarks } from "./azureSpeech.ts";
import { normalizeAssessmentInput, ValidationErrors, audioTargets, itemSkill } from "./model.ts";
import { autoGrade, countedRecordings, gradeAll, pendingTeacherItems, summarizeSkills, type AnswerRecord, type SpeechRecording } from "./grading.ts";
import { buildPublicView, wordMarkKey, type AttemptRow } from "./publicView.ts";
import { pcmToWav } from "./speech.ts";

// A real de-DE answer (2026-10-02): the text read was «…nach Berlin… zwanzig…»
// against the reference «…nach Köln… fünfzehn…».
const AZURE_MISMATCH = {"RecognitionStatus":"Success","DisplayText":"Der Zug nach Köln hat heute Zug Minuten Verspätung.","NBest":[{"Display":"Der Zug nach Köln hat heute Zug Minuten Verspätung.","AccuracyScore":69,"FluencyScore":76,"CompletenessScore":78,"PronScore":72.2,"Words":[{"Word":"Der","Offset":1100000,"Duration":2500000,"AccuracyScore":91,"ErrorType":"None"},{"Word":"Zug","Offset":3700000,"Duration":2500000,"AccuracyScore":94,"ErrorType":"None"},{"Word":"nach","Offset":6300000,"Duration":2100000,"AccuracyScore":91,"ErrorType":"None"},{"Word":"Köln","Offset":8500000,"Duration":3300000,"AccuracyScore":1,"ErrorType":"Mispronunciation"},{"Word":"hat","Offset":11900000,"Duration":1700000,"AccuracyScore":94,"ErrorType":"None"},{"Word":"heute","Offset":13700000,"Duration":3300000,"AccuracyScore":97,"ErrorType":"None"},{"Word":"Zug","Offset":17100000,"Duration":4200000,"AccuracyScore":94,"ErrorType":"Insertion"},{"Word":"fünfzehn","Offset":0,"Duration":0,"AccuracyScore":0,"ErrorType":"Omission"},{"Word":"Minuten","Offset":21400000,"Duration":3800000,"AccuracyScore":88,"ErrorType":"None"},{"Word":"Verspätung","Offset":25300000,"Duration":8100000,"AccuracyScore":67,"ErrorType":"None"}]}]};

const INPUT = {
  title: "Говорение",
  mode: "diagnostic",
  sections: [
    {
      id: "speak",
      items: [
        { id: "s1", type: "read_aloud", text: "Der Zug nach Köln hat heute fünfzehn Minuten Verspätung." },
        { id: "s2", type: "repeat", text: "Ich hätte gern eine Fahrkarte.", voice: "Charon", pace: "slow" },
        { id: "s3", type: "spoken_response", prompt: "Was machen Sie am Wochenende?", criteria: "3 Sätze" },
      ],
    },
    { id: "tr", items: [{ id: "t1", type: "translation", source: "Я живу в Берлине.", criteria: "Präsens, in + Dativ", accepted: ["Ich wohne in Berlin", "Ich lebe in Berlin"] }] },
  ],
};

function recording(id: string, analysis: ReturnType<typeof normalizeAzureAnswer>): SpeechRecording {
  return analysis.status === "done"
    ? { id, storage_path: `p/${id}`, duration_ms: 3000, created_at: "t", status: "done", technical_reason: null, transcript: analysis.transcript, scores: analysis.scores, words: analysis.words, raw: analysis.raw, analyzed_at: "t" }
    : { id, storage_path: `p/${id}`, duration_ms: 3000, created_at: "t", status: "technical_error", technical_reason: analysis.reason, transcript: null, scores: null, words: [], raw: analysis.raw, analyzed_at: "t" };
}

function attemptOf(mode: "learning" | "diagnostic", patch: Partial<AttemptRow> = {}): AttemptRow {
  const d = normalizeAssessmentInput({ ...INPUT, mode, settings: mode === "learning" ? { results_release: "immediate" } : {} }, "de");
  return {
    id: "00000000-0000-0000-0000-000000000002", assessment_id: "a", user_id: "u", status: "in_progress",
    snapshot: { title: d.title, description: "", language: "de", mode, settings: d.settings, content: d.content, version: 1 },
    answers: {}, sections: {}, listens: {}, speech: {}, word_marks: {}, review: null,
    started_at: "t", submitted_at: null, reviewed_at: null, ...patch,
  };
}

test("Azure's German answer: real scores, per-word errors and timings, no invented prosody", () => {
  const a = normalizeAzureAnswer(AZURE_MISMATCH, true);
  assert.equal(a.status, "done");
  if (a.status !== "done") return;
  assert.deepEqual(a.scores, { pronunciation: 72.2, accuracy: 69, fluency: 76, completeness: 78, prosody: null });
  assert.equal(a.words.find((w) => w.word === "Köln")?.error_type, "Mispronunciation");
  assert.equal(a.words.find((w) => w.word === "fünfzehn")?.error_type, "Omission");
  assert.equal(a.words[3].offset_ms, 850, "100-ns ticks become milliseconds");
  const remarks = speechRemarks(a.words, true).join(" ");
  assert.match(remarks, /Неточно произнесено: «Köln»/);
  assert.match(remarks, /Пропущено: «fünfzehn»/);
  assert.match(remarks, /Лишнее/);
  assert.doesNotMatch(remarks, /звук|фонем/i, "no sound names: Azure gives none for German");
});

test("a free answer has no completeness; silence and noise are technical, not scores", () => {
  const free = normalizeAzureAnswer(AZURE_MISMATCH, false);
  assert.equal(free.status === "done" && free.scores.completeness, null);
  assert.deepEqual(speechRemarks(free.status === "done" ? free.words : [], false).some((r) => /Пропущено/.test(r)), false);
  const silent = normalizeAzureAnswer({ RecognitionStatus: "InitialSilenceTimeout" }, true);
  assert.equal(silent.status === "technical_error" && silent.reason, "silence");
  assert.equal(normalizeAzureAnswer({ RecognitionStatus: "NoMatch" }, true).status, "technical_error");
  assert.equal(normalizeAzureAnswer({ RecognitionStatus: "Success", NBest: [{ Display: "" }] }, true).status, "technical_error");
  // The real answer to six seconds of silence read against a reference text.
  const scriptedSilence = normalizeAzureAnswer({
    RecognitionStatus: "Success", DisplayText: ".",
    NBest: [{ Display: ".", AccuracyScore: 0, FluencyScore: 0, CompletenessScore: 0, PronScore: 0, Words: [{ Word: "Der", ErrorType: "Omission" }, { Word: "Zug", ErrorType: "Omission" }] }],
  }, true);
  assert.equal(scriptedSilence.status === "technical_error" && scriptedSilence.reason, "silence");
});

test("uploads are checked for the one format Azure is sent", () => {
  const wav = pcmToWav(Buffer.alloc(16000 * 2), 16000);
  assert.deepEqual(inspectWav(wav), { channels: 1, sampleRate: 16000, bitsPerSample: 16, durationMs: 1000 });
  assert.equal(inspectWav(Buffer.from("not a wav file at all, definitely not")), null);
});

test("speaking and translation items normalize, with separate limits for sample and recordings", () => {
  const d = normalizeAssessmentInput(INPUT, "de");
  const [s1, s2, s3] = d.content.sections[0].items;
  assert.equal(s1.type === "read_aloud" && s1.max_recordings, 2, "diagnostic default");
  assert.ok(s2.type === "repeat" && s2.sample_max_plays === 2 && s2.audio.voice === "Charon" && s2.audio.pace === "slow");
  assert.equal(s3.type === "spoken_response" && s3.max_seconds, 45);
  assert.equal(itemSkill(d.content.sections[0], s1), "speaking");
  assert.equal(itemSkill(d.content.sections[1], d.content.sections[1].items[0]), "translation");
  assert.deepEqual(audioTargets(d.content).map((t) => t.key), ["item:s2"], "repeat samples are recorded like listenings");

  assert.throws(
    () => normalizeAssessmentInput({ title: "x", sections: [{ items: [{ type: "spoken_response" }, { type: "translation" }, { type: "read_aloud" }] }] }, "de"),
    (e: unknown) => e instanceof ValidationErrors && /question or situation/.test(e.message) && /ready text to translate/.test(e.message) && /read aloud/.test(e.message),
  );
});

test("pronunciation is scored automatically; free spoken content waits for the teacher", () => {
  const d = normalizeAssessmentInput(INPUT, "de");
  const section = d.content.sections[0];
  const done = recording("r1", normalizeAzureAnswer(AZURE_MISMATCH, true));
  const read = autoGrade(section, section.items[0], undefined, { recordings: [done] });
  assert.equal(read.status, "partial");
  assert.equal(read.score, 2.25, "3 points × 72.2 / 100, to a quarter");
  assert.equal(read.speech?.transcript, AZURE_MISMATCH.DisplayText);
  const free = autoGrade(section, section.items[2], undefined, { recordings: [done] });
  assert.equal(free.status, "pending_review");
  assert.equal(free.score, null);
});

test("a technical failure is a status, does not use up a recording, and is not counted as weak speaking", () => {
  const d = normalizeAssessmentInput(INPUT, "de");
  const section = d.content.sections[0];
  const silent = recording("r0", normalizeAzureAnswer({ RecognitionStatus: "InitialSilenceTimeout" }, true));
  const state = { recordings: [silent] };
  assert.equal(countedRecordings(state), 0);
  const r = autoGrade(section, section.items[0], undefined, state);
  assert.equal(r.status, "technical_issue");
  assert.equal(r.score, null);
  const results = gradeAll(d.content, {}, null, { s1: state });
  const speaking = summarizeSkills(d.content, results).find((s) => s.skill === "speaking")!;
  assert.equal(speaking.technical_issues, 1);
  assert.equal(speaking.max, 0);
});

test("translation: an accepted version counts, any other version goes to the teacher", () => {
  const d = normalizeAssessmentInput(INPUT, "de");
  const section = d.content.sections[1];
  const answer = (v: string): AnswerRecord => ({ value: v, status: "answered", first_value: v, first_status: "answered", first_at: "t", history: [], tries: 1, updated_at: "t" });
  assert.equal(autoGrade(section, section.items[0], answer("Ich lebe in Berlin.")).status, "correct");
  assert.equal(autoGrade(section, section.items[0], answer("Mein Wohnort ist Berlin.")).status, "pending_review");
  assert.deepEqual(pendingTeacherItems(d.content, { t1: answer("Mein Wohnort ist Berlin.") }, null), ["t1"]);
});

test("diagnostic view hides transcript, scores and the repeat phrase; learning view shows them", () => {
  const done = recording("r1", normalizeAzureAnswer(AZURE_MISMATCH, true));
  const diag = buildPublicView(attemptOf("diagnostic", { speech: { s1: { recordings: [done] }, s2: { recordings: [done] } } }), {}, { assessmentId: "a" });
  const json = JSON.stringify(diag);
  assert.doesNotMatch(json, /Zug Minuten/, "no transcript");
  assert.doesNotMatch(json, /72\.2/, "no score");
  assert.doesNotMatch(json, /Fahrkarte/, "the phrase to repeat is heard, not read");
  const s1 = diag.sections[0].items[0] as unknown as { recordings_used: number; feedback: unknown };
  assert.equal(s1.recordings_used, 1);
  assert.equal(s1.feedback, null);

  const learn = buildPublicView(attemptOf("learning", { speech: { s1: { recordings: [done] } } }), {}, { assessmentId: "a" });
  const fb = learn.sections[0].items[0].feedback;
  assert.equal(fb?.speech?.scores.pronunciation, 72.2);
  assert.ok(fb?.speech?.remarks.some((r) => r.includes("Köln")));
});

test("a word mark is keyed the same way everywhere", () => {
  assert.equal(wordMarkKey("read", null, "Verspätung"), "read||verspätung");
  assert.equal(wordMarkKey("read", "r1", "Gleis"), "read|r1|gleis");
});
