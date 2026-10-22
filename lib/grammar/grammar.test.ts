// The grammar trainers' promises, checked on the brief's own examples: the
// right preposition or none, every accepted wording, each error named by its
// kind, no prompt that reads two ways, filters that never invent a
// combination, and statistics that keep help, corrections and test runs apart.

import assert from "node:assert/strict";
import test from "node:test";
import { determiner, readDeterminer, rng } from "./common.ts";
import { ART_DEFAULT, FRAMES, artPool, artSample, artTask, type ArtConfig } from "./articles.ts";
import { emptyReasons, planTasks, validatePatch, validateSession } from "./config.ts";
import { grammarEventInput } from "./record.ts";
import { dueKeys, grammarSummary, type GrammarEvent } from "./stats.ts";
import { checkQuick, checkSentence, type GrammarTask } from "./task.ts";
import { COMBOS, COMBO_BY_ID, QUICK_PREPS, VP_DEFAULT, vpPool, vpSpecs, vpTask, type VPConfig, type VPSpec } from "./verbPrepositions.ts";

let n = 0;
const id = () => `t${++n}`;
const ALL_VP: VPConfig = { ...VP_DEFAULT, selection: "manual", manual: COMBOS.map((c) => c.id), reflexive: true, separable: true, modal: true };

function vp(combo: string, spec: Partial<VPSpec>, mode: "build" | "written" | "spoken" | "quick" = "written"): GrammarTask {
  return vpTask({ combo, sentenceType: "statement", modal: false, subject: "wir", object: null, filler: null, personPron: null, personFiller: null, ...spec }, mode, { id: id(), random: rng(5) });
}

test("«Мы слышим вас» and «Мы ждём вас»: the brief's build example", () => {
  const hear = vp("hoeren", { object: "ihr" }, "build");
  assert.equal(hear.prompt_ru, "Мы слышим вас.");
  assert.equal(hear.expected, "Wir hören euch.");
  assert.ok(hear.bank!.includes("auf") || hear.bank!.filter((w) => QUICK_PREPS.includes(w) || w === "zu").length === 2, "a preposition is offered even where none is needed");
  assert.equal(checkSentence(hear, "wir hören euch").outcome, "correct");
  const extra = checkSentence(hear, "Wir hören auf euch");
  assert.equal(extra.outcome, "incorrect");
  assert.deepEqual(extra.issues.map((i) => i.type), ["extra_preposition"]);

  const wait = vp("warten_auf", { object: "ihr" }, "build");
  assert.equal(wait.prompt_ru, "Мы ждём вас.");
  assert.equal(wait.expected, "Wir warten auf euch.");
  assert.equal(checkSentence(wait, "Wir warten auf euch.").outcome, "correct");
  assert.deepEqual(checkSentence(wait, "Wir warten euch").issues.map((i) => i.type), ["missing_preposition"]);
  assert.deepEqual(checkSentence(wait, "Wir warten an euch").issues.map((i) => i.type), ["wrong_preposition"]);
  assert.deepEqual(checkSentence(wait, "Wir warten euch auf").issues.map((i) => i.type), ["word_order"]);
  assert.deepEqual(checkSentence(wait, "Wir warten auf ihr").issues.map((i) => i.type), ["case"]);
  assert.deepEqual(checkSentence(wait, "Wir wartet auf euch").issues.map((i) => i.type), ["conjugation"]);
  // A wrong preposition explains the fixed combination, not «куда?».
  assert.ok(checkSentence(wait, "Wir warten an euch").feedback.some((f) => f.includes("«куда?» здесь не работает")));
});

test("build: two prepositions on the buttons whether one is needed or not", () => {
  const preps = new Set(["auf", "an", "über", "um", "für", "mit", "nach", "von", "zu", "bei", "in"]);
  for (const combo of COMBOS) {
    for (const spec of vpSpecs(combo, ALL_VP).slice(0, 40)) {
      const t = vpTask(spec, "build", { id: id(), random: rng(spec.subject.length + 3) });
      const words = t.variants[0].tokens.map((x) => x.text);
      const needed = combo.prep ? 1 : 0;
      // Prepositions that are a separable prefix (an, auf) are part of the sentence too.
      const prefixPreps = combo.prefix && preps.has(combo.prefix) ? 1 : 0;
      const shown = t.bank!.filter((w) => preps.has(w)).length - prefixPreps;
      assert.equal(shown, 2, `${combo.id}: ${t.bank!.join(" ")} (needs ${needed})`);
      // Every word of the right answer is on the buttons (fused am/zum as two words).
      for (const w of words) if (!["am", "zum", "zur", "beim", "vom", "im"].includes(w)) assert.ok(t.bank!.includes(w), `${combo.id}: ${w} missing from ${t.bank!.join(" ")}`);
    }
  }
});

