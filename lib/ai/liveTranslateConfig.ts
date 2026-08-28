import { EndSensitivity, StartSensitivity, type RealtimeInputConfig } from "@google/genai";

/**
 * Voice-activity tuning, shared by the token route and the browser socket.
 *
 * The token is issued with `liveConnectConstraints`, so whatever the client
 * sends to `live.connect` has to match what the token was minted for — these
 * values therefore live in one place and are spread into both.
 *
 * An earlier pass tuned this purely for latency — 320 ms of silence,
 * END_SENSITIVITY_HIGH — and that made the wrong trade. A short, eager
 * end-of-speech detector does not just answer sooner: it cuts the speaker off
 * mid-sentence on any ordinary breathing pause, so the model transcribes and
 * translates a fragment instead of the whole thought. That reads as "doesn't
 * understand what I'm saying", which is a recognition-quality problem wearing
 * a latency costume. END_SENSITIVITY_LOW plus a longer silence window trades
 * some of that latency win back for turns that actually contain full
 * sentences — worth it, since a correct translation a half-second later beats
 * a mangled one instantly. `prefixPaddingMs` is the mirror image: how much
 * speech must be heard before the turn opens at all; raised alongside it so a
 * soft-spoken opening word isn't clipped either.
 *
 * START_SENSITIVITY stays HIGH — an eager onset does not fragment anything,
 * it just avoids losing the first syllable, which is unambiguously good.
 */
export const LIVE_TRANSLATE_REALTIME_INPUT: RealtimeInputConfig = {
  automaticActivityDetection: {
    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
    prefixPaddingMs: 200,
    silenceDurationMs: 700,
  },
};
