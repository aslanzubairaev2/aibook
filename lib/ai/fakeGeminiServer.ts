// A stand-in for the Gemini REST endpoint, so the lesson pipeline can be run
// against the answers that actually broke it — a reply cut off mid-JSON, a
// reply fenced in markdown, an empty reply with finishReason MAX_TOKENS, a
// safety block, a quota error — instead of only the answer we hope for.

import { createServer, type Server } from "node:http";

export type FakeGeminiReply =
  /** A normal, complete JSON answer. */
  | { kind: "json"; value: unknown }
  /** Valid JSON wrapped in a ```json fence, which models still do. */
  | { kind: "fenced"; value: unknown }
  /** The answer cut off after `keep` characters — what an output ceiling produces. */
  | { kind: "truncated"; value: unknown; keep: number }
  /** Prose around the JSON ("Here is the result: {…}"). */
  | { kind: "chatty"; value: unknown }
  /** Nothing generated: the whole budget went to thinking. */
  | { kind: "emptyMaxTokens" }
  /** Blocked by the safety filter. */
  | { kind: "safetyBlock" }
  /** An HTTP-level failure. */
  | { kind: "httpError"; status: number; message: string };

export type FakeGeminiServer = {
  baseUrl: string;
  /** Requests received, newest last. */
  requests: { model: string; body: Record<string, unknown> }[];
  /** Replies are consumed in order; the last one repeats once the queue empties. */
  queue: (reply: FakeGeminiReply) => void;
  close: () => Promise<void>;
};

function candidate(text: string, finishReason = "STOP") {
  return {
    candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
  };
}

function bodyFor(reply: FakeGeminiReply): { status: number; payload: unknown } {
  switch (reply.kind) {
    case "json":
      return { status: 200, payload: candidate(JSON.stringify(reply.value)) };
    case "fenced":
      return { status: 200, payload: candidate("```json\n" + JSON.stringify(reply.value, null, 2) + "\n```") };
    case "truncated":
      return {
        status: 200,
        payload: candidate(JSON.stringify(reply.value).slice(0, reply.keep), "MAX_TOKENS"),
      };
    case "chatty":
      return {
        status: 200,
        payload: candidate(`Here is the JSON you asked for:\n${JSON.stringify(reply.value)}\nLet me know if you need changes.`),
      };
    case "emptyMaxTokens":
      return { status: 200, payload: { candidates: [{ content: { parts: [], role: "model" }, finishReason: "MAX_TOKENS" }] } };
    case "safetyBlock":
      return {
        status: 200,
        payload: {
          candidates: [{ finishReason: "SAFETY", index: 0 }],
          promptFeedback: { blockReason: "SAFETY" },
        },
      };
    case "httpError":
      return { status: reply.status, payload: { error: { code: reply.status, message: reply.message, status: "ERROR" } } };
  }
}

export async function startFakeGeminiServer(initial: FakeGeminiReply[] = []): Promise<FakeGeminiServer> {
  const replies = [...initial];
  let lastReply: FakeGeminiReply | null = null;
  const requests: { model: string; body: Record<string, unknown> }[] = [];

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const model = /models\/([^:/?]+)/.exec(req.url ?? "")?.[1] ?? "";
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* leave empty */ }
      requests.push({ model, body });

      // Each request consumes one queued reply; once the queue runs dry the
      // last one repeats, so a test that queues nothing still gets an answer.
      const reply = replies.shift() ?? lastReply ?? { kind: "json" as const, value: {} };
      lastReply = reply;
      const { status, payload } = bodyFor(reply);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://localhost:${port}`,
    requests,
    queue: (reply) => { replies.push(reply); },
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}