test("the catalogue builds correct German for every kind of combination", () => {
  assert.equal(vp("teilnehmen_an", { subject: "ich", filler: 0 }).expected, "Ich nehme am Kurs teil.");
  assert.equal(vp("teilnehmen_an", { subject: "ich", filler: 0, modal: true }).expected, "Ich kann am Kurs teilnehmen.");
  assert.equal(vp("teilnehmen_an", { subject: "du", filler: 3, sentenceType: "question" }).expected, "Nimmst du an der Prüfung teil?");
  assert.equal(vp("aufpassen_auf", { subject: "ich", object: "du" }).expected, "Ich passe auf dich auf.");
  assert.equal(vp("aufpassen_auf", { subject: "ich", object: "du", sentenceType: "negation" }).expected, "Ich passe nicht auf dich auf.");
  assert.equal(vp("sich_freuen_auf", { subject: "ich", filler: 0 }).expected, "Ich freue mich auf den Urlaub.");
  assert.equal(vp("sich_freuen_ueber", { subject: "du", filler: 0, sentenceType: "question" }).expected, "Freust du dich über das Geschenk?");
  assert.equal(vp("bitten_um", { subject: "ich", personPron: "du", filler: 0, sentenceType: "negation" }).expected, "Ich bitte dich nicht um Hilfe.");
  assert.equal(vp("danken_fuer", { subject: "ich", personPron: "du", filler: 0 }).expected, "Ich danke dir für die Hilfe.");
  assert.equal(vp("anrufen", { subject: "ich", object: "sie_pl" }).prompt_ru, "Я звоню им.");
  assert.equal(vp("anrufen", { subject: "ich", object: "sie_pl" }).expected, "Ich rufe sie an.");
  assert.equal(vp("helfen", { subject: "ich", object: "du", sentenceType: "negation" }).expected, "Ich helfe dir nicht.");
  assert.equal(vp("sprechen_mit", { subject: "wir", object: "sie_sg", sentenceType: "question" }).prompt_ru, "Мы говорим с ней?");
  assert.equal(vp("brauchen", { subject: "wir", object: "ihr" }).prompt_ru, "Мы нуждаемся в вас.");
  assert.equal(vp("sich_kuemmern_um", { subject: "ich", object: "du", modal: true }).expected, "Ich kann mich um dich kümmern.");
  // A missing reflexive or prefix is named as such.
  assert.deepEqual(checkSentence(vp("sich_freuen_auf", { subject: "ich", filler: 0 }), "Ich freue auf den Urlaub").issues.map((i) => i.type), ["reflexive"]);
  assert.deepEqual(checkSentence(vp("teilnehmen_an", { subject: "ich", filler: 0 }), "Ich nehme am Kurs").issues.map((i) => i.type), ["separable_prefix"]);
});

test("every correct variant is accepted: der or ein, sprechen von, suchen nach, written-out fusions, ae/oe/ue/ss", () => {
  const bus = vp("warten_auf", { subject: "ich", filler: 0 });
  assert.equal(checkSentence(bus, "Ich warte auf einen Bus").outcome, "correct");
  const about = vp("sprechen_ueber", { subject: "wir", object: "du" });
  const von = checkSentence(about, "Wir sprechen von dir");
  assert.equal(von.outcome, "correct");
  assert.ok(von.feedback.some((f) => f.includes("Тоже верно")));
  assert.equal(checkSentence(vp("suchen", { subject: "ich", object: "du" }), "Ich suche nach dir").outcome, "correct");
  const course = vp("teilnehmen_an", { subject: "ich", filler: 0 });
  const long = checkSentence(course, "Ich nehme an dem Kurs teil");
  assert.equal(long.outcome, "correct");
  assert.ok(long.feedback.some((f) => f.includes("am")));
  assert.equal(checkSentence(vp("hoeren", { object: "ihr" }), "Wir hoeren euch").outcome, "correct");
  // Fixed phrases keep their article: nach dem Weg, never «nach einem Weg».
  assert.notEqual(checkSentence(vp("fragen_nach", { subject: "ich", filler: 0 }), "Ich frage nach einem Weg").outcome, "correct");
});

