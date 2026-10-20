import { strict as assert } from "node:assert";
import test from "node:test";

import { buildBlitzCells, shuffleBlitzDeck } from "./verbBlitz.ts";

const PERSONS = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];
const table = (forms: string[]) => forms.map((form, i) => ({ label: PERSONS[i], form }));

test("blitz cells come only from tables on the device", () => {
  const verbs = [{ id: "a", verb: "machen" }, { id: "b", verb: "fahren" }];
  const cells = buildBlitzCells(verbs, ["present", "perfekt"], (id, tense) =>
    id === "a" && tense === "present" ? table(["mache", "machst", "macht", "machen", "macht", "machen"]) : null);
  assert.equal(cells.length, 6);
  assert.ok(cells.every((cell) => cell.entryId === "a" && cell.tense === "present"));
  assert.equal(cells[1].person, "du");
  assert.equal(cells[1].expected, "machst");
});

test("trivial and empty cells are left out", () => {
  const cells = buildBlitzCells(
    [{ id: "a", verb: "machen" }],
    ["present"],
    () => table(["mache", "", "macht", "machen", "macht", "machen"]),
    (_id, _tense, row) => row.form === "machen",
  );
  assert.deepEqual(cells.map((cell) => cell.expected), ["mache", "macht", "macht"]);
});

test("the shuffled deck keeps every cell and avoids the same verb twice in a row", () => {
  const verbs = ["a", "b", "c"].map((id) => ({ id, verb: id }));
  const cells = buildBlitzCells(verbs, ["present"], () => table(["1", "2", "3", "4", "5", "6"]));
  for (let run = 0; run < 200; run++) {
    const deck = shuffleBlitzDeck(cells);
    assert.equal(deck.length, cells.length);
    assert.deepEqual(new Set(deck.map((cell) => cell.key)), new Set(cells.map((cell) => cell.key)));
    for (let i = 1; i < deck.length; i++) assert.notEqual(deck[i].entryId, deck[i - 1].entryId);
  }
});
