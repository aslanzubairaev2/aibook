// The discussion route against a stand-in Gemini: which model it calls, what it
// does when that model is not reachable, and what reaches the app.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeGeminiServer, type FakeGeminiServer } from "./fakeGeminiServer.ts";
import { AI_CONFIG } from "../config.ts";

let server: FakeGeminiServer;
let POST: (req: Request) => Promise<Response>;

const ANSWER = {
  contentParts: [
    { type: "text", text: "Убирать, приводить в порядок." },
    { type: "learning", text: "Ich muss mein Zimmer aufräumen.", translation: "Мне надо убрать комнату." },
  ],
  suggestions: ["а как сказать «это надо убрать»?"],
  actions: [{ kind: "conjugation", label: "Спряжение aufräumen", word: "aufräumen" }],
};

function ask() {
  return new Request("http://localhost/api/ai/discuss", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gemini-key": "test-key" },
    body: JSON.stringify({
      mode: "word",
      selectedText: "aufräumen",
      sentence: "Ich räume mein Zimmer auf.",
      nativeLanguage: "ru",
      targetLanguage: "de",
      history: [],
      message: "открой разбор",
    }),
  });
}

before(async () => {
  server = await startFakeGeminiServer();
  process.env.GEMINI_API_BASE_URL = server.baseUrl;
  // Imported after the base URL is set: the route reads it at module load.
  ({ POST } = await import("../../app/api/ai/discuss/route.ts"));
});

after(async () => {
  delete process.env.GEMINI_API_BASE_URL;
  await server.close();
});

describe("the discussion route", () => {
  test("runs on the discussion model and passes the tutor's brief as the system prompt", async () => {
    server.queue({ kind: "json", value: ANSWER });
    const res = await POST(ask());
    assert.equal(res.status, 200);

    const request = server.requests.at(-1);
    assert.equal(request?.model, AI_CONFIG.discussModel);
    const system = JSON.stringify(request?.body.systemInstruction ?? "");
    assert.match(system, /Do NOT explain with grammar terminology/);
  });

  test("the answer arrives with its follow-up chips and buttons intact", async () => {
    server.queue({ kind: "json", value: ANSWER });
    const message = await (await POST(ask())).json() as Record<string, unknown>;

    assert.equal(message.role, "model");
    assert.deepEqual(message.suggestions, ["а как сказать «это надо убрать»?"]);
    assert.deepEqual(message.actions, [{ kind: "conjugation", label: "Спряжение aufräumen", word: "aufräumen" }]);
  });

  test("a key that cannot reach the discussion model still gets an answer", async () => {
    server.queue({ kind: "httpError", status: 404, message: "models/… is not found for API version v1beta" });
    server.queue({ kind: "json", value: ANSWER });

    const res = await POST(ask());
    assert.equal(res.status, 200, "the chat keeps working");
    assert.equal(server.requests.at(-1)?.model, AI_CONFIG.model, "retried on the app's main model");

    // And the fallback is remembered, so the next message does not pay the 404 again.
    server.queue({ kind: "json", value: ANSWER });
    await POST(ask());
    assert.equal(server.requests.at(-1)?.model, AI_CONFIG.model);
  });
});
