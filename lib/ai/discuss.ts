import type { AiMode, DiscussContentPart, DiscussLearnerSnapshot, DiscussMessage, DiscussWordProfile, GrammarEncounter } from "@/lib/types";
import { supabase } from "@/lib/db/supabase";
import { getLocalGeminiKey, getLocalAiProvider } from "@/lib/db/local";
import { AI_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/net/freshFetch";

export type DiscussRequest = {
  mode: AiMode;
  selectedText: string;
  sentence: string;
  sentenceBefore?: string;
  sentenceAfter?: string;
  nativeLanguage: string;
  targetLanguage: string;
  /** CEFR estimate from the learner's own books and deck, when it can be made. */
  learnerLevel?: string;
  /** How well this learner already knows this item, from its card's schedule. */
  wordProfile?: DiscussWordProfile;
  /** mode "homework" only: the exercise being discussed, blanks and all. */
  homeworkContext?: { instruction: string; items: string[] };
  /** Grammar patterns previously encountered in AI discussions. */
  grammarContext?: GrammarEncounter[];
  /** Their recent and forgotten words and current book, for personal examples. */
  learnerSnapshot?: DiscussLearnerSnapshot;
  history: DiscussMessage[];
  message: string;
};

async function getAiHeaders() {
  const provider = getLocalAiProvider();
  if (provider === "off") {
    throw new Error("AI выключен в настройках. Включите его, чтобы использовать эту функцию.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const localKey = getLocalGeminiKey();
  if (localKey) {
    headers["x-gemini-key"] = localKey;
  }
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }
  return headers;
}

/**
 * Asks the tutor. With `onPartial` the answer is read as it is written: the
 * callback gets the text so far each time it grows, and the promise still
 * resolves with the finished message (chips, buttons and all).
 */
export async function discussWithAi(
  request: DiscussRequest,
  onPartial?: (contentParts: DiscussContentPart[]) => void,
): Promise<DiscussMessage> {
  const headers = await getAiHeaders();
  if (onPartial) headers["x-stream"] = "1";
  // A reply that role-plays or reasons through a homework check can take a
  // while to generate — bounded generously rather than left uncapped.
  const res = await fetchWithTimeout("/api/ai/discuss", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  }, AI_REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "AI discussion failed");
  }

  const streamed = (res.headers.get("content-type") ?? "").includes("ndjson");
  if (!onPartial || !streamed || !res.body) return res.json() as Promise<DiscussMessage>;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished: DiscussMessage | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | { type: "partial"; contentParts: DiscussContentPart[] }
      | { type: "done"; message: DiscussMessage }
      | { type: "error"; error: string };
    if (event.type === "partial") onPartial(event.contentParts);
    else if (event.type === "done") finished = event.message;
    else throw new Error(event.error || "AI discussion failed");
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop() ?? "";
    for (const line of lines) handle(line);
    if (done) break;
  }
  if (!finished) throw new Error("AI discussion ended early");
  return finished;
}
