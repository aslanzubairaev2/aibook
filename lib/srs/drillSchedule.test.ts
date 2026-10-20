import { strict as assert } from "node:assert";
import test from "node:test";

import { countDueVerbs, countFilteredVerbs, drillKeysFor, getDrill, isDrillDue, planVerbSession, recordDrillAnswer } from "./drillSchedule.ts";
import { emptyModuleProgress, recordAnswer, resetWords } from "./packProgress.ts";
import type { ConjugationTense, QuizMode } from "../verbsQuizModes.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T10:00:00Z");
const forms = { praeteritum: "fuhr", partizip2: "gefahren", hilfsverb: "sein" };
const verb = (id: string) => ({ id, translation: "ехать", forms });
const modes = new Set<QuizMode>(["forms", "conjugation"]);
const tenses = new Set<ConjugationTense>(["present", "perfekt"]);

test("each switched-on mode and tense is its own drill", () => {
  assert.deepEqual(drillKeysFor(verb("a"), modes, tenses), ["forms", "conjugation:present", "conjugation:perfekt"]);
  assert.deepEqual(drillKeysFor({ translation: "", forms: {} }, new Set<QuizMode>(["translation", "forms"]), tenses), []);
});

test("a right answer sends only that drill away; a wrong one brings it back tomorrow", () => {
  let p = emptyModuleProgress();
  p = recordDrillAnswer(p, "a", "forms", true, true, NOW);
  p = recordDrillAnswer(p, "a", "conjugation:present", false, true, NOW);
  const forms = getDrill(p, "a", "forms")!;
  const present = getDrill(p, "a", "conjugation:present")!;
  assert.ok(Date.parse(forms.dueAt) - NOW >= 2 * DAY, "a known drill waits days");
  assert.equal(isDrillDue(present, NOW), false, "not again today");
  assert.equal(isDrillDue(present, NOW + DAY), true, "back tomorrow");
  assert.equal(present.ok, false);
  assert.equal(forms.ok, true);
});

test("the retry round does not push a drill out", () => {
  let p = emptyModuleProgress();
  p = recordDrillAnswer(p, "a", "forms", false, true, NOW);
  const due = getDrill(p, "a", "forms")!.dueAt;
  p = recordDrillAnswer(p, "a", "forms", true, false, NOW + 60_000);
  assert.equal(getDrill(p, "a", "forms")!.dueAt, due);
  assert.equal(getDrill(p, "a", "forms")!.attempts, 2);
});

test("a session asks only due drills, seen ones first, cut at the limit", () => {
  let p = emptyModuleProgress();
  // a: everything answered right today → nothing due.
  for (const key of drillKeysFor(verb("a"), modes, tenses)) p = recordDrillAnswer(p, "a", key, true, true, NOW - 3 * DAY);
  // b: present answered wrong a while ago → that drill is overdue.
  p = recordDrillAnswer(p, "b", "forms", true, true, NOW);
  p = recordDrillAnswer(p, "b", "conjugation:present", false, true, NOW - 5 * DAY);
  p = recordDrillAnswer(p, "b", "conjugation:perfekt", true, true, NOW);
  const entries = [verb("new1"), verb("a"), verb("b"), verb("new2")];

  const plan = planVerbSession(entries, p, modes, tenses, "all", 2, NOW);
  // a's drills were answered right 3 days ago: some may already be due again,
  // but b's 5-day-overdue drill comes first and new verbs come last.
  assert.equal(plan[0].entry.id, "b");
  assert.deepEqual(plan[0].drills, ["conjugation:present"]);
  assert.equal(plan.length, 2);
  assert.ok(countDueVerbs(entries, p, modes, tenses, NOW) >= 3);
});

test("filters pick drills, not words: known forms are not re-asked with weak conjugation", () => {
  let p = emptyModuleProgress();
  p = recordDrillAnswer(p, "a", "forms", true, true, NOW);
  p = recordDrillAnswer(p, "a", "conjugation:present", false, true, NOW - 2 * DAY);
  p = recordDrillAnswer(p, "a", "conjugation:present", false, true, NOW - DAY);
  const plan = planVerbSession([verb("a")], p, modes, new Set<ConjugationTense>(["present"]), "difficult", 0, NOW);
  assert.deepEqual(plan[0].drills, ["conjugation:present"]);
  assert.equal(countFilteredVerbs([verb("a")], p, modes, tenses, "unfamiliar"), 1);
});

test("before any drill history, the old word-level mistakes still count", () => {
  let p = emptyModuleProgress();
  p = recordAnswer(p, "a", false, true, NOW);
  assert.equal(countFilteredVerbs([verb("a")], p, modes, tenses, "unfamiliar"), 1);
});

test("resetting a pack forgets its drills too", () => {
  let p = emptyModuleProgress();
  p = recordDrillAnswer(p, "a", "forms", true, true, NOW);
  p = recordDrillAnswer(p, "b", "forms", true, true, NOW);
  p = resetWords(p, ["a"]);
  assert.equal(getDrill(p, "a", "forms"), undefined);
  assert.ok(getDrill(p, "b", "forms"));
});
