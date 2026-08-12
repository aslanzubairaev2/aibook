// Runs the real LiveChatSession against a stand-in service that speaks the
// Gemini Live protocol (lib/ai/fakeLiveServer.ts).
//
// The bug these tests exist for: the SDK fires onopen as soon as the socket
// connects, before the setup message is even sent, and the old code called
// that "connected". When the service then refused the configuration and hung
// up — usually with no close frame, which browsers report as code 1006 — the
// client read it as a network drop and reconnected with the same refused
// configuration, over and over, so the call never started.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startFakeLiveServer, type FakeLiveServer } from "./fakeLiveServer.ts";
import { LiveChatSession, type LiveChatCallbacks, type LiveChatStatus } from "./liveChat.ts";

// ─── Minimal browser stand-ins ───────────────────────────────────────────────
// The session captures the microphone and plays audio; neither exists in Node,
// and neither is what these tests are about.

class FakeAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  constructor(_options?: unknown) {}
  createMediaStreamSource() { return { connect() {} }; }
  // A real microphone starts delivering buffers a fraction of a second after
  // capture begins — which is exactly the window in which the old code raced
  // the setup message. The stand-in has to behave the same way or the race it
  // is here to catch cannot happen.
  createScriptProcessor() {
    const node = {
      _handler: null as null | ((e: unknown) => void),
      set onaudioprocess(handler: null | ((e: unknown) => void)) {
        node._handler = handler;
        if (!handler) return;
        const timer = setInterval(() => {
          if (!node._handler) return clearInterval(timer);
          node._handler({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
        }, 25);
        (timer as unknown as { unref?: () => void }).unref?.();
        node._timer = timer;
      },
      get onaudioprocess() { return node._handler; },
      _timer: null as null | ReturnType<typeof setInterval>,
      connect() {},
      disconnect() {
        node._handler = null;
        if (node._timer) clearInterval(node._timer);
      },
    };
    return node;
  }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
  createBuffer(_c: number, length: number) {
    return { duration: length / 24000, copyToChannel() {} };
  }
  createBufferSource() {
    return { buffer: null as unknown, onended: null as unknown, connect() {}, start() {}, stop() {} };
  }
  close() { return Promise.resolve(); }
}

function installBrowserStubs() {
  const g = globalThis as unknown as Record<string, unknown>;
  g.AudioContext = FakeAudioContext;
  const mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
  };
  try {
    Object.defineProperty(globalThis.navigator, "mediaDevices", { value: mediaDevices, configurable: true });
  } catch {
    Object.defineProperty(globalThis, "navigator", { value: { mediaDevices }, configurable: true });
  }
}

// ─── Test harness ────────────────────────────────────────────────────────────

type Recorder = {
  statuses: LiveChatStatus[];
  drops: { message: string; wasStable: boolean }[];
  errors: string[];
  handles: string[];
  modelText: string;
  turns: number;
  callbacks: LiveChatCallbacks;
};

function recorder(): Recorder {
  const r: Partial<Recorder> = { statuses: [], drops: [], errors: [], handles: [], modelText: "", turns: 0 };
  r.callbacks = {
    onStatusChange: (s) => r.statuses!.push(s),
    onDropped: (message, wasStable) => r.drops!.push({ message, wasStable }),
    onSessionHandle: (h) => r.handles!.push(h),
    onUserTranscript: () => {},
    onModelTranscript: (t) => { r.modelText += t; },
    onUserTurnEnd: () => {},
    onModelTurnEnd: () => { r.turns! += 1; },
    onInterrupted: () => {},
    onError: (m) => r.errors!.push(m),
  };
  return r as Recorder;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await wait(20);
  }
  throw new Error("Timed out waiting for condition");
}

describe("LiveChatSession against a stand-in Gemini Live service", () => {
  let server: FakeLiveServer;

  before(async () => {
    installBrowserStubs();
    server = await startFakeLiveServer();
  });

  after(async () => {
    await server.close();
  });

  test("connects, and never sends anything before the service confirms setup", async () => {
    server.setBehaviour({ kind: "normal" });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    await session.connect("ru", "de", { mode: "call" });

    assert.equal(r.errors.length, 0, `unexpected errors: ${r.errors.join("; ")}`);
    assert.ok(r.statuses.includes("listening"), "should report a live call");
    assert.equal(
      server.record.sawTrafficBeforeSetup,
      false,
      "the service hangs up on anything that arrives before its own setup message",
    );
    session.close();
  });

  test("the confirmed session is live: a text turn comes back transcribed", async () => {
    server.setBehaviour({ kind: "normal" });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);
    await session.connect("ru", "de", { mode: "call" });

    session.sendText("Hallo");
    await waitFor(() => r.turns > 0);

    assert.equal(r.modelText, "Guten Tag!");
    session.close();
  });

  test("a refused configuration option falls back to the plain one instead of failing", async () => {
    server.setBehaviour({ kind: "rejectOption", option: "sessionResumption" });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    const before = server.record.setups.length;
    await session.connect("ru", "de", { mode: "call" });

    const attempts = server.record.setups.slice(before);
    assert.equal(attempts.length, 2, "should retry once after the refusal");
    assert.ok("sessionResumption" in attempts[0], "first attempt asks for the long-session options");
    assert.ok(!("sessionResumption" in attempts[1]), "the retry drops them");
    assert.ok(r.statuses.includes("listening"), "the call still starts");
    assert.equal(r.errors.length, 0);
    session.close();
  });

  test("a refusal is never mistaken for a drop — it must not trigger a reconnect", async () => {
    server.setBehaviour({ kind: "rejectOption", option: "systemInstruction" });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    await assert.rejects(() => session.connect("ru", "de", { mode: "call" }));
    assert.deepEqual(r.drops, [], "a configuration the service refuses is not a network drop");
    session.close();
  });

  test("a mid-call drop is reported once, with the resumption handle kept", async () => {
    server.setBehaviour({ kind: "dropAfter", ms: 150 });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    await session.connect("ru", "de", { mode: "call" });
    assert.deepEqual(r.handles, ["handle-" + server.record.connections], "handle arrives for later resumption");

    await waitFor(() => r.drops.length > 0);
    await wait(200);
    assert.equal(r.drops.length, 1, "one drop per session, however it is signalled");
    assert.equal(r.drops[0].wasStable, false, "a call this short was never stable");
    session.close();
  });

  test("a goAway is acted on immediately and only once", async () => {
    server.setBehaviour({ kind: "goAwayAfter", ms: 100 });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    await session.connect("ru", "de", { mode: "call" });
    await waitFor(() => r.drops.length > 0);
    await wait(250);

    assert.equal(r.drops.length, 1, "goAway and the close that follows are one drop, not two");
    session.close();
  });

  test("reconnecting with a handle resumes rather than restarting", async () => {
    server.setBehaviour({ kind: "normal" });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    const before = server.record.setups.length;
    await session.connect("ru", "de", { mode: "call", resumeHandle: "handle-earlier" });

    const setup = server.record.setups[before] as { sessionResumption?: { handle?: string } };
    assert.equal(setup.sessionResumption?.handle, "handle-earlier");
    session.close();
  });

  test("closing mid-connect leaves nothing running", async () => {
    server.setBehaviour({ kind: "normal" });
    const r = recorder();
    const session = new LiveChatSession("test-key", "test-live-model", r.callbacks, server.baseUrl);

    const connecting = session.connect("ru", "de", { mode: "call" });
    session.close();
    await connecting;

    await wait(100);
    assert.deepEqual(r.drops, [], "a call the user hung up is not a drop");
  });
});
