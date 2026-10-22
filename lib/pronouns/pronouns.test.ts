// The pronoun trainer's promises, checked on the brief's own examples: each
// part of an answer judged on its own, a role swap counted once, unsure
// answers sent for review, and no construction the learner has not switched on.

import assert from "node:assert/strict";
import test from "node:test";
import { VERBS, verbUsable } from "./catalog.ts";
import { DEFAULT_CONFIG, sessionFromConfig, validateConfigPatch, validateSessionSettings } from "./config.ts";
import { checkBlanks, checkSentence } from "./check.ts";
import { buildGerman, buildRussian, candidateSpecs, followUps, makeTask, planSession, rng, type TaskSpec } from "./tasks.ts";

let n = 0;
const id = () => `t${++n}`;

function task(spec: Partial<TaskSpec>, mode: "written" | "spoken" | "choice" | "gaps" = "written") {
  return makeTask({ kind: "people", verb: "sehen", sentenceType: "statement", modal: false, subject: "sie_pl", object: "wir", noun: null, ...spec }, mode, { id: id(), focusRole: "object", random: rng(1) });
}

test("sentences are built slot by slot, in German and natural Russian", () => {
  assert.equal(buildGerman({ kind: "people", verb: "sehen", sentenceType: "statement", modal: false, subject: "ich", object: "du", noun: null }).text, "Ich sehe dich.");
  assert.equal(buildGerman({ kind: "people", verb: "sehen", sentenceType: "question", modal: false, subject: "ihr", object: "ich", noun: null }).text, "Seht ihr mich?");
  assert.equal(buildGerman({ kind: "people", verb: "abholen", sentenceType: "question", modal: true, subject: "ihr", object: "sie_sg", noun: null }).text, "Könnt ihr sie abholen?");
  assert.equal(buildGerman({ kind: "people", verb: "warten_auf", sentenceType: "statement", modal: false, subject: "wir", object: "ihr", noun: null }).text, "Wir warten auf euch.");
  assert.equal(buildGerman({ kind: "people", verb: "anrufen", sentenceType: "statement", modal: false, subject: "ich", object: "ihr", noun: null }).text, "Ich rufe euch an.");
  assert.equal(buildGerman({ kind: "people", verb: "sehen", sentenceType: "negation", modal: false, subject: "ich", object: "sie_sg", noun: null }).text, "Ich sehe sie nicht.");
  assert.equal(buildGerman({ kind: "people", verb: "warten_auf", sentenceType: "negation", modal: false, subject: "ich", object: "du", noun: null }).text, "Ich warte nicht auf dich.");
  assert.equal(buildGerman({ kind: "noun", verb: "finden", sentenceType: "negation", modal: true, subject: "ich", object: "sie_sg", noun: "tasche" }).text, "Ich kann sie nicht finden.");

  const ru = buildRussian({ kind: "people", verb: "sehen", sentenceType: "statement", modal: false, subject: "sie_pl", object: "wir", noun: null });
  assert.equal(ru.text, "Они видят нас.");
  assert.deepEqual(buildRussian({ kind: "people", verb: "sehen", sentenceType: "statement", modal: false, subject: "ich", object: "ihr", noun: null }).notes, ["вас — несколько друзей"]);
  assert.deepEqual(buildRussian({ kind: "people", verb: "sehen", sentenceType: "question", modal: false, subject: "Sie", object: "ich", noun: null }).notes, ["Вы — вежливое обращение"]);
  assert.equal(buildRussian({ kind: "people", verb: "anrufen", sentenceType: "statement", modal: false, subject: "ich", object: "sie_pl", noun: null }).text, "Я звоню им.");
  // The Russian pronoun follows the Russian noun; the German one, the German noun.
  assert.equal(buildRussian({ kind: "noun", verb: "kaufen", sentenceType: "statement", modal: false, subject: "ich", object: "es", noun: "handy" }).text, "Я покупаю его.");
});

