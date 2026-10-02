// Principal parts of one verb for display (word modal, flashcard back).
//
// The answer for a verb never changes, so it is cached in localStorage for
// good: every card is looked up at most once per device. A word the endpoint
// rejects (an adjective such as «offen» that merely looks like an infinitive)
// is remembered too, so it is not asked about again on every flip.

import { freshFetch } from "@/lib/net/freshFetch";
import { getAiHeaders } from "@/lib/ai/analyze";
import { hasCompleteGermanVerbForms } from "@/lib/verbForms";

const CACHE_KEY = "aibook.verbForms.v1";
type CacheEntry = Record<string, string> | "none";

let memory: Record<string, CacheEntry> | null = null;
const inflight = new Map<string, Promise<Record<string, string> | null>>();

function cache(): Record<string, CacheEntry> {
  if (memory) return memory;
  try {
    memory = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as Record<string, CacheEntry>;
  } catch {
    memory = {};
  }
  return memory;
}

function remember(key: string, value: CacheEntry) {
  cache()[key] = value;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache()));
  } catch {
    // Storage full or blocked: the in-memory copy still serves this session.
  }
}

function keyOf(lemma: string, lang: string) {
  return `${lang}:${lemma.trim().toLocaleLowerCase("de-DE")}`;
}

/** Cached forms without a network call; `undefined` = never asked, `null` = not a verb. */
export function peekVerbForms(lemma: string, lang: string): Record<string, string> | null | undefined {
  const hit = cache()[keyOf(lemma, lang)];
  if (hit === undefined) return undefined;
  return hit === "none" ? null : hit;
}

export function fetchVerbForms(lemma: string, lang: string, nativeLang: string): Promise<Record<string, string> | null> {
  const key = keyOf(lemma, lang);
  const known = peekVerbForms(lemma, lang);
  if (known !== undefined) return Promise.resolve(known);
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await freshFetch("/api/ai/verb-forms", {
        method: "POST",
        headers: await getAiHeaders(),
        body: JSON.stringify({ lemma, headword: lemma, targetLanguage: lang, nativeLanguage: nativeLang }),
      });
      const data = (await res.json().catch(() => ({}))) as { forms?: Record<string, string> };
      if (res.ok && hasCompleteGermanVerbForms(data.forms)) {
        remember(key, data.forms!);
        return data.forms!;
      }
      // 502 is the endpoint saying "no such verb" (empty forms); anything else
      // (offline, 401, quota) is transient and must not be cached.
      if (res.status === 502) remember(key, "none");
      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}
