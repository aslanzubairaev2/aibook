// A 429 from Gemini is not one thing. It can mean "you sent two requests in the
// same second", "you have used the model's whole day", or "this key is still on
// the free tier and the paid quota you think you have lives on another project".
// Those need completely different reactions, and Google says which one it is —
// in the `details` array that the route used to throw away.
//
// https://ai.google.dev/gemini-api/docs/rate-limits

export type QuotaWindow = "minute" | "day" | "unknown";

export type QuotaDiagnosis = {
  /** Which limit was hit, as far as the error body admits. */
  window: QuotaWindow;
  /** True when the violated quota is explicitly the free-tier one. */
  freeTier: boolean;
  /** The quota's own ceiling, when reported (e.g. "15" requests). */
  limit: string | null;
  /** Google's own retry hint, in seconds. */
  retryAfterSeconds: number | null;
  /** Google's human-readable message, for the log and the client. */
  message: string | null;
  /** The raw quota id, the single most useful string when debugging in the console. */
  quotaId: string | null;
};

type Violation = { quotaMetric?: string; quotaId?: string; quotaValue?: string };

/**
 * Read a Gemini error payload (the raw response text) into something actionable.
 *
 * Never throws: a body that is empty, HTML, or a shape Google changed later
 * still yields a diagnosis, just an emptier one.
 */
export function diagnoseQuotaError(rawBody: string): QuotaDiagnosis {
  const empty: QuotaDiagnosis = {
    window: "unknown",
    freeTier: false,
    limit: null,
    retryAfterSeconds: null,
    message: null,
    quotaId: null,
  };

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ...empty, message: rawBody.slice(0, 300) || null };
  }

  const error = parsed?.error ?? parsed;
  const details: any[] = Array.isArray(error?.details) ? error.details : [];

  const violations: Violation[] = details
    .filter((d) => typeof d?.["@type"] === "string" && d["@type"].includes("QuotaFailure"))
    .flatMap((d) => (Array.isArray(d.violations) ? d.violations : []));

  // Per-day is the finding that matters most — it means waiting a minute will
  // not help — so let it win when a response reports several violations.
  const chosen =
    violations.find((v) => describesWindow(v) === "day") ??
    violations.find((v) => describesWindow(v) === "minute") ??
    violations[0] ??
    null;

  const retryInfo = details.find(
    (d) => typeof d?.["@type"] === "string" && d["@type"].includes("RetryInfo"),
  );

  return {
    window: chosen ? describesWindow(chosen) : "unknown",
    freeTier: violations.some((v) => /free[_ ]?tier/i.test(`${v.quotaId ?? ""}${v.quotaMetric ?? ""}`)),
    limit: chosen?.quotaValue ?? null,
    retryAfterSeconds: parseRetryDelay(retryInfo?.retryDelay),
    message: typeof error?.message === "string" ? error.message : null,
    quotaId: chosen?.quotaId ?? null,
  };
}

function describesWindow(violation: Violation): QuotaWindow {
  const haystack = `${violation.quotaId ?? ""} ${violation.quotaMetric ?? ""}`;
  if (/per[_ ]?day|daily/i.test(haystack)) return "day";
  if (/per[_ ]?minute|per[_ ]?min\b/i.test(haystack)) return "minute";
  return "unknown";
}

/** Google sends durations as protobuf strings: "32s", "1.5s". */
function parseRetryDelay(delay: unknown): number | null {
  if (typeof delay !== "string") return null;
  const seconds = Number.parseFloat(delay.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.ceil(seconds) : null;
}

/** What the learner should be told, in the app, in Russian. */
export function quotaMessageRu(d: QuotaDiagnosis): string {
  if (d.freeTier) {
    return d.window === "day"
      ? `Дневная квота Gemini TTS израсходована${d.limit ? ` (лимит ${d.limit} запросов)` : ""} — ключ работает на бесплатном тарифе. Подключите биллинг к тому же проекту Google Cloud, что и ключ.`
      : "Ключ Gemini работает на бесплатном тарифе, а у него очень низкий лимит запросов. Подключите биллинг к проекту, которому принадлежит ключ.";
  }
  if (d.window === "day") {
    return `Дневная квота Gemini TTS израсходована${d.limit ? ` (лимит ${d.limit} запросов в сутки)` : ""}. Она обновится в полночь по тихоокеанскому времени.`;
  }
  if (d.window === "minute") {
    return `Слишком много запросов к Gemini TTS за минуту${d.limit ? ` (лимит ${d.limit})` : ""}. ${
      d.retryAfterSeconds ? `Повтор через ${d.retryAfterSeconds} с.` : "Попробуйте через минуту."
    }`;
  }
  return "Google ограничил запросы к Gemini TTS (429). Проверьте квоты модели в AI Studio.";
}