test("typos are not grammar; unknown words are not errors; speech ignores case and punctuation", () => {
  const wait = vp("warten_auf", { object: "ihr" });
  const typo = checkSentence(wait, "Wir wartn auf euch");
  assert.equal(typo.outcome, "typo");
  assert.deepEqual(typo.issues.map((i) => i.type), ["typo"]);
  const unknown = checkSentence(wait, "Wir warten auf euch morgen");
  assert.equal(unknown.outcome, "needs_review");
  const spoken = checkSentence(wait, "wir warten auf euch", { spoken: true });
  assert.equal(spoken.outcome, "correct");
  const glitch = checkSentence(wait, "wir warten auf euch bitte", { spoken: true });
  assert.equal(glitch.outcome, "needs_review");
  assert.match(glitch.uncertain_reason!, /распознавания/);
  // Written: the capital of Sie is meaning, not style.
  const polite = vp("warten_auf", { subject: "Sie", object: "ich", sentenceType: "question" });
  assert.equal(polite.expected, "Warten Sie auf mich?");
  assert.deepEqual(checkSentence(polite, "Warten sie auf mich?").issues.map((i) => i.type), ["subject"]);
  assert.equal(checkSentence(polite, "warten sie auf mich", { spoken: true }).outcome, "correct");
});

test("quick choice: a preposition or «без предлога»", () => {
  const hear = vp("hoeren", { object: "ihr" }, "quick");
  assert.deepEqual(hear.quick!.keys[1], ["—"]);
  assert.equal(checkQuick(hear, ["—"]).outcome, "correct");
  assert.deepEqual(checkQuick(hear, ["auf"]).issues.map((i) => i.type), ["extra_preposition"]);
  const wait = vp("warten_auf", { object: "ihr" }, "quick");
  assert.equal(checkQuick(wait, ["auf"]).outcome, "correct");
  assert.deepEqual(checkQuick(wait, ["—"]).issues.map((i) => i.type), ["missing_preposition"]);
  assert.deepEqual(checkQuick(wait, ["an"]).issues.map((i) => i.type), ["wrong_preposition"]);
  // The gap sits before the object in both: its place gives nothing away.
  const shape = (t: GrammarTask) => t.quick!.frame.map((p) => ("gap" in p ? "_" : "w")).join("");
  assert.equal(shape(hear), shape(wait));
});

test("no Russian prompt of the verb trainer reads two ways", () => {
  const byPrompt = new Map<string, Set<string>>();
  const accepted = new Map<string, Set<string>>();
  for (const combo of COMBOS) {
    for (const spec of vpSpecs(combo, ALL_VP)) {
      const t = vpTask(spec, "written", { id: id(), random: rng(1) });
      const key = `${t.prompt_ru} ${t.notes_ru.join(";")}`;
      const set = byPrompt.get(key) ?? new Set();
      set.add(t.expected);
      byPrompt.set(key, set);
      const acc = accepted.get(key) ?? new Set();
      for (const v of t.variants) acc.add(v.tokens.map((x) => x.text.toLowerCase()).join(" "));
      accepted.set(key, acc);
    }
  }
  for (const [prompt, expected] of byPrompt) {
    if (expected.size === 1) continue;
    // Two tasks may share a prompt only if each accepts the other's sentence.
    for (const e of expected) {
      const words = e.replace(/[.?]$/, "").toLowerCase();
      assert.ok(accepted.get(prompt)!.has(words), `«${prompt}» → ${[...expected].join(" | ")}`);
    }
  }
});