test("«Они видят нас» answered «Er sieht euch»: two wrong participants, an agreed verb", () => {
  const r = checkSentence(task({}), "Er sieht euch.");
  assert.equal(r.outcome, "incorrect");
  assert.equal(r.components.subject, "error");
  assert.equal(r.components.object, "error");
  assert.equal(r.components.conjugation, "correct");
  assert.equal(r.agreement_ok, true);
  assert.equal(r.error_kind, null);
  assert.ok(r.feedback.some((f) => f.includes("«они» → sie, а не Er")));
  assert.ok(r.feedback.some((f) => f.includes("«нас» → uns, а не euch")));
  assert.ok(r.feedback.some((f) => f.includes("согласовано правильно")));
  assert.ok(r.feedback.some((f) => f.includes("Sie sehen uns.")));
});

test("a role swap is one confusion, not two", () => {
  const r = checkSentence(task({}), "Wir sehen sie.");
  assert.equal(r.error_kind, "role_swap");
  assert.equal(r.confusions.length, 1);
  assert.equal(r.components.conjugation, "correct");
});

test("each part is judged on its own", () => {
  const conj = checkSentence(task({}), "sie sieht uns");
  assert.equal(conj.components.subject, "correct");
  assert.equal(conj.components.conjugation, "error");
  assert.equal(conj.components.object, "correct");

  const q = checkSentence(task({ sentenceType: "question", subject: "ihr", object: "wir" }), "Ihr seht uns.");
  assert.equal(q.components.sentence_type, "error");
  assert.equal(q.components.subject, "correct");
  assert.equal(q.components.object, "correct");

  const gov = checkSentence(task({ verb: "warten_auf", subject: "wir", object: "ihr" }), "Wir warten euch");
  assert.equal(gov.components.government, "error");
  assert.equal(gov.components.object, "correct");

  const sep = checkSentence(task({ verb: "anrufen", subject: "ich", object: "ihr" }), "Ich rufe euch");
  assert.equal(sep.components.separable_prefix, "error");
  assert.equal(sep.components.object, "correct");

  const neg = checkSentence(task({ sentenceType: "negation", subject: "ich", object: "sie_sg" }), "Ich sehe sie");
  assert.equal(neg.components.negation, "error");
  assert.equal(neg.components.object, "correct");

  const typo = checkSentence(task({ subject: "ich", object: "du" }), "Ich sehr dich");
  assert.equal(typo.outcome, "typo");
  assert.equal(typo.components.object, "correct");

  const slip = checkSentence(task({ verb: "kennen", subject: "ich", object: "du" }), "Ich kene dich");
  assert.equal(slip.outcome, "typo");
  assert.equal(slip.components.spelling, "typo");
  assert.equal(slip.components.conjugation, "correct");
});

test("spelling conventions and capitals are not pronoun knowledge", () => {
  assert.equal(checkSentence(task({ verb: "hoeren", subject: "ich", object: "du" }), "ich hoere dich").outcome, "correct");
  assert.equal(checkSentence(task({ subject: "ich", object: "du" }), "ICH SEHE DICH!!").outcome, "correct");
  // Written: sie / Sie mid-sentence is meaning.
  const polite = checkSentence(task({ subject: "ich", object: "Sie" }), "Ich sehe sie.");
  assert.equal(polite.components.object, "error");
  assert.equal(polite.confusions[0].kind, "polite_case");
  // Spoken: the recogniser's capitals are not held against the learner.
  assert.equal(checkSentence(task({ subject: "ich", object: "Sie" }, "spoken"), "ich sehe sie", { spoken: true }).outcome, "correct");
  assert.equal(checkSentence(task({ subject: "ich", object: "sie_pl" }, "spoken"), "Ich sehe Sie", { spoken: true }).outcome, "correct");
  // Sentence-initial Sie can be «они».
  assert.equal(checkSentence(task({}), "Sie sehen uns").outcome, "correct");
});

test("accepted variants and the brief's sample sentences", () => {
  assert.equal(checkSentence(task({}), "Uns sehen sie.").outcome, "correct");
  assert.equal(checkSentence(task({ sentenceType: "question", subject: "ihr", object: "ich" }), "Seht ihr mich").outcome, "correct");
  assert.equal(checkSentence(task({ verb: "abholen", sentenceType: "question", modal: true, subject: "ihr", object: "sie_pl" }), "Könnt ihr sie abholen?").outcome, "correct");
  assert.equal(checkSentence(task({ verb: "warten_auf", subject: "wir", object: "ihr" }), "Wir warten auf euch.").outcome, "correct");
  assert.equal(checkSentence(task({ verb: "anrufen", subject: "ich", object: "ihr" }), "Ich rufe euch an").outcome, "correct");
  const glued = checkSentence(task({ verb: "anrufen", subject: "ich", object: "ihr" }), "Ich anrufe euch");
  assert.equal(glued.components.separable_prefix, "error");
});

