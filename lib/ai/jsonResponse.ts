// Getting usable JSON out of a language model, whatever it actually returns.
//
// `responseMimeType: "application/json"` is a strong hint, not a guarantee, and
// it says nothing about the answer being *complete*. The failure that made the
// photo feature unusable was not a malformed answer but a truncated one: the
// model hit its output ceiling mid-object, `JSON.parse` threw, and the learner
// got "не удалось разобрать ответ". Everything here exists to turn that class
// of failure into either a usable result or a message that says what happened.

/** Strip a ```json … ``` fence, if the model wrapped its answer in one. */
function stripFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

/**
 * The outermost {…} or […] in the text, ignoring braces inside strings.
 *
 * Models prepend "Here is the JSON:" more often than anyone would like, and a
 * trailing "Let me know if…" is just as common.
 */
function sliceOutermost(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Never closed: truncated output.
  return text.slice(start);
}

/**
 * Close whatever a truncated answer left open.
 *
 * A cut-off response is not garbage — it is a correct answer missing its tail.
 * Closing the open string, dropping the half-written key and balancing the
 * brackets recovers everything the model did manage to say, which for a
 * transcription is nearly all of it.
 */
function closeTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastComplete = -1; // end of the last value that finished cleanly

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') {
      inString = !inString;
      if (!inString) lastComplete = i;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      lastComplete = i;
    } else if (/[\d\w]/.test(ch)) lastComplete = i;
  }

  let repaired = text;
  if (inString) {
    // Mid-string: close it where it stopped.
    repaired += '"';
  } else {
    // Between values: cut back to the last complete one so a dangling
    // `"key":` or a trailing comma doesn't reach the parser.
    repaired = repaired.slice(0, lastComplete + 1);
  }
  repaired = repaired.replace(/,\s*$/, "");
  while (stack.length > 0) repaired += stack.pop();
  return repaired;
}

export type JsonParseResult =
  | { ok: true; value: unknown; repaired: boolean }
  | { ok: false };

/**
 * Parse a model's answer as JSON, salvaging what can be salvaged.
 *
 * `repaired` says the answer was incomplete and had to be closed — the caller
 * may want to warn, retry, or accept it depending on how much the tail
 * mattered.
 */
export function parseModelJson(raw: string): JsonParseResult {
  const text = stripFence((raw ?? "").trim());
  if (!text) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(text), repaired: false };
  } catch {
    // fall through
  }

  const sliced = sliceOutermost(text);
  if (!sliced) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(sliced), repaired: false };
  } catch {
    // fall through
  }

  try {
    return { ok: true, value: JSON.parse(closeTruncated(sliced)), repaired: true };
  } catch {
    return { ok: false };
  }
}
