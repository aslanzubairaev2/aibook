import { EndSensitivity, StartSensitivity, type RealtimeInputConfig } from "@google/genai";

/**
 * Voice-activity tuning, shared by the token route and the browser socket.
 *
 * The token is issued with `liveConnectConstraints`, so whatever the client
 * sends to `live.connect` has to match what the token was minted for — these
 * values therefore live in one place and are spread into both.
 *
 * Defaults cost real latency. Gemini Live waits for a fairly long silence
 * before it accepts that the speaker has finished, and only then starts
 * translating; at conversational pace that reads as "the app is slow". 320 ms
 * is short enough to keep up with a back-and-forth and still long enough to
 * survive the pauses inside a normal sentence. `prefixPaddingMs` is the mirror
 * image: how much speech must be heard before the turn is opened at all.
 */
export const LIVE_TRANSLATE_REALTIME_INPUT: RealtimeInputConfig = {
  automaticActivityDetection: {
    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
    prefixPaddingMs: 120,
    silenceDurationMs: 320,
  },
};
