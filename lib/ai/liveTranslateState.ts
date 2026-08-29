import type { LiveTranslateProvider } from "@/lib/types";

export type LiveTranslateState = "ready" | "connecting" | "listening" | "translating" | "stopped" | "mic-error" | "connection-error";

/** A stored value that predates the column, or that never got set, falls back to Gemini. */
export function normalizeLiveTranslateProvider(value: unknown): LiveTranslateProvider {
  return value === "openai" ? "openai" : "gemini";
}

export const LIVE_TRANSLATE_PROVIDER_LABELS: Record<LiveTranslateProvider, string> = {
  gemini: "Gemini Live",
  openai: "GPT Live",
};

export type LiveUsageMetadata = {
  totalTokenCount?: number;
  promptTokenCount?: number;
  responseTokenCount?: number;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  responseTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
};

export type LiveUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd: number;
  detailUnavailable: boolean;
  /**
   * How estimatedUsd was derived. gpt-realtime-translate bills a flat rate per
   * connected minute, not per token — there is no token breakdown to show, so
   * the footer reads differently for it than for Gemini's token estimate.
   */
  costBasis?: "tokens" | "per-minute";
};

const INPUT_AUDIO_USD_PER_MILLION = 3.5;
const OUTPUT_AUDIO_USD_PER_MILLION = 21;

export const LIVE_TRANSLATE_LABELS: Record<LiveTranslateState, string> = {
  ready: "Готово к переводу",
  connecting: "Подключение к переводчику…",
  listening: "Слушаю разговор",
  translating: "Перевожу",
  stopped: "Перевод остановлен",
  "mic-error": "Нет доступа к микрофону",
  "connection-error": "Ошибка соединения",
};

export function appendTranscript(current: string, delta: string): string {
  const clean = delta.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "").trim();
  if (!clean) return current;
  return `${current}${clean}`.slice(-4000);
}

function detailTotal(details: LiveUsageMetadata["promptTokensDetails"]): number | null {
  if (!details?.length) return null;
  const counted = details.reduce((total, item) => total + (typeof item.tokenCount === "number" ? item.tokenCount : 0), 0);
  return counted > 0 ? counted : null;
}

/** Estimates Standard audio rates from cumulative usage metadata only. */
export function calculateLiveUsage(metadata?: LiveUsageMetadata): LiveUsageTotals {
  const inputTokens = Math.max(0, metadata?.promptTokenCount ?? 0);
  const outputTokens = Math.max(0, metadata?.responseTokenCount ?? 0);
  const totalTokens = Math.max(0, metadata?.totalTokenCount ?? inputTokens + outputTokens);
  const detailUnavailable = detailTotal(metadata?.promptTokensDetails) === null || detailTotal(metadata?.responseTokensDetails) === null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd: (inputTokens * INPUT_AUDIO_USD_PER_MILLION + outputTokens * OUTPUT_AUDIO_USD_PER_MILLION) / 1_000_000,
    detailUnavailable,
  };
}

export function accumulateLiveUsage(current: LiveUsageTotals, metadata?: LiveUsageMetadata): LiveUsageTotals {
  if (!metadata) return current;
  const next = calculateLiveUsage({
    promptTokenCount: current.inputTokens + (metadata.promptTokenCount ?? 0),
    responseTokenCount: current.outputTokens + (metadata.responseTokenCount ?? 0),
    totalTokenCount: current.totalTokens + (metadata.totalTokenCount ?? (metadata.promptTokenCount ?? 0) + (metadata.responseTokenCount ?? 0)),
    promptTokensDetails: [...(current.detailUnavailable ? [] : [{ tokenCount: current.inputTokens }]), ...(metadata.promptTokensDetails ?? [])],
    responseTokensDetails: [...(current.detailUnavailable ? [] : [{ tokenCount: current.outputTokens }]), ...(metadata.responseTokensDetails ?? [])],
  });
  return next;
}

/** Flat per-minute usage for gpt-realtime-translate — see GPT_TRANSLATE_USD_PER_MINUTE. */
export function calculatePerMinuteUsage(connectedSeconds: number, usdPerMinute: number): LiveUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: Math.max(0, connectedSeconds) * (usdPerMinute / 60),
    detailUnavailable: false,
    costBasis: "per-minute",
  };
}