test("the noun decides the pronoun: das Handy → es", () => {
  const t = makeTask({ kind: "noun", verb: "kaufen", sentenceType: "statement", modal: false, subject: "ich", object: "es", noun: "handy" }, "written", { id: id(), focusRole: "object", random: rng(2) });
  assert.equal(t.context_de, "Das Handy ist hier.");
  const r = checkSentence(t, "Ich kaufe ihn.");
  assert.equal(r.components.object, "error");
  assert.ok(r.feedback.some((f) => f.includes("das Handy → es")));
  const kept = checkSentence(t, "Ich kaufe das Handy.");
  assert.equal(kept.confusions[0].kind, "noun_kept");
});

test("an answer the rules cannot place goes for review, not into the error count", () => {
  const r = checkSentence(task({}), "Sie sehen uns heute");
  assert.equal(r.outcome, "needs_review");
  assert.ok(r.uncertain_reason?.includes("heute"));
  assert.equal(checkSentence(task({}), "keine Ahnung").outcome, "needs_review");
});

test("blanks: only the hidden pronoun is judged", () => {
  const t = makeTask({ kind: "people", verb: "sehen", sentenceType: "statement", modal: false, subject: "ich", object: "ihr", noun: null }, "choice", { id: id(), focusRole: "object", random: rng(3) });
  assert.deepEqual(t.blanks, ["object"]);
  assert.ok(t.options!.includes("euch"));
  assert.equal(checkBlanks(t, { object: "euch" }).outcome, "correct");
  const wrong = checkBlanks(t, { object: "uns" });
  assert.equal(wrong.outcome, "incorrect");
  assert.equal(wrong.confusions[0].answered_form, "uns");
  assert.equal(checkBlanks(t, { object: "ihr" }).confusions[0].kind, "case");
});

test("nothing outside the switched-on blocks is ever drawn", () => {
  const settings = sessionFromConfig(DEFAULT_CONFIG);
  const specs = candidateSpecs(settings);
  assert.ok(specs.length > 0);
  assert.ok(specs.every((s) => ["sehen", "hoeren", "rufen"].includes(s.verb) && !s.modal && s.kind === "people"));
  // No reflexive pairs.
  assert.ok(!specs.some((s) => (s.subject === "ich" && s.object === "ich") || (s.subject === "wir" && s.object === "ich") || (s.subject === "Sie" && s.object === "Sie")));
  // reparieren never with people.
  const all = candidateSpecs({ verbs: VERBS.map((v) => v.id), constructions: ["statement", "question", "negation", "modal", "separable", "prep_auf", "noun_replacement"] });
  assert.ok(all.filter((s) => s.verb === "reparieren").every((s) => s.kind === "noun"));
  // A separable verb needs its block even in a noun task.
  const noSep = candidateSpecs({ verbs: ["mitnehmen", "kaufen"], constructions: ["statement", "noun_replacement"] });
  assert.ok(noSep.every((s) => s.verb === "kaufen"));
  assert.equal(verbUsable(VERBS.find((v) => v.id === "anrufen")!, ["statement"]), false);
});

test("a session follows its settings, and errors bring the difficulty back", () => {
  const settings = sessionFromConfig(DEFAULT_CONFIG);
  const plan = planSession({ settings, enabledModes: DEFAULT_CONFIG.modes, seed: 7, newId: id, dueDifficulties: ["object:ihr"] });
  assert.equal(plan.length, 12);
  assert.ok(plan.every((t) => t.mode === "written" || t.mode === "spoken"));
  assert.ok(plan.some((t) => t.delayed_review && t.difficulty === "object:ihr"));
  const targeted = plan.filter((t) => ["wir", "ihr", "sie_pl"].includes(t.object)).length;
  assert.ok(targeted >= 6, `focus pronouns should dominate, got ${targeted}`);

  const first = plan[0];
  const { now, later } = followUps(first, settings, DEFAULT_CONFIG.modes, 9, id);
  assert.equal(now?.mode, "choice");
  assert.equal(now?.difficulty, first.difficulty);
  assert.equal(later?.mode, first.mode);
  assert.equal(later?.recheck_of, first.id);

  const noSpeech = planSession({ settings, enabledModes: DEFAULT_CONFIG.modes, seed: 7, newId: id, speechAvailable: false });
  assert.ok(noSpeech.every((t) => t.mode === "written"));
});