test("no Russian prompt of the article trainer reads two ways (outside quick mode)", () => {
  const config: ArtConfig = { ...ART_DEFAULT, cases: ["nom", "acc", "dat"], genders: ["m", "f", "n", "pl"], families: ["der", "ein", "kein", "mein", "dein", "sein", "ihr", "unser", "euer", "Ihr"], dative_blocks: ["dat_mit", "dat_bei", "dat_zu", "dat_verbs", "dat_give"], gaps: "mixed", selection: "manual", manual: FRAMES.map((f) => f.id) };
  const random = rng(42);
  const byPrompt = new Map<string, { expected: Set<string>; accepted: Set<string> }>();
  for (let i = 0; i < 6000; i++) {
    const frame = FRAMES[i % FRAMES.length];
    const spec = artSample(frame, config, random);
    if (!spec) continue;
    const t = artTask(spec, "written", config, { id: id(), random });
    const key = `${t.prompt_ru} ${t.notes_ru.join(";")}`;
    const slot = byPrompt.get(key) ?? { expected: new Set(), accepted: new Set() };
    slot.expected.add(t.expected.replace(/[.?]$/, "").toLowerCase());
    for (const v of t.variants) slot.accepted.add(v.tokens.map((x) => x.text.toLowerCase()).join(" "));
    byPrompt.set(key, slot);
  }
  assert.ok(byPrompt.size > 300);
  for (const [prompt, s] of byPrompt) {
    for (const e of s.expected) assert.ok(s.accepted.has(e), `«${prompt}» → ${[...s.expected].join(" | ")}`);
  }
});

test("articles: the brief's quick example and errors named by case, gender, family", () => {
  const config: ArtConfig = { ...ART_DEFAULT };
  const t = artTask({ frame: "brauchen", subject: "ich", slots: [{ noun: "drucker", plural: false, family: "ein", owner: null }] }, "quick", config, { id: id(), random: rng(2) });
  assert.deepEqual(t.quick!.instruction, ["Слово: der Drucker. Используй ein."]);
  assert.equal(t.quick!.frame.map((p) => ("gap" in p ? "[…]" : p.text)).join(" "), "Ich brauche […] Drucker.");
  assert.equal(checkQuick(t, ["einen"]).outcome, "correct");
  assert.deepEqual(checkQuick(t, ["ein"]).issues.map((i) => i.type), ["case"]);
  assert.deepEqual(checkQuick(t, ["eine"]).issues.map((i) => i.type), ["gender"]);
  assert.deepEqual(checkQuick(t, ["den"]).issues.map((i) => i.type), ["determiner_form"]);
  // Without the instruction (written), den is as right as einen: Russian cannot tell them apart.
  const w = artTask({ frame: "brauchen", subject: "ich", slots: [{ noun: "drucker", plural: false, family: "ein", owner: null }] }, "written", config, { id: id(), random: rng(2) });
  assert.equal(w.prompt_ru, "Мне нужен принтер.");
  assert.equal(checkSentence(w, "Ich brauche den Drucker").outcome, "correct");
  assert.equal(checkSentence(w, "Ich brauche einen Drucker").outcome, "correct");
  assert.deepEqual(checkSentence(w, "Ich brauche ein Drucker").issues.map((i) => i.type), ["case"]);
  // Hidden gender: the word comes without its article.
  const hidden = artTask({ frame: "brauchen", subject: "ich", slots: [{ noun: "drucker", plural: false, family: "ein", owner: null }] }, "quick", { show_gender: false }, { id: id(), random: rng(2) });
  assert.deepEqual(hidden.quick!.instruction, ["Слово: Drucker. Используй ein."]);
});

