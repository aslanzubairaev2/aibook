// Picking the live (voice) model to connect with.
//
// A hardcoded preview id is a time bomb: preview models are retired on a
// schedule, and the day one is, every call fails with an abrupt disconnect and
// no explanation. So the id is discovered from the service — it lists which
// models support bidiGenerateContent — and the constant below is only the
// fallback for when that list cannot be fetched.

export const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";

export type ListedModel = {
  name?: string;
  supportedGenerationMethods?: string[];
  displayName?: string;
};

/**
 * Rank the live-capable models and return the best one.
 *
 * Preferences, in order: newer family version, "flash" over "pro" (voice chat
 * is a latency game, and flash is an order of magnitude cheaper), a stable
 * release over a preview, and native-audio dialog models over the older
 * half-cascade ones — they are the ones that sound like a person.
 */
export function pickLiveModel(models: ListedModel[], preferred = DEFAULT_LIVE_MODEL): string {
  const live = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("bidiGenerateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);

  if (live.length === 0) return preferred;
  // The configured model is still on offer: nothing to second-guess.
  if (live.includes(preferred)) return preferred;

  const score = (id: string): number => {
    let points = 0;
    const version = /gemini-(\d+)(?:\.(\d+))?/.exec(id);
    if (version) points += Number(version[1]) * 100 + Number(version[2] ?? 0) * 10;
    if (id.includes("flash")) points += 40;
    if (id.includes("native-audio")) points += 20;
    if (!id.includes("preview") && !id.includes("exp")) points += 15;
    if (id.includes("thinking")) points -= 30;
    return points;
  };

  return live.slice().sort((a, b) => score(b) - score(a))[0];
}
