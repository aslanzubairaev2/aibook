import assert from "node:assert/strict";
import test from "node:test";
import { parsePartialJson } from "./partialJson.ts";

const FULL = JSON.stringify({
  contentParts: [
    { type: "text", text: "Убирать, \"приводить\" в порядок.\nВторая строка \\ конец" },
    { type: "learning", text: "Ich räume auf.", translation: "Я убираю." },
  ],
  suggestions: ["а как сказать?", "ещё пример"],
  count: 12,
  done: true,
});

test("every prefix of an answer is either nothing yet or a valid, growing value", () => {
  let previousLength = 0;
  for (let end = 0; end <= FULL.length; end++) {
    const value = parsePartialJson(FULL.slice(0, end)) as { contentParts?: Array<{ text?: string }> } | null;
    if (value === null) continue;
    assert.equal(typeof value, "object");
    const shown = (value.contentParts ?? []).map((p) => p.text ?? "").join("").length;
    assert.ok(shown >= previousLength, `text shrank at ${end}`);
    previousLength = shown;
  }
  assert.deepEqual(parsePartialJson(FULL), JSON.parse(FULL));
});

test("a string being written is shown up to its last character", () => {
  const value = parsePartialJson('{"contentParts":[{"type":"text","text":"Это глаг') as { contentParts: Array<{ text: string }> };
  assert.equal(value.contentParts[0].text, "Это глаг");
});

test("a half-written key, escape or number is left out until it is complete", () => {
  assert.deepEqual(parsePartialJson('{"a":"x","b'), { a: "x" });
  assert.deepEqual(parsePartialJson('{"a":"x","b":'), { a: "x" });
  assert.deepEqual(parsePartialJson('{"a":"x","b":12'), { a: "x" });
  assert.deepEqual(parsePartialJson('{"a":"x","b":12,'), { a: "x", b: 12 });
  assert.deepEqual(parsePartialJson('{"a":"line\\'), { a: "line" });
  assert.deepEqual(parsePartialJson('{"a":"\\u04'), { a: "" });
  assert.deepEqual(parsePartialJson('{"a":"quote \\"'), { a: 'quote "' });
});

test("text around the JSON and an empty start are tolerated", () => {
  assert.equal(parsePartialJson(""), null);
  assert.equal(parsePartialJson("Here is"), null);
  assert.deepEqual(parsePartialJson('Here is the JSON: {"a":[1,2'), { a: [1] });
  assert.deepEqual(parsePartialJson('{"a":1} trailing words'), { a: 1 });
});
