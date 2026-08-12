// A stand-in for the Gemini Live service, speaking the same WebSocket
// protocol, so the client's handshake and reconnect behaviour can be tested
// for real instead of reasoned about.
//
// It reproduces the two things that actually broke in production: a service
// that hangs up without a close frame when it receives traffic before the
// setup message (code 1006), and a service that refuses a configuration it
// does not support.

import { WebSocketServer, type WebSocket } from "ws";

export type FakeLiveBehaviour =
  /** Normal: confirm setup, then answer each turn with a short audio reply. */
  | { kind: "normal" }
  /** Refuse every configuration carrying the given key, as an unsupported option would be. */
  | { kind: "rejectOption"; option: string }
  /** Confirm setup, then drop the socket after the given delay, as a network blip would. */
  | { kind: "dropAfter"; ms: number }
  /** Confirm setup, then announce a shutdown before dropping. */
  | { kind: "goAwayAfter"; ms: number };

export type FakeLiveRecord = {
  /** Setup payloads received, newest last — one per connection attempt. */
  setups: Record<string, unknown>[];
  /** True if any connection sent something before its setup message. */
  sawTrafficBeforeSetup: boolean;
  /** Non-setup client messages, in order. */
  messages: Record<string, unknown>[];
  connections: number;
};

export type FakeLiveServer = {
  baseUrl: string;
  record: FakeLiveRecord;
  setBehaviour: (behaviour: FakeLiveBehaviour) => void;
  close: () => Promise<void>;
};

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/** Base64 of 320 samples of silence — shape matters here, not sound. */
const AUDIO_CHUNK = Buffer.alloc(640).toString("base64");

export async function startFakeLiveServer(
  initial: FakeLiveBehaviour = { kind: "normal" },
): Promise<FakeLiveServer> {
  let behaviour = initial;
  const record: FakeLiveRecord = {
    setups: [],
    sawTrafficBeforeSetup: false,
    messages: [],
    connections: 0,
  };

  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const port = (wss.address() as { port: number }).port;

  wss.on("connection", (ws) => {
    record.connections += 1;
    let setupSeen = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (!setupSeen) {
        if (!msg.setup) {
          // What the real service does with traffic that arrives before the
          // session is set up: hang up, no close frame. The browser reports
          // this as 1006.
          record.sawTrafficBeforeSetup = true;
          ws.terminate();
          return;
        }
        setupSeen = true;
        const setup = msg.setup as Record<string, unknown>;
        record.setups.push(setup);

        if (behaviour.kind === "rejectOption" && behaviour.option in setup) {
          ws.close(1008, "Unsupported configuration option");
          return;
        }

        send(ws, { setupComplete: {} });
        send(ws, { sessionResumptionUpdate: { newHandle: `handle-${record.connections}`, resumable: true } });

        if (behaviour.kind === "dropAfter") {
          timers.push(setTimeout(() => ws.terminate(), behaviour.ms));
        }
        if (behaviour.kind === "goAwayAfter") {
          timers.push(setTimeout(() => {
            send(ws, { goAway: { timeLeft: "1s" } });
            timers.push(setTimeout(() => ws.terminate(), 50));
          }, behaviour.ms));
        }
        return;
      }

      record.messages.push(msg);

      // Answer a text turn the way the service does: transcript deltas, audio,
      // then turnComplete.
      if (msg.clientContent) {
        send(ws, { serverContent: { outputTranscription: { text: "Guten " } } });
        send(ws, { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: AUDIO_CHUNK } }] } } });
        send(ws, { serverContent: { outputTranscription: { text: "Tag!" } } });
        send(ws, { serverContent: { turnComplete: true } });
      }
    });

    ws.on("close", () => {
      for (const timer of timers) clearTimeout(timer);
    });
  });

  return {
    baseUrl: `http://localhost:${port}`,
    record,
    setBehaviour: (next) => { behaviour = next; },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