test("articles: Dativ with mit / bei / zu, fusions and the plural -n", () => {
  const random = rng(3);
  const doctor = artTask({ frame: "zu_person", subject: "ich", slots: [{ noun: "arzt", plural: false, family: "der", owner: null }] }, "written", ART_DEFAULT, { id: id(), random });
  assert.equal(doctor.expected, "Ich gehe zum Arzt.");
  assert.equal(doctor.prompt_ru, "Я иду к врачу.");
  assert.equal(checkSentence(doctor, "Ich gehe zum Arzt").outcome, "correct");
  assert.equal(checkSentence(doctor, "Ich gehe zu dem Arzt").outcome, "correct");
  assert.deepEqual(checkSentence(doctor, "Ich gehe zur Arzt").issues.map((i) => i.type), ["gender"]);
  assert.deepEqual(checkSentence(doctor, "Ich gehe zu den Arzt").issues.map((i) => i.type), ["case"]);
  const kids = artTask({ frame: "mit_sprechen", subject: "ich", slots: [{ noun: "kind", plural: true, family: "mein", owner: "ich" }] }, "written", ART_DEFAULT, { id: id(), random });
  assert.equal(kids.expected, "Ich spreche mit meinen Kindern.");
  assert.equal(kids.prompt_ru, "Я говорю со своими детьми.");
  assert.deepEqual(checkSentence(kids, "Ich spreche mit meinen Kinder").issues.map((i) => i.type), ["noun_form"]);
  assert.ok(kids.explain.some((l) => l.includes("-n")));
  const bus = artTask({ frame: "mit_fahren", subject: "wir", slots: [{ noun: "bus", plural: false, family: "der", owner: null }] }, "written", ART_DEFAULT, { id: id(), random });
  assert.equal(bus.prompt_ru, "Мы едем на автобусе.");
  assert.equal(bus.expected, "Wir fahren mit dem Bus.");
  const polite = artTask({ frame: "wo_ist", subject: null, slots: [{ noun: "schluessel", plural: false, family: "Ihr", owner: "Sie" }] }, "written", ART_DEFAULT, { id: id(), random });
  assert.equal(polite.expected, "Wo ist Ihr Schlüssel?");
  assert.equal(polite.prompt_ru, "Где Ваш ключ?");
  assert.deepEqual(checkSentence(polite, "Wo ist ihr Schlüssel").issues.map((i) => i.type), ["determiner_form"]);
});

test("determiner tables", () => {
  assert.equal(determiner("ein", "pl", "acc"), null);
  assert.equal(determiner("euer", "f", "dat"), "eurer");
  assert.equal(determiner("euer", "m", "nom"), "euer");
  assert.equal(determiner("kein", "pl", "dat"), "keinen");
  assert.ok(readDeterminer("dem").some((r) => r.family === "der" && r.case === "dat" && r.gender === "m"));
});

test("settings: defaults, a preposition filter that never invents, empty selections explained", () => {
  const start = vpPool(VP_DEFAULT).combos.map((c) => c.id);
  assert.ok(start.includes("warten_auf"));
  assert.deepEqual(start.filter((id) => COMBO_BY_ID[id].prep), ["warten_auf"]);
  const mit = validatePatch("verb_prepositions", VP_DEFAULT, { prepositions: ["mit"] });
  assert.ok(mit.ok);
  // mit is not attached to warten: no learned combination with mit → explained.
  const onlyMit = { ...(mit.ok ? mit.value : VP_DEFAULT), include_no_prep: false } as VPConfig;
  assert.equal(vpPool(onlyMit).combos.length, 0);
  assert.match(emptyReasons("verb_prepositions", onlyMit).join(" "), /не подставляется/);
  const added = validatePatch("verb_prepositions", onlyMit, { learned_add: ["sprechen mit"] });
  assert.ok(added.ok);
  assert.deepEqual(vpPool(added.ok ? added.value as VPConfig : onlyMit).combos.map((c) => c.id), ["sprechen_mit"]);
  assert.equal(validatePatch("verb_prepositions", VP_DEFAULT, { learned_add: ["warten mit"] }).ok, false);

  // Articles: Nominativ + Akkusativ, singular; Dativ ready but off; verbs with Dativ never on by themselves.
  assert.deepEqual(ART_DEFAULT.cases, ["nom", "acc"]);
  assert.ok(!ART_DEFAULT.genders.includes("pl"));
  const dat = validatePatch("articles_cases", ART_DEFAULT, { cases: ["dat"] });
  assert.ok(dat.ok);
  const frames = artPool(dat.ok ? dat.value as ArtConfig : ART_DEFAULT).frames.map((f) => f.block);
  assert.ok(frames.length > 0 && frames.every((b) => b === "dat_mit" || b === "dat_bei" || b === "dat_zu"));
  const einPlural = { ...ART_DEFAULT, families: ["ein"], genders: ["pl"] } as ArtConfig;
  assert.match(emptyReasons("articles_cases", einPlural).join(" "), /нет формы множественного числа/);
  const twoNom = { ...ART_DEFAULT, cases: ["nom"], gaps: "two" } as ArtConfig;
  assert.match(emptyReasons("articles_cases", twoNom).join(" "), /Два пропуска/);
  assert.equal(validateSession("articles_cases", ART_DEFAULT, { families: ["ein"], genders: ["pl"] }).ok, false);
});

