import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitTranscription, lessonFromTranscription } from "./transcriptionLesson.ts";

describe("the transcription a failed rewrite falls back to", () => {
  test("blank lines separate paragraphs", () => {
    const text = "Erste Zeile eines Absatzes.\n\nZweiter Absatz hier.\n\nDritter.";
    assert.deepEqual(splitTranscription(text), [
      "Erste Zeile eines Absatzes.",
      "Zweiter Absatz hier.",
      "Dritter.",
    ]);
  });

  test("lines wrapped by the page layout are rejoined", () => {
    const text = [
      "Der Vermieter vermietet dem Mieter die Wohnung",
      "im zweiten Obergeschoss des Hauses Musterstraße 4.",
      "Die Miete beträgt 850 Euro im Monat und ist bis zum",
      "dritten Werktag eines jeden Monats zu entrichten.",
    ].join("\n");

    const paragraphs = splitTranscription(text);
    assert.equal(paragraphs.length, 2, "two sentences, two paragraphs");
    assert.ok(paragraphs[0].includes("Wohnung im zweiten"), "the wrap is closed up, not left as a break");
  });

  test("an empty transcription yields no lesson rather than an empty one", () => {
    assert.equal(lessonFromTranscription("   "), null);
  });

  test("the lesson says plainly that it is the raw text", () => {
    const lesson = lessonFromTranscription("Notausgang bitte freihalten.", "табличка");
    assert.ok(lesson);
    assert.deepEqual(lesson!.paragraphs, ["Notausgang bitte freihalten."]);
    assert.match(lesson!.description, /как есть/);
    assert.equal(lesson!.title, "Notausgang bitte freihalten.");
  });

  test("a long first sentence is trimmed into a usable title", () => {
    const long = "Die Vertragsparteien vereinbaren hiermit die Überlassung der Wohnräume zu Wohnzwecken auf unbestimmte Zeit.";
    const lesson = lessonFromTranscription(long);
    assert.ok(lesson!.title.length <= 60);
    assert.match(lesson!.title, /…$/);
  });
});
