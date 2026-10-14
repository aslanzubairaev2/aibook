import { test } from "node:test";
import assert from "node:assert/strict";
import { groupVerbsByPack } from "./verbPacks.ts";
import type { DictionaryBatch, DictionaryEntry } from "./db/dictionaryStore.ts";

const batch = (id: string, title: string, created_at: string) => ({ id, title, created_at }) as DictionaryBatch;
const entry = (id: string, batch_id: string | null) => ({ id, headword: id, batch_id }) as DictionaryEntry;

test("a tutor's pack whose verbs still lack forms is its own pack, not the shared backlog", () => {
  const batches = [
    batch("old", "еда и напитки", "2026-08-13T10:00:00Z"),
    batch("lesson8", "Урок 8 · документы и техника", "2026-10-14T10:00:00Z"),
  ];
  const { groups, loosePending } = groupVerbsByPack(
    [entry("essen", "old")],
    [entry("öffnen", "lesson8"), entry("prüfen", "lesson8"), entry("unterschreiben", "lesson8"), entry("loose-one", null)],
    batches,
  );

  assert.deepEqual(groups.map((g) => g.key), ["lesson8", "old"]);
  assert.deepEqual(groups[0].verbs, []);
  assert.deepEqual(groups[0].pending.map((e) => e.id), ["öffnen", "prüfen", "unterschreiben"]);
  assert.deepEqual(loosePending.map((e) => e.id), ["loose-one"]);
});

test("once filled, the verbs train in the same pack they came with", () => {
  const { groups } = groupVerbsByPack(
    [entry("öffnen", "lesson8")],
    [entry("prüfen", "lesson8")],
    [batch("lesson8", "Урок 8", "2026-10-14T10:00:00Z")],
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].verbs.map((e) => e.id), ["öffnen"]);
  assert.deepEqual(groups[0].pending.map((e) => e.id), ["prüfen"]);
});
