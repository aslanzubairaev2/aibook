import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickLiveModel, DEFAULT_LIVE_MODEL } from "./liveModels.ts";

const model = (name: string, live = true) => ({
  name: `models/${name}`,
  supportedGenerationMethods: live ? ["bidiGenerateContent"] : ["generateContent"],
});

describe("choosing the live model", () => {
  test("the configured model wins whenever the service still offers it", () => {
    const list = [model(DEFAULT_LIVE_MODEL), model("gemini-4.0-flash-live-preview")];
    assert.equal(pickLiveModel(list), DEFAULT_LIVE_MODEL);
  });

  test("a retired configured model is replaced by the best on offer", () => {
    const list = [
      model("gemini-2.0-flash-live-001"),
      model("gemini-3.1-flash-native-audio-preview"),
      model("gemini-3.1-pro-live-preview"),
    ];
    assert.equal(pickLiveModel(list), "gemini-3.1-flash-native-audio-preview");
  });

  test("models that cannot hold a voice session are never chosen", () => {
    const list = [model("gemini-3.1-flash-lite", false), model("gemini-2.0-flash-live-001")];
    assert.equal(pickLiveModel(list), "gemini-2.0-flash-live-001");
  });

  test("an empty or unusable list falls back to the built-in id", () => {
    assert.equal(pickLiveModel([]), DEFAULT_LIVE_MODEL);
    assert.equal(pickLiveModel([model("gemini-3.1-flash-lite", false)]), DEFAULT_LIVE_MODEL);
  });

  test("a stable release beats a preview of the same family", () => {
    const list = [model("gemini-3.1-flash-live-001"), model("gemini-3.1-flash-live-preview-09")];
    assert.equal(pickLiveModel(list, "retired-model"), "gemini-3.1-flash-live-001");
  });
});