test("settings are checked against the catalogue", () => {
  assert.equal(validateConfigPatch(DEFAULT_CONFIG, { case: "dative" }).ok, false);
  assert.equal(validateConfigPatch(DEFAULT_CONFIG, { verbs: ["fliegen"] }).ok, false);
  const on = validateConfigPatch(DEFAULT_CONFIG, { constructions: ["statement", "question", "separable"], verbs: ["sehen", "hören", "abholen", "anrufen"] });
  assert.ok(on.ok && on.value.verbs.includes("hoeren"));
  const warn = validateConfigPatch(DEFAULT_CONFIG, { verbs: ["sehen", "warten"] });
  assert.ok(warn.ok && warn.warnings[0].includes("warten"));

  const s = validateSessionSettings(DEFAULT_CONFIG, {
    client_key: "lesson-9-pronouns-followup", case: "accusative", focus: ["object_pronouns"],
    target_pronouns: ["uns", "euch", "sie_plural"], verbs: ["sehen", "hören", "abholen"],
    sentence_types: ["statement", "question"], response_mode: "spoken", item_count: 12,
    hints_before_first_answer: false, include_delayed_review: true,
  });
  assert.ok(s.ok);
  if (s.ok) {
    assert.deepEqual(s.value.target_pronouns, ["wir", "ihr", "sie_pl"]);
    // abholen is in the list but its block is off: said, not silently dropped.
    assert.ok(s.warnings.some((w) => w.includes("abholen")));
  }
  assert.equal(validateSessionSettings(DEFAULT_CONFIG, { response_mode: "telepathy" }).ok, false);
});

test("tap: one fixed bank, both pronouns blank, judged like gaps", () => {
  const t = makeTask({ kind: "people", verb: "rufen", sentenceType: "statement", modal: false, subject: "sie_pl", object: "sie_pl", noun: null }, "tap", { id: id(), focusRole: "object", random: rng(4) });
  assert.equal(t.prompt_ru, "Они зовут их.");
  assert.deepEqual(t.blanks, ["subject", "object"]);
  assert.deepEqual(t.bank!.slice(0, 9), ["ich", "du", "er", "sie", "es", "wir", "ihr", "sie", "Sie"]);
  assert.deepEqual(t.bank!.slice(9, 18), ["mich", "dich", "ihn", "sie", "es", "uns", "euch", "sie", "Sie"]);
  assert.equal(t.bank![18], "nicht");
  assert.equal(checkBlanks(t, { subject: "sie", object: "sie" }).outcome, "correct");
  const wrong = checkBlanks(t, { subject: "sie", object: "Sie" });
  assert.equal(wrong.components.object, "error");
  assert.equal(wrong.confusions[0].kind, "polite_case");
});

test("build: the sentence's words plus distractors, checked as a full sentence", () => {
  const t = makeTask({ kind: "people", verb: "sehen", sentenceType: "statement", modal: false, subject: "er", object: "sie_sg", noun: null }, "build", { id: id(), focusRole: "object", random: rng(5) });
  assert.equal(t.prompt_ru, "Он видит её.");
  for (const w of ["er", "sieht", "sie"]) assert.ok(t.bank!.includes(w), w);
  assert.ok(t.bank!.length > t.tokens.length, "has distractors");
  assert.ok(t.bank!.includes("sehen"), "a wrong verb person");
  assert.equal(checkSentence(t, "er sieht sie").outcome, "correct");
  assert.equal(checkSentence(t, "er sehen sie").components.conjugation, "error");
  // Mixed sessions never draw the fast modes by themselves.
  const plan = planSession({ settings: { ...sessionFromConfig(DEFAULT_CONFIG), response_mode: "mixed" }, enabledModes: ["written", "tap", "build"], seed: 3, newId: id });
  assert.ok(plan.every((x) => x.mode === "written"));
});
