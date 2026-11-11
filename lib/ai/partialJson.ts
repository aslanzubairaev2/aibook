// Reading a JSON answer while it is still being written.
//
// The discussion model answers in JSON, so its reply could not be shown until
// the last brace arrived — several seconds of an empty chat. This closes
// whatever has arrived so far into valid JSON: a string still being written is
// shown up to its last character, anything less finished than that (a key
// without a value, half a number) is left out until it completes.

type Frame = { closer: "}" | "]"; expectKey: boolean };

/**
 * The value described by a possibly truncated JSON text, or null when nothing
 * usable has arrived yet.
 */
export function parsePartialJson(text: string): unknown | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;

  const stack: Frame[] = [];
  // Up to `safe`, plus the closers of `safeStack`, the text is valid JSON.
  let safe = -1;
  let safeClosers = "";
  let inString = false;
  let stringIsKey = false;
  let escaped = false;
  let primitiveStart = -1;

  const closers = () => stack.map((frame) => frame.closer).reverse().join("");
  const markSafe = (end: number) => {
    safe = end;
    safeClosers = closers();
  };
  const valueDone = () => {
    const top = stack[stack.length - 1];
    if (top?.closer === "}") top.expectKey = false;
  };

  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch !== '"') continue;
      inString = false;
      if (stringIsKey) {
        // The next string in this object is the key's value.
        stack[stack.length - 1].expectKey = false;
      } else {
        valueDone();
        markSafe(i + 1);
      }
      continue;
    }

    if (primitiveStart >= 0) {
      if (!/[\s,\]}]/.test(ch)) continue;
      // true / false / null / a number has ended.
      primitiveStart = -1;
      valueDone();
      markSafe(i);
    }

    if (ch === '"') {
      const top = stack[stack.length - 1];
      inString = true;
      stringIsKey = top?.closer === "}" && top.expectKey;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push({ closer: ch === "{" ? "}" : "]", expectKey: ch === "{" });
      markSafe(i + 1);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      valueDone();
      markSafe(i + 1);
      if (stack.length === 0) { i++; break; }
      continue;
    }
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top?.closer === "}") top.expectKey = true;
      continue;
    }
    if (ch === ":" || /\s/.test(ch)) continue;
    primitiveStart = i;
  }

  let candidate: string;
  if (inString && !stringIsKey) {
    // A value still being written: show what there is. A dangling backslash or
    // half a \uXXXX escape would break the string, so it is cut off.
    let body = text.slice(start, i);
    body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/(^|[^\\])((?:\\\\)*)\\$/, "$1$2");
    candidate = `${body}"${closers()}`;
  } else {
    if (safe < 0) return null;
    candidate = text.slice(start, safe) + safeClosers;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