test("endless mixed practice rotates modes and brings due constructions back", () => {
  const due = ["vp:warten_auf"];
  const tasks = planTasks("verb_prepositions", VP_DEFAULT, { mode: "mixed", count: 9, seed: 9, newId: id, due });
  assert.equal(tasks.length, 9);
  assert.deepEqual(tasks.slice(0, 3).map((t) => t.mode), ["build", "written", "quick"]);
  assert.equal(tasks[1].key, "vp:warten_auf");
  assert.equal(tasks[1].delayed_review, true);
  // No combination twice in a row.
  for (let i = 1; i < tasks.length; i++) assert.notEqual(tasks[i].meta.combo, tasks[i - 1].meta.combo);
  const spoken = planTasks("articles_cases", ART_DEFAULT, { mode: "spoken", count: 3, seed: 1, newId: id, speech: false });
  assert.ok(spoken.every((t) => t.mode === "written"));
});

function event(task: GrammarTask, outcome: string, extra: Partial<GrammarEvent> & { help?: boolean; correctionOf?: string; test?: boolean; session?: string; at?: string } = {}): GrammarEvent {
  const input = grammarEventInput(task, {
    sessionId: extra.session ?? "s1", assignedSessionId: null, answer: "x", outcome: outcome as never,
    result: outcome === "incorrect" ? checkSentence(task, "Wir warten an euch") : null,
    attemptNo: extra.correctionOf ? 2 : 1, correctionOf: extra.correctionOf ?? null, helpUsed: extra.help ?? false,
    answerShown: false, activeMs: 1000, testRun: extra.test ?? false,
  });
  return {
    client_event_id: id(), occurred_at: extra.at ?? `2026-10-22T10:00:${String(n % 60).padStart(2, "0")}Z`, local_date: "2026-10-22",
    session_id: extra.session ?? "s1", trainer: input.trainer, mode: input.mode, word: input.word, prompt: input.prompt, answer: input.answer,
    expected: input.expected, outcome, attempt_no: input.attemptNo, hint_used: input.hintUsed, answer_shown: false, meta: input.meta,
  };
}

test("statistics keep first answers, help, corrections, modes and test runs apart", () => {
  const wait = vp("warten_auf", { object: "ihr" }, "build");
  const first = event(wait, "incorrect");
  const events: GrammarEvent[] = [
    first,
    event(wait, "correct", { correctionOf: first.client_event_id }),
    event(vp("hoeren", { object: "ihr" }, "quick"), "correct", { help: true }),
    event(vp("sehen", { object: "ihr" }, "written"), "correct"),
    event(vp("sehen", { object: "du" }, "written"), "incorrect", { test: true }),
    event(vp("suchen", { object: "du" }, "spoken"), "technical"),
  ];
  const s = grammarSummary(events);
  assert.equal(s.first_answers.answers, 3);
  assert.equal(s.first_answers.right, 2);
  assert.equal(s.by_mode.build.incorrect, 1);
  assert.equal(s.by_mode.quick.correct, 1);
  assert.equal(s.by_answer_kind.assisted.correct, 1);
  assert.equal(s.by_answer_kind.independent.checked, 2);
  assert.deepEqual(s.error_types.map((e) => e.type), ["wrong_preposition"]);
  assert.deepEqual(s.corrections, { count: 1, right_after_correction: 1 });
  assert.equal(s.technical_problems, 1);
  assert.equal(s.test_events_excluded, 1);
  assert.equal(s.recent_errors[0].correction?.outcome, "correct");
  assert.deepEqual(dueKeys(events), ["vp:warten_auf"]);
  // Right again on its own in a later session: no longer due.
  assert.deepEqual(dueKeys([...events, event(vp("warten_auf", { object: "du", subject: "ich" }, "written"), "correct", { session: "s2", at: "2026-10-23T09:00:00Z" })]), []);
});
